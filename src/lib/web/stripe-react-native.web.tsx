// WEB-ONLY stand-in for @stripe/stripe-react-native, swapped in by
// metro.config.js when bundling for web. The real package imports
// react-native native-component internals that don't exist on web, which
// crashes the whole web bundle (expo-router bundles every route). iOS/Android
// never resolve this file — they keep the real native SDK.
//
// Web only needs to reach chat and run a shopping search; card collection and
// Apple Pay are unavailable here. Calls resolve with Stripe's own `{ error }`
// shape so payment screens show a message instead of crashing.
import { Text } from 'react-native';

const unavailable = {
  error: { code: 'Failed', message: 'Card payments are not available on web. Use the iOS app.' },
};
const reject = async () => unavailable;

export const initStripe = async () => {};

export function StripeProvider({ children }: { children: React.ReactNode }) {
  return children;
}

export function CardForm() {
  return <Text>Card entry is not available on web. Use the iOS app.</Text>;
}

export function PlatformPayButton() {
  return null;
}

export const PlatformPay = {
  ButtonStyle: { White: 'White', Black: 'Black', WhiteOutline: 'WhiteOutline', Automatic: 'Automatic' },
  ButtonType: { Pay: 'Pay', SetUp: 'SetUp', Default: 'Default', Buy: 'Buy' },
  PaymentType: { Immediate: 'Immediate', Deferred: 'Deferred', Recurring: 'Recurring' },
};

export function useStripe() {
  return {
    isPlatformPaySupported: async () => false,
    confirmSetupIntent: reject,
    confirmPayment: reject,
    confirmPlatformPaySetupIntent: reject,
    confirmPlatformPayPayment: reject,
  };
}
