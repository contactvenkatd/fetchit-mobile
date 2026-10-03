import { supabase } from '@/lib/supabase';

export interface CheckoutQuote {
  id: string; maximumCents: number; retailerBudgetCents: number; currency: "USD"; expiresAt: number;
}

export interface PlaceOrderInput {
  approval?: { quoteId: string; maximumCents: number; currency: "USD" };
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
  readonly outcomeUnknown: boolean;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PlaceOrderError';
    this.code = code;
    this.userMessage = message;
    this.outcomeUnknown = [
      'place_order_failed', 'malformed_response', 'zinc_unreachable', 'malformed_zinc_response',
    ].includes(code);
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
    'We could not confirm the order outcome. Check order history and contact support before submitting another purchase.',
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
      'The order service returned an incomplete confirmation. Check order history and contact support before submitting another purchase.',
    );
  }
  return {
    order: response.order,
    warning: typeof response.warning === 'string' ? response.warning : undefined,
  };
}


export async function getCheckoutQuote(input: PlaceOrderInput): Promise<CheckoutQuote> {
  const { data, error } = await supabase.functions.invoke('place-order', { body: { ...input, action: 'quote', approval: undefined } });
  if (error) throw await functionError(error);
  const quote = data?.quote as CheckoutQuote | undefined;
  if (!quote || !/^[a-f0-9]{64}$/.test(quote.id) || quote.currency !== 'USD' ||
      !Number.isSafeInteger(quote.maximumCents) || quote.maximumCents < input.displayedPriceCents ||
      quote.retailerBudgetCents !== input.displayedPriceCents ||
      !Number.isSafeInteger(quote.expiresAt) || quote.expiresAt <= Date.now()) {
    throw new PlaceOrderError('checkout_pricing_unavailable', 'The maximum authorization could not be verified. No order was submitted.');
  }
  return quote;
}


export interface CheckoutOrderStatus {
  zincOrderId: string;
  zincStatus: string;
  retailerStatus: string;
  simulated: boolean;
  errorCode: string | null;
  connectState: string | null;
  simulatedChargeCents: number | null;
  payment: { status: string; source: string; paymentIntentId: string | null;
    connectedAccountId: string | null; actualChargeCents: number | null; currency: string | null };
}

export async function getCheckoutOrderStatus(orderId: string): Promise<CheckoutOrderStatus> {
  const { data, error } = await supabase.functions.invoke('place-order', { body: { action: 'status', orderId } });
  if (error) throw await functionError(error);
  const status = data?.status as CheckoutOrderStatus | undefined;
  if (!status || typeof status.zincStatus !== 'string' || typeof status.simulated !== 'boolean' ||
      typeof status.retailerStatus !== 'string' || typeof status.payment?.status !== 'string' ||
      !(status.payment.actualChargeCents === null || (Number.isSafeInteger(status.payment.actualChargeCents) && status.payment.actualChargeCents >= 0))) {
    throw new PlaceOrderError('order_status_unavailable', 'The latest order or payment status could not be verified. Do not submit another purchase.');
  }
  return status;
}
