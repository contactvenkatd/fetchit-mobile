import type { Billing } from './stripe';
import { supabase } from './supabase';

/**
 * Stripe helpers — thin wrappers over the same Supabase Edge Functions the web
 * app uses (deployed from the web repo). The secret key never touches the
 * client: these create the SetupIntent/Subscription server-side and the app only
 * confirms the returned client secret. Mirrors `createSetupIntent`/`saveCard`/
 * `createSubscription` in fetchit-app/src/utils.js.
 */

export type SetupIntentData = { clientSecret: string; customerId?: string };
export type SubscriptionData = {
  clientSecret: string;
  subscriptionId?: string;
  customerId?: string;
};
export type SavedCard = {
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
};

// Supabase FunctionsHttpError carries the Response on `.context`; the edge
// functions put a human message on `{ error }`. Dig it out, else stay generic.
async function readFnError(error: unknown, fallback: string): Promise<string> {
  const e = error as { message?: string; context?: { json?: () => Promise<unknown> } };
  let message = e?.message || fallback;
  try {
    const body = (await e?.context?.json?.()) as { error?: string } | undefined;
    if (body?.error) message = body.error;
  } catch {
    /* keep the generic message */
  }
  return message;
}

/**
 * Reuse-or-create the user's Stripe customer and start a SetupIntent (saves a
 * card for later off-session charges — NO charge now). Confirm the returned
 * clientSecret on-device with `confirmSetupIntent`.
 */
export async function createSetupIntent(): Promise<{
  data?: SetupIntentData;
  error?: { message: string };
}> {
  const { data, error } = await supabase.functions.invoke('create-setup-intent', {
    body: {},
  });
  if (error) return { error: { message: await readFnError(error, 'Could not start card setup.') } };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

/**
 * Hand the confirmed payment_method id to the edge function: it sets the card as
 * the customer's default and returns NON-sensitive display metadata.
 */
export async function saveCard(paymentMethodId: string): Promise<{
  data?: { card?: SavedCard };
  error?: { message: string };
}> {
  const { data, error } = await supabase.functions.invoke('save-card', {
    body: { paymentMethodId },
  });
  if (error) return { error: { message: await readFnError(error, 'Could not save your card.') } };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

/**
 * Reuse-or-create the customer and start an INCOMPLETE subscription for `plan`
 * (billing: "monthly" | "annual"). The function builds prices inline (no Stripe
 * price IDs) and returns the first invoice's PaymentIntent `clientSecret` to
 * confirm on-device with `confirmPayment`. Mirrors the web `createSubscription`.
 */
export async function createSubscription(params: {
  plan: string;
  billing: Billing;
}): Promise<{ data?: SubscriptionData; error?: { message: string } }> {
  const { data, error } = await supabase.functions.invoke('create-subscription', {
    body: { plan: params.plan, billing: params.billing },
  });
  if (error)
    return { error: { message: await readFnError(error, 'Could not start your subscription.') } };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

/**
 * The signed-in user's `profiles` row — shipping address + saved-card metadata.
 * Mirrors the web `utils.js` Profile shape (camelCase over the snake_case table).
 */
export type Profile = {
  fullName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  cardExpMonth: number | null;
  cardExpYear: number | null;
};

// Map a raw `profiles` row → camelCase Profile (mirrors web mapProfile).
function mapProfile(row: Record<string, unknown> | null): Profile | null {
  if (!row) return null;
  const str = (v: unknown) => (v ? String(v) : '');
  const orNull = (v: unknown) => (v ? String(v) : null);
  const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number(v));
  return {
    fullName: str(row.full_name),
    addressLine1: str(row.address_line1),
    addressLine2: str(row.address_line2),
    city: str(row.city),
    state: str(row.state),
    zip: str(row.zip),
    country: str(row.country) || 'United States',
    stripeCustomerId: orNull(row.stripe_customer_id),
    stripePaymentMethodId: orNull(row.stripe_payment_method_id),
    cardBrand: orNull(row.card_brand),
    cardLast4: orNull(row.card_last4),
    cardExpMonth: numOrNull(row.card_exp_month),
    cardExpYear: numOrNull(row.card_exp_year),
  };
}

/** The signed-in user's profile row, or null if they haven't saved one yet. */
export async function getProfile(): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').maybeSingle();
  if (error) {
    console.error('getProfile failed:', error.message);
    return null;
  }
  return mapProfile(data as Record<string, unknown> | null);
}

// camelCase field → `profiles` column. Only provided fields are written, so an
// address save never clobbers card columns and vice-versa (mirrors web saveProfile).
const PROFILE_COLUMNS: Record<string, string> = {
  fullName: 'full_name',
  addressLine1: 'address_line1',
  addressLine2: 'address_line2',
  city: 'city',
  state: 'state',
  zip: 'zip',
  country: 'country',
  stripeCustomerId: 'stripe_customer_id',
  stripePaymentMethodId: 'stripe_payment_method_id',
  cardBrand: 'card_brand',
  cardLast4: 'card_last4',
  cardExpMonth: 'card_exp_month',
  cardExpYear: 'card_exp_year',
};

/**
 * Upsert the caller's `profiles` row with only the provided fields. `user_id`
 * is left to the table's `auth.uid()` default (the upsert conflict target), so —
 * exactly as on web — we never send it from the client.
 */
export async function saveProfile(
  fields: Partial<Record<keyof typeof PROFILE_COLUMNS, string | number | null>>,
  nowIso: string,
): Promise<{ error: { message: string } | null }> {
  const row: Record<string, unknown> = { updated_at: nowIso };
  for (const [camel, snake] of Object.entries(PROFILE_COLUMNS)) {
    const v = (fields as Record<string, unknown>)[camel];
    if (v !== undefined) row[snake] = v;
  }
  const { error } = await supabase.from('profiles').upsert(row, { onConflict: 'user_id' });
  if (error) {
    console.error('saveProfile failed:', error.message);
    return { error: { message: error.message } };
  }
  return { error: null };
}

/**
 * Family sharing — thin wrapper over the `family-manage` edge function (same one
 * the web app's `invokeFamily` hits). The function identifies the caller from
 * their JWT, so a member's `leave` only ever touches their own membership: it
 * deletes the row, frees the owner's slot, and resets the member's metadata to
 * Free. `inviteId` is used by the owner-side `remove` action; it's accepted here
 * for parity but ignored by the server for `leave`.
 */
export type FamilyAction = 'leave' | 'remove' | 'disband' | 'schedule' | 'unschedule';

export async function familyManage(
  action: FamilyAction,
  inviteId?: string,
): Promise<{ data?: { ok?: boolean }; error?: { message: string } }> {
  const { data, error } = await supabase.functions.invoke('family-manage', {
    body: { action, inviteId },
  });
  if (error) return { error: { message: await readFnError(error, "Couldn't update the family.") } };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}
