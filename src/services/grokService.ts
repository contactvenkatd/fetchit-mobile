import { supabase } from '@/lib/supabase';

export interface ShoppingIntent {
  productQuery: string;
  size: string | null;
  color: string | null;
  priceCeiling: number | null;
  quantity: number;
  retailerPreference: string | null;
}

export type GrokResult =
  | { type: 'shopping_intent'; intent: ShoppingIntent }
  | { type: 'message'; text: string };

export class GrokServiceError extends Error {
  readonly userMessage =
    "I couldn't respond right now. Please try again in a moment.";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GrokServiceError';
  }
}

function isShoppingIntent(value: unknown): value is ShoppingIntent {
  if (!value || typeof value !== 'object') return false;
  const intent = value as Record<string, unknown>;
  return (
    typeof intent.productQuery === 'string' &&
    intent.productQuery.trim().length > 0 &&
    (intent.size === null || typeof intent.size === 'string') &&
    (intent.color === null || typeof intent.color === 'string') &&
    (intent.priceCeiling === null ||
      (typeof intent.priceCeiling === 'number' && Number.isFinite(intent.priceCeiling))) &&
    Number.isInteger(intent.quantity) &&
    (intent.quantity as number) >= 1 &&
    (intent.retailerPreference === null || typeof intent.retailerPreference === 'string')
  );
}

function isGrokResult(value: unknown): value is GrokResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  if (result.type === 'message') {
    return typeof result.text === 'string' && result.text.trim().length > 0;
  }
  if (result.type === 'shopping_intent') return isShoppingIntent(result.intent);
  return false;
}

export async function sendChatMessage(message: string): Promise<GrokResult> {
  const input = message.trim();
  if (!input) throw new GrokServiceError('A message is required.');

  try {
    const { data, error } = await supabase.functions.invoke('parse-shopping-intent', {
      body: { message: input },
    });
    if (error) throw error;
    if (!isGrokResult(data)) throw new Error('Edge Function returned a malformed chat response.');
    if (data.type === 'message') return { type: 'message', text: data.text.trim() };
    return {
      type: 'shopping_intent',
      intent: { ...data.intent, productQuery: data.intent.productQuery.trim() },
    };
  } catch (error) {
    if (error instanceof GrokServiceError) throw error;
    throw new GrokServiceError('Grok chat request failed.', {
      cause: error,
    });
  }
}
