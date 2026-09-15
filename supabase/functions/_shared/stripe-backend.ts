import Stripe from 'npm:stripe@17.7.0';
import type { SupabaseClient, User } from 'npm:@supabase/supabase-js@2';

export class PaymentConfigurationError extends Error {}

export function stripeIsLive() {
  return Deno.env.get('STRIPE_SECRET_KEY')?.trim()?.startsWith('sk_live_') === true;
}

export function paymentStripe() {
  const key = Deno.env.get('STRIPE_SECRET_KEY')?.trim();
  if (!key || !/^sk_(live|test)_/.test(key)) throw new PaymentConfigurationError('Payments are not configured.');
  if (new URL(Deno.env.get('SUPABASE_URL') || 'http://localhost').hostname === 'fpphpncruohjlppqhfep.supabase.co' && !stripeIsLive()) {
    throw new PaymentConfigurationError('Production payments require a live backend key.');
  }
  // Pin the response shape used by the existing web/mobile invoice flow.
  return new Stripe(key, { apiVersion: '2025-02-24.acacia' });
}

export async function resolveCustomer(admin: SupabaseClient, stripe: Stripe, user: User, create: boolean): Promise<string> {
  const mode = stripeIsLive() ? 'live' : 'test';
  const mappings = user.app_metadata.stripe_customers ?? {};
  const previous = user.user_metadata.stripe_customer_id;
  const candidate = mappings[mode] || previous;
  let customer: Stripe.Customer | null = null;
  if (candidate) {
    try {
      const found = await stripe.customers.retrieve(candidate);
      if (!found.deleted) {
        if (found.metadata.supabase_uid !== user.id || found.livemode !== stripeIsLive()) {
          throw new PaymentConfigurationError('The saved customer does not belong to this account and environment.');
        }
        customer = found;
      }
    } catch (error) {
      // A missing object may be from test mode. Network/auth failures are not
      // evidence of a missing customer and must never create duplicates.
      if ((error as { code?: string }).code !== 'resource_missing') throw error;
    }
  }
  if (!customer) {
    if (!create) throw new PaymentConfigurationError('Save a new card for the live payment environment first.');
    customer = await stripe.customers.create({
      email: user.email, metadata: { supabase_uid: user.id },
    }, { idempotencyKey: `fetchit-customer-${mode}-${user.id}-${candidate || 'initial'}` });
  }
  if (previous !== customer.id || mappings[mode] !== customer.id) {
    // Archive previous references before switching; do not delete test records.
    const history = [...new Set([...(user.app_metadata.stripe_customer_history ?? []), previous].filter(Boolean))];
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { ...user.app_metadata, stripe_customers: { ...mappings, [mode]: customer.id }, stripe_customer_history: history },
      user_metadata: { ...user.user_metadata, stripe_customer_id: customer.id },
    });
    if (error) throw new Error('Customer mapping could not be saved');
  }
  return customer.id;
}
