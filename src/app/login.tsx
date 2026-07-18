import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';
import { GoogleButton } from '@/components/ui/GoogleButton';
import { TextField } from '@/components/ui/TextField';
import { gatewayLogin } from '@/lib/nativeAuth';
import { supabase } from '@/lib/supabase';
import { Colors, FontSize, Spacing } from '@/theme/colors';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const router = useRouter();
  // Carried in when the user arrived from a family invite while logged out —
  // forwarded through OTP so we can resume accepting the invite after sign-in.
  const { joinToken } = useLocalSearchParams<{ joinToken?: string }>();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // "Continue with Google" — native, fully in-app sign-in. The Google SDK
  // presents its own sheet, returns an ID token, and we hand that straight to
  // Supabase (signInWithIdToken) — no browser round-trip or deep link.
  // GoogleSignin.configure() runs once at startup in src/app/_layout.tsx.
  async function handleGoogle() {
    setError('');
    setGoogleLoading(true);
    try {
      const response = await GoogleSignin.signIn();
      // google-signin v13+ wraps the result as { type, data }; older versions
      // returned the user object directly. Read the ID token from either shape.
      const idToken =
        (response as { data?: { idToken?: string | null } }).data?.idToken ??
        (response as { idToken?: string | null }).idToken ??
        null;

      if (!idToken) {
        // No token (e.g. the user dismissed the sheet) — fail quietly.
        setGoogleLoading(false);
        return;
      }

      const { data: authData, error: authError } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      if (authError) {
        setGoogleLoading(false);
        setError('Could not sign in with Google. Please try again.');
        return;
      }

      const user = authData?.user;
      const isNewUser = user && Math.abs(new Date(user.created_at).getTime() - new Date(user.last_sign_in_at ?? user.created_at).getTime()) < 5000;
      console.log('google_debug', 'created_at:', user?.created_at, 'last_sign_in_at:', user?.last_sign_in_at, 'isNewUser:', isNewUser);
      if (isNewUser) {
        await supabase.auth.signOut();
        setGoogleLoading(false);
        setError('No account found for this Google email. Please sign up first.');
        return;
      }

      setGoogleLoading(false);
      router.replace('/(app)/chat');
    } catch (e) {
      setGoogleLoading(false);
      // User-cancelled (closed the sheet) is not an error worth surfacing.
      if ((e as { code?: string })?.code === statusCodes.SIGN_IN_CANCELLED) {
        return;
      }
      setError('Could not sign in with Google. Please try again.');
    }
  }

  async function handleLogin() {
    setError('');
    if (!EMAIL_RE.test(email)) {
      setError('Please enter a valid email');
      return;
    }

    setLoading(true);
    const clean = email.trim();

    // Native login is passwordless: the attestation-gated auth-gateway verifies
    // the device and emails a one-time code to the existing account (project
    // CAPTCHA is on, so RN can't call GoTrue's signInWithOtp directly). The
    // email code + device attestation are the sign-in factors.
    const res = await gatewayLogin(clean);
    setLoading(false);

    if (!res.ok) {
      if (res.code === 'no_account') {
        setError('No account found for this email. Create one first.');
      } else {
        setError(res.message);
      }
      return;
    }

    router.push({
      pathname: '/otp',
      params: {
        email: clean,
        mode: 'login',
        // Preserve the invite token across the OTP step so login can resume the
        // family-invite accept once the code is verified.
        ...(joinToken ? { joinToken } : {}),
      },
    });
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Enter your email and we'll send a sign-in code"
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      footer={
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>New to FetchIt? </Text>
          <Link href="/signup" replace style={styles.link}>
            Create an account
          </Link>
        </View>
      }>
      <GoogleButton onPress={handleGoogle} loading={googleLoading} />

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        onSubmitEditing={handleLogin}
        returnKeyType="go"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button label="Send sign-in code" onPress={handleLogin} loading={loading} />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  error: { color: Colors.error, fontSize: FontSize.sm, textAlign: 'center' },
  googleDisabled: { color: Colors.textFaint, fontSize: FontSize.xs, textAlign: 'center' },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginVertical: Spacing.xs,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { color: Colors.textFaint, fontSize: FontSize.sm },
  footerRow: { flexDirection: 'row', alignItems: 'center' },
  footerText: { color: Colors.textMuted, fontSize: FontSize.sm },
  link: { color: Colors.yellow, fontSize: FontSize.sm, fontWeight: '700' },
});
