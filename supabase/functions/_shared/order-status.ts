import { paymentStripe, stripeIsLive } from './stripe-backend.ts';

const states = new Set(['pending', 'in_progress', 'order_placed', 'order_failed', 'cancelled', 'cancelled_by_retailer']);
const machineCode = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_]{1,100}$/.test(value) ? value : null;
const paymentId = (value: unknown, prefix: string) => typeof value === 'string' &&
  value.startsWith(prefix) && /^[a-zA-Z0-9_]{1,150}$/.test(value) ? value : null;
const cents = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;

export async function readOrderStatus(zincOrderId: string, key: string) {
  if (!/^[a-f0-9-]{36}$/i.test(zincOrderId) || !/^zn_(live|test)_/.test(key)) throw new Error('invalid_status_reference');
  const response = await fetch(`https://api.zinc.com/orders/${zincOrderId}`, {
    headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('zinc_status_unavailable');
  const raw = await response.json();
  if (raw.id !== zincOrderId || !states.has(raw.status)) throw new Error('malformed_order_status');
  // Test credentials identify a simulation even when Connect metadata is absent.
  const simulated = key.startsWith('zn_test_') || raw.connect?.simulated === true || raw.payment?.simulated === true;
  const paymentIntentId = paymentId(raw.connect?.payment_intent_id, 'pi_');
  const connectedAccountId = paymentId(raw.connect?.connected_account_id, 'acct_');
  const payment = { status: simulated ? 'simulated' : 'not_verified',
    source: simulated ? 'zinc_simulation' : 'unverified', paymentIntentId, connectedAccountId,
    actualChargeCents: null as number | null, currency: null as string | null };
  if (!simulated && paymentIntentId && connectedAccountId) {
    try {
      const stripe = paymentStripe();
      const account = await stripe.accounts.retrieve();
      if (account.id !== connectedAccountId) throw new Error('payment_account_mismatch');
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (intent.livemode !== stripeIsLive()) throw new Error('payment_mode_mismatch');
      payment.status = intent.status;
      payment.source = intent.livemode ? 'stripe_live' : 'stripe_test';
      payment.currency = typeof intent.currency === 'string' && /^[a-z]{3}$/.test(intent.currency) ? intent.currency.toUpperCase() : null;
      // Authorization size is not money paid. Only report confirmed captured funds.
      payment.actualChargeCents = intent.status === 'succeeded' ? cents(intent.amount_received) : null;
    } catch {
      payment.status = 'verification_unavailable';
    }
  }
  const items = Array.isArray(raw.items) ? raw.items : [];
  const tracking = (Array.isArray(raw.tracking_numbers) ? raw.tracking_numbers : [])
    .filter((shipment: unknown) => shipment !== null && typeof shipment === 'object')
    .map((shipment: Record<string, unknown>) => ({
      carrier: machineCode(shipment.carrier),
      trackingNumber: typeof shipment.tracking_number === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(shipment.tracking_number) ? shipment.tracking_number : null,
      status: ['pending', 'in_transit', 'delivered'].includes(String(shipment.status)) ? shipment.status as string : 'unconfirmed',
      estimatedDeliveryDate: typeof shipment.estimated_delivery_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(shipment.estimated_delivery_date) ? shipment.estimated_delivery_date : null,
    }));
  const retailerStatus = raw.status === 'order_failed' ? 'failed' :
    ['cancelled', 'cancelled_by_retailer'].includes(raw.status) ? 'cancelled' :
    (tracking.length > 0 && tracking.every((shipment: { status: string }) => shipment.status === 'delivered')) ||
      (tracking.length === 0 && items.length > 0 && items.every((item: { status?: string }) => item?.status === 'delivered'))
      ? 'delivered' : tracking.some((shipment: { status: string }) => shipment.status === 'in_transit') ? 'in_transit' :
      tracking.length > 0 ? 'shipping_pending' : items.some((item: { status?: string }) => item?.status === 'shipped') ? 'shipped' :
      raw.status === 'order_placed' ? 'placed' : 'unconfirmed';
  return { zincOrderId, zincStatus: raw.status, simulated,
    retailerStatus, tracking,
    errorCode: machineCode(raw.job_result?.error_details?.code ?? raw.job_result?.error_type ?? raw.error?.code ?? raw.code) ??
      items.map((item: { error?: { code?: unknown }; error_type?: unknown }) => machineCode(item.error?.code ?? item.error_type)).find(Boolean) ?? null,
    connectState: machineCode(raw.connect?.state),
    simulatedChargeCents: simulated ? cents(raw.connect?.final_charge) : null,
    payment };
}
