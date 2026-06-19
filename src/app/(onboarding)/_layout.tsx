import { Stack } from 'expo-router';

import { Colors } from '@/theme/colors';

// The post-signup flow. Free plans skip the card step (plans → chat); paid plans
// route through payment (plans → payment → chat). The terms/delivery/name steps
// remain registered for the fuller flow.
// Headers stay hidden; each step renders its own AuthLayout hero + card.
export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
      }}>
      <Stack.Screen name="plans" />
      <Stack.Screen name="payment" />
      <Stack.Screen name="terms" />
      <Stack.Screen name="delivery" />
      <Stack.Screen name="name" />
    </Stack>
  );
}
