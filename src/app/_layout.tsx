import { StripeProvider } from '@stripe/stripe-react-native';
import { DarkTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/lib/auth';
import { STRIPE_PUBLISHABLE_KEY } from '@/lib/stripe';
import { Colors } from '@/theme/colors';

// A FetchIt-flavored dark navigation theme so headers, backgrounds, and the
// back-swipe scene all sit on charcoal with yellow accents.
const FetchItTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Colors.yellow,
    background: Colors.background,
    card: Colors.background,
    text: Colors.text,
    border: Colors.border,
    notification: Colors.orange,
  },
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
          <AuthProvider>
            <ThemeProvider value={FetchItTheme}>
              <StatusBar style="light" />
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: Colors.background },
                  headerTintColor: Colors.yellow,
                  headerTitleStyle: { color: Colors.text },
                  contentStyle: { backgroundColor: Colors.background },
                }}>
                <Stack.Screen name="index" options={{ headerShown: false }} />
                {/* Auth screens: disable the back-swipe so the flow can't be
                    rewound by gesture (back buttons remain for intentional nav). */}
                <Stack.Screen
                  name="login"
                  options={{ headerShown: false, gestureEnabled: false }}
                />
                <Stack.Screen
                  name="signup"
                  options={{ headerShown: false, gestureEnabled: false }}
                />
                <Stack.Screen
                  name="otp"
                  options={{ headerShown: false, gestureEnabled: false }}
                />
                <Stack.Screen name="tos" options={{ title: 'Terms of Service' }} />
                <Stack.Screen
                  name="privacy-policy"
                  options={{ title: 'Privacy Policy' }}
                />
                {/* Authenticated areas: block the swipe-back gesture so a signed-in
                    user can't pop the group off the stack and land on an auth
                    screen still sitting underneath it. */}
                <Stack.Screen
                  name="(onboarding)"
                  options={{ headerShown: false, gestureEnabled: false }}
                />
                <Stack.Screen
                  name="(app)"
                  options={{ headerShown: false, gestureEnabled: false }}
                />
              </Stack>
            </ThemeProvider>
          </AuthProvider>
        </StripeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
