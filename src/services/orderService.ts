import { supabase } from '@/lib/supabase';

export interface CheckoutQuote {
  id: string; mode: 'estimate'; revision: string; itemSubtotalCents: number;
  knownCostsCents: number; shippingCents: null; taxCents: null; zincFeeCents: 100;
  paymentFeeCents: null; fetchitMarginCents: 0; estimatedTotalCents: null;
  retailerBudgetCents: number; currency: 'USD'; expiresAt: number;
}

export interface PlaceOrderInput {
  approval?: { quoteId: string; mode: "estimate"; acceptsVariableFees: true; retailerBudgetCents: number; currency: "USD" };
  itemSubtotalCents: number;
  currency: "USD";
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
    // Only established pre-submission/definite rejection codes permit another
    // tap. Unknown provider codes and already_exists may hide an accepted order.
    this.outcomeUnknown = ![
      'unauthorized', 'invalid_json', 'invalid_order', 'method_not_allowed',
      'service_not_configured', 'zinc_environment_mismatch', 'checkout_pricing_unavailable',
      'profile_lookup_failed', 'missing_profile', 'missing_payment_method',
      'incomplete_shipping_address', 'missing_phone_number', 'checkout_approval_required',
      'payment_environment_mismatch', 'payment_verification_unavailable',
      'max_price_exceeded', 'card_declined', 'insufficient_funds',
      'invalid_shipping_address', 'url_unreachable',
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
      quote.mode !== 'estimate' || quote.revision !== 'usd-variable-fees-v1' ||
      input.currency !== 'USD' || quote.itemSubtotalCents !== input.itemSubtotalCents ||
      !Number.isSafeInteger(quote.knownCostsCents) || quote.knownCostsCents !== input.itemSubtotalCents + 100 ||
      quote.zincFeeCents !== 100 || quote.fetchitMarginCents !== 0 ||
      quote.shippingCents !== null || quote.taxCents !== null || quote.paymentFeeCents !== null ||
      quote.estimatedTotalCents !== null ||
      quote.retailerBudgetCents !== input.displayedPriceCents ||
      !Number.isSafeInteger(quote.expiresAt) || quote.expiresAt <= Date.now()) {
    throw new PlaceOrderError('checkout_pricing_unavailable', 'The checkout estimate could not be verified. No order was submitted.');
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
