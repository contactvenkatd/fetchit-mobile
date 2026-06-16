import { useRouter } from 'expo-router';

import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

// Step 3 — Delivery & Payment (the web app's /delivery-payment). Stub showing
// the shipping fields; a full port adds the Stripe CardField + SetupIntent flow
// (createSetupIntent → confirmSetupIntent → saveCard → saveProfile). Skippable.
export default function DeliveryScreen() {
  const router = useRouter();
  return (
    <AuthLayout title="Almost there! 🐕" subtitle="Where should we ship your orders?">
      <TextField label="Full name" placeholder="Jane Shopper" textContentType="name" />
      <TextField label="Address" placeholder="123 Main St" textContentType="fullStreetAddress" />
      <TextField label="City" placeholder="San Francisco" textContentType="addressCity" />
      <TextField label="ZIP" placeholder="94105" keyboardType="number-pad" textContentType="postalCode" />

      <Button label="Save and continue" onPress={() => router.push('/(onboarding)/name')} />
      <Button label="Skip for now" variant="ghost" onPress={() => router.push('/(onboarding)/name')} />
    </AuthLayout>
  );
}
