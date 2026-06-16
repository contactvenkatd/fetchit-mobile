import { useRouter } from 'expo-router';

import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';

// Step 1 of onboarding — choose a plan (Free / Plus / Pro / Max + Monthly/Annual).
// Stub: a real port renders the four pricing cards and routes paid plans through
// Stripe checkout. For now any choice advances to the TOS agreement step.
export default function PlansScreen() {
  const router = useRouter();
  return (
    <AuthLayout title="Choose your plan" subtitle="Pick the plan that fits — Free, Plus, Pro, or Max">
      <Button label="Continue with Free" onPress={() => router.push('/(onboarding)/terms')} />
      <Button
        label="See paid plans"
        variant="secondary"
        onPress={() => router.push('/(onboarding)/terms')}
      />
    </AuthLayout>
  );
}
