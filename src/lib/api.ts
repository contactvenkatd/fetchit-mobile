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
