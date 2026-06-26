import { GoogleSignin } from '@react-native-google-signin/google-signin';
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

// Configure native Google Sign-In once, at app startup — `_layout` is the root
// and loads on launch, so this module-scope call runs a single time before any
// screen mounts (instead of re-configuring on every button press in login.tsx).
// `iosClientId` is the iOS OAuth client; its reversed form is the URL scheme set
// up by plugins/withGoogleSignIn.js. Keep the two in sync.
GoogleSignin.configure({
  iosClientId:
    '120830719857-cut021t8gjpeha2fbb58pa89fdaunt29.apps.googleusercontent.com',
  // Android: the native sheet returns an ID token whose audience is the *Web*
  // OAuth client, so `webClientId` is required there (iOS uses `iosClientId`).
  // Replace with the Web OAuth client ID, and add it (plus the Android client)
  // to Supabase → Auth → Providers → Google → Authorized Client IDs.
  webClientId:
    '120830719857-n4m35cvauufv3abloq60gu263h0v3kld.apps.googleusercontent.com',
});

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

// The route segment of a custom-scheme deep link. `fetchitmobile://<route>?…`
// can land with `<route>` as the path OR the hostname depending on the slashes,
// so check both and strip any leading slash.
function linkRoute(parsed: ReturnType<typeof Linking.parse>): string {
  return (parsed.path ?? parsed.hostname ?? '').replace(/^\/+/, '');
}

// Pull the `token` out of an incoming family-invite deep link
// (`fetchitmobile://join-family?token=…`).
function parseJoinToken(url: string): string | null {
  const parsed = Linking.parse(url);
  if (linkRoute(parsed) !== 'join-family') return null;
  const raw = parsed.queryParams?.token;
  const token = Array.isArray(raw) ? raw[0] : raw;
  return token ? String(token) : null;
}

// Tiny `a=b&c=d` parser (decodes values). Used for the URL *fragment*, which
// `Linking.parse` does not surface — the implicit-flow recovery tokens arrive
// there as `#access_token=…&refresh_token=…&type=recovery`.
function parseKeyVals(str: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of str.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = decodeURIComponent(eq >= 0 ? pair.slice(0, eq) : pair);
    if (k) out[k] = eq >= 0 ? decodeURIComponent(pair.slice(eq + 1)) : '';
  }
  return out;
}

// Pull the recovery credentials out of a password-reset deep link
// (`fetchitmobile://reset-password…`). Supabase can return these three ways and
// we handle all of them so the flow is robust to the client's auth `flowType`:
//   • implicit (this project's default): tokens in the URL hash fragment
//     `#access_token=…&refresh_token=…&type=recovery`
//   • PKCE: an authorization `?code=…` query param
//   • expired/used link: an `?error…`/`#error…` param
// Returns the params object to forward to /reset-password, or null if not a
// reset link. (Returned shape is always string→string so it's valid route params.)
function parseRecovery(url: string): Record<string, string> | null {
  const parsed = Linking.parse(url);
  if (linkRoute(parsed) !== 'reset-password') return null;

  const frag = parseKeyVals(url.includes('#') ? url.slice(url.indexOf('#') + 1) : '');
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.queryParams ?? {})) {
    query[k] = Array.isArray(v) ? (v[0] ?? '') : String(v ?? '');
  }

  const error =
    query.error_description || query.error_code || query.error ||
    frag.error_description || frag.error_code || frag.error;
  if (error) return { error };

  if (frag.access_token && frag.refresh_token) {
    return { access_token: frag.access_token, refresh_token: frag.refresh_token };
  }
  if (query.code) return { code: query.code };

  // A reset link with no usable credentials — still route to /reset-password so
  // it can show the "expired link" state rather than silently doing nothing.
  return { error: 'invalid_link' };
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
  const pendingRecovery = useRef<Record<string, string> | null>(null);

  // Capture the deep link from both a warm event and a cold start.
  useEffect(() => {
    const handleUrl = ({ url }: { url: string }) => {
      const recovery = parseRecovery(url);
      if (recovery) {
        pendingRecovery.current = recovery;
        return;
      }
      const token = parseJoinToken(url);
      if (token) pendingToken.current = token;
    };
    const sub = Linking.addEventListener('url', handleUrl);
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });
    return () => sub.remove();
  }, []);

  // Once navigation is mounted, route any captured deep link.
  useEffect(() => {
    if (!navReady) return;

    // Password recovery takes precedence and uses `replace`: we land on the
    // reset screen and let IT establish the recovery session, so no session
    // exists while index.tsx is mounted (which would otherwise redirect a
    // "logged-in" recovery straight to /chat). See reset-password.tsx.
    const recovery = pendingRecovery.current;
    if (recovery) {
      pendingRecovery.current = null;
      router.replace({ pathname: '/reset-password', params: recovery });
      return;
    }

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
                {/* Public forgot-password sender (request a reset-link email).
                    Back-swipe stays enabled so the user can return to login. */}
                <Stack.Screen
                  name="forgot-password"
                  options={{ headerShown: false }}
                />
                {/* Reset-link landing (deep link target). Block the back-swipe so
                    the recovery flow can't be rewound mid-way; the screen drives
                    its own navigation (→ /chat on success, → /login if expired). */}
                <Stack.Screen
                  name="reset-password"
                  options={{ headerShown: false, gestureEnabled: false }}
                />
                {/* Public invite-acceptance landing (deep link target). Not in
                    the (app) group so it can run its own auth gate and bounce to
                    login when the invitee isn't signed in yet. */}
                <Stack.Screen
                  name="join-family"
                  options={{ headerShown: false, gestureEnabled: false }}
                />
                <Stack.Screen
                  name="tos"
                  options={{
                    title: 'Terms of Service',
                    headerShown: true,
                    headerBackVisible: true,
                  }}
                />
                <Stack.Screen
                  name="privacy-policy"
                  options={{
                    title: 'Privacy Policy',
                    headerShown: true,
                    headerBackVisible: true,
                  }}
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
