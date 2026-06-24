import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth';
import { Colors } from '@/theme/colors';

// Protected group — every screen here requires a session. While the cached
// session resolves we hold on a spinner; with no session we bounce to /login
// (the web app's protected-route guard).
export default function AppLayout() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <Screen center>
        <ActivityIndicator color={Colors.yellow} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/login" />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.yellow,
        headerTitleStyle: { color: Colors.text },
        contentStyle: { backgroundColor: Colors.background },
      }}>
      <Stack.Screen name="chat" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen
        name="account"
        options={{ title: 'Account Settings', headerShown: true, headerBackVisible: true }}
      />
      <Stack.Screen
        name="order-history"
        options={{ title: 'Order History', headerShown: true, headerBackVisible: true }}
      />
      <Stack.Screen
        name="orders"
        options={{ title: 'Orders & Analytics', headerShown: true, headerBackVisible: true }}
      />
      <Stack.Screen
        name="wishlist"
        options={{ title: 'Wishlist', headerShown: true, headerBackVisible: true }}
      />
      <Stack.Screen
        name="auto-reorder"
        options={{ title: 'Auto-Reorder', headerShown: true, headerBackVisible: true }}
      />
      <Stack.Screen
        name="family-sharing"
        options={{ title: 'Family Sharing', headerShown: true, headerBackVisible: true }}
      />
      <Stack.Screen
        name="cards-address"
        options={{ title: 'Cards & Address', headerShown: true, headerBackVisible: true }}
      />
    </Stack>
  );
}
