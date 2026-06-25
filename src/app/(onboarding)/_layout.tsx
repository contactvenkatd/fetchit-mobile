import { Stack } from 'expo-router';

import { Colors } from '@/theme/colors';

// The post-signup flow: plans → terms → delivery → name → chat. Every plan
// (Free or paid) walks the full sequence; the card + subscription work happens
// on the delivery step.
// Headers stay hidden; each step renders its own AuthLayout hero + card.
export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
      }}>
      <Stack.Screen name="plans" />
      <Stack.Screen name="terms" />
      <Stack.Screen name="delivery" />
      <Stack.Screen name="name" />
      <Stack.Screen name="payment-change" />
    </Stack>
  );
}
