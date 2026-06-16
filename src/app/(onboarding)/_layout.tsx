import { Stack } from 'expo-router';

import { Colors } from '@/theme/colors';

// The post-signup flow: plans → terms → delivery → name → chat.
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
    </Stack>
  );
}
