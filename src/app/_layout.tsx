import { StripeProvider } from '@stripe/stripe-react-native';
import {
  DarkTheme,
  ThemeProvider,
  useRootNavigationState,
  useRouter,
} from 'expo-router';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { useEffect, useRef } from 'react';
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

// Pull the `token` out of an incoming deep link, whichever way the URL parses.
// A custom-scheme URL (`fetchitmobile://join-family?token=…`) can land with
// `join-family` as the path OR the hostname depending on the slashes, so check
// both and strip any leading slash.
function parseJoinToken(url: string): string | null {
  const parsed = Linking.parse(url);
  const route = (parsed.path ?? parsed.hostname ?? '').replace(/^\/+/, '');
  if (route !== 'join-family') return null;
  const raw = parsed.queryParams?.token;
  const token = Array.isArray(raw) ? raw[0] : raw;
  return token ? String(token) : null;
}

export default function RootLayout() {
  const router = useRouter();
  // `useRootNavigationState().key` is only set once the navigation tree has
  // mounted — navigating before that throws "navigate before mounting the Root
  // Layout". So we capture the deep-link token into a ref first (works even on a
  // cold start where the URL arrives before nav is ready) and consume it the
  // moment navigation becomes available. The ref also keeps the token alive
  // across the login redirect if the invitee isn't signed in yet.
  const navState = useRootNavigationState();
  const navReady = !!navState?.key;
  const pendingToken = useRef<string | null>(null);

  // Capture the token from both a warm event and a cold start.
  useEffect(() => {
    const handleUrl = ({ url }: { url: string }) => {
      const token = parseJoinToken(url);
      if (token) pendingToken.current = token;
    };
    const sub = Linking.addEventListener('url', handleUrl);
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });
    return () => sub.remove();
  }, []);

  // Once navigation is mounted, route any captured token to /join-family.
  useEffect(() => {
    if (!navReady) return;
    const token = pendingToken.current;
    if (!token) return;
    pendingToken.current = null;
    router.push({ pathname: '/join-family', params: { token } });
  }, [navReady, router]);

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
                {/* Public invite-acceptance landing (deep link target). Not in
                    the (app) group so it can run its own auth gate and bounce to
                    login when the invitee isn't signed in yet. */}
                <Stack.Screen
                  name="join-family"
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
