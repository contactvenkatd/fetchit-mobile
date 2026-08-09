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

export type ChatHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const MAX_HISTORY_MESSAGES = 40;
const MAX_HISTORY_CHARACTERS = 12_000;

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

export function buildChatHistory(
  messages: Array<{ role: 'user' | 'assistant'; text: string; contextText?: string }>,
): ChatHistoryMessage[] {
  const history: ChatHistoryMessage[] = [];
  let characters = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (history.length >= MAX_HISTORY_MESSAGES) break;
    const message = messages[index];
    const content = (message.contextText ?? message.text).trim();
    if (!content) continue;
    if (characters + content.length > MAX_HISTORY_CHARACTERS) break;
    history.push({ role: message.role, content });
    characters += content.length;
  }

  return history.reverse();
}

export async function sendChatMessage(
  message: string,
  history: ChatHistoryMessage[] = [],
): Promise<GrokResult> {
  const input = message.trim();
  if (!input) throw new GrokServiceError('A message is required.');

  try {
    const { data, error } = await supabase.functions.invoke('parse-shopping-intent', {
      body: { message: input, history },
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

export async function getZeroResultsSuggestion(
  productQuery: string,
  history: ChatHistoryMessage[],
): Promise<string> {
  const query = productQuery.trim();
  if (!query) throw new GrokServiceError('A product query is required.');

  try {
    const { data, error } = await supabase.functions.invoke('parse-shopping-intent', {
      body: { message: query, history, searchFailure: true },
    });
    if (error) throw error;
    if (!isGrokResult(data) || data.type !== 'message') {
      throw new Error('Edge Function returned a malformed zero-results suggestion.');
    }
    return data.text.trim();
  } catch (error) {
    if (error instanceof GrokServiceError) throw error;
    throw new GrokServiceError('Grok zero-results suggestion request failed.', {
      cause: error,
    });
  }
}
