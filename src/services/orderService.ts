import { supabase } from '@/lib/supabase';

export interface PlaceOrderInput {
  productUrl: string;
  quantity: number;
  displayedPriceCents: number;
  productName: string;
  productImage: string | null;
  retailer: string;
  idempotencyKey: string;
}

export interface PlacedOrder {
  id: string | null;
  zincOrderId: string;
  status: string;
  totalCents: number;
  recorded: boolean;
}

export class PlaceOrderError extends Error {
  readonly code: string;
  readonly userMessage: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PlaceOrderError';
    this.code = code;
    this.userMessage = message;
  }
}

async function functionError(error: unknown): Promise<PlaceOrderError> {
  const context = (error as { context?: { json?: () => Promise<unknown> } })?.context;
  try {
    const body = (await context?.json?.()) as
      | { error?: { code?: unknown; message?: unknown } }
      | undefined;
    if (typeof body?.error?.message === 'string') {
      return new PlaceOrderError(
        typeof body.error.code === 'string' ? body.error.code : 'place_order_failed',
        body.error.message,
        { cause: error },
      );
    }
  } catch {
    // Use the safe fallback below.
  }
  return new PlaceOrderError(
    'place_order_failed',
    "We couldn't place your order. You were not shown a confirmation—please try again.",
    { cause: error },
  );
}

function isPlacedOrder(value: unknown): value is PlacedOrder {
  if (!value || typeof value !== 'object') return false;
  const order = value as Record<string, unknown>;
  return (
    (order.id === null || typeof order.id === 'string') &&
    typeof order.zincOrderId === 'string' &&
    typeof order.status === 'string' &&
    Number.isInteger(order.totalCents) &&
    typeof order.recorded === 'boolean'
  );
}

export async function placeOrder(
  input: PlaceOrderInput,
): Promise<{ order: PlacedOrder; warning?: string }> {
  const { data, error } = await supabase.functions.invoke('place-order', { body: input });
  if (error) throw await functionError(error);

  const response = data as { success?: unknown; order?: unknown; warning?: unknown } | null;
  if (response?.success !== true || !isPlacedOrder(response.order)) {
    throw new PlaceOrderError(
      'malformed_response',
      'The order service returned an incomplete confirmation.',
    );
  }
  return {
    order: response.order,
    warning: typeof response.warning === 'string' ? response.warning : undefined,
  };
}
