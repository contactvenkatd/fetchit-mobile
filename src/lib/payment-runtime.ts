import Constants from 'expo-constants';
import { initStripe } from '@stripe/stripe-react-native';
import { STRIPE_PUBLISHABLE_KEY } from './stripe';

export const PAYMENT_ENVIRONMENT = Constants.expoConfig!.extra!.paymentEnvironment;
export const SHOW_TEST_CARD_HELP = PAYMENT_ENVIRONMENT.appEnvironment !== 'production' &&
  STRIPE_PUBLISHABLE_KEY.startsWith('pk_test_');
export const PAYMENT_CONTEXT = `${PAYMENT_ENVIRONMENT.supabaseUrl}|${STRIPE_PUBLISHABLE_KEY}|platform`;
// Await this before rendering card collection: StripeProvider starts native
// initialization in an effect, but does not wait before rendering its children.
let initialization: Promise<void> | undefined;
export function ensureStripeReady() {
  initialization ??= initStripe({
    publishableKey: STRIPE_PUBLISHABLE_KEY,
    stripeAccountId: undefined,
    merchantIdentifier: 'merchant.ai.compreo.fetchit',
    urlScheme: 'fetchitmobile',
  }).catch(() => {
    initialization = undefined;
    throw new Error('Could not initialize secure card entry. Please restart FetchIt.');
  });
  return initialization;
}
export function paymentDiagnostics() {
  return [
    `Card setup v2 · ${Constants.expoConfig?.version ?? 'unknown'} (${Constants.platform?.ios?.buildNumber ?? Constants.platform?.android?.versionCode ?? 'development'})`,
    `Backend: ${PAYMENT_ENVIRONMENT.supabaseUrl}`,
    `Stripe: ${STRIPE_PUBLISHABLE_KEY.startsWith('pk_live_') ? 'live' : 'test'} · platform account`,
    __DEV__ ? 'Update: development bundle' : 'Update: embedded bundle (OTA disabled)',
  ].join('\n');
}
