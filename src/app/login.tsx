import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';
import { GoogleButton } from '@/components/ui/GoogleButton';
import { TextField } from '@/components/ui/TextField';
import { supabase } from '@/lib/supabase';
import { Colors, FontSize, Spacing } from '@/theme/colors';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const router = useRouter();
  // Carried in when the user arrived from a family invite while logged out —
  // forwarded through OTP so we can resume accepting the invite after sign-in.
  const { joinToken } = useLocalSearchParams<{ joinToken?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

      const { error: authError } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      if (authError) {
        setGoogleLoading(false);
        setError('Could not sign in with Google. Please try again.');
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
    if (!password) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    const clean = email.trim();

    // 1. Verify the password is correct (this transiently signs the user in).
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: clean,
      password,
    });
    if (signInError) {
      setLoading(false);
      // Mirror the web app's friendly mapping of Supabase auth errors.
      const msg = signInError.message.toLowerCase();
      if (msg.includes('confirm') || msg.includes('not confirmed')) {
        setError('Please verify your email before signing in');
      } else {
        setError('Incorrect email or password');
      }
      return;
    }

    // 2. Drop that session — login completes only after the email code (2FA).
    await supabase.auth.signOut();

    // 3. Send the one-time code to an existing account (never create one here).
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: clean,
      options: { shouldCreateUser: false },
    });
    setLoading(false);

    if (otpError) {
      setError('Could not send a verification code. Please try again.');
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
      subtitle="Sign in to keep fetching deals"
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      footer={
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>New to FetchIt? </Text>
          <Link href="/signup" replace style={styles.link}>
            Create an account
          </Link>
        </View>
      }>
      <GoogleButton onPress={handleGoogle} loading={googleLoading} disabled={loading} />

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
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        autoCapitalize="none"
        autoComplete="password"
        textContentType="password"
        secureToggle
        onSubmitEditing={handleLogin}
        returnKeyType="go"
      />

      <Pressable
        onPress={() => router.push('/forgot-password')}
        hitSlop={6}
        style={styles.forgot}>
        <Text style={styles.forgotText}>Forgot password?</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button label="Sign In" onPress={handleLogin} loading={loading} />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  forgot: { alignSelf: 'flex-end' },
  forgotText: { color: Colors.textFaint, fontSize: FontSize.sm },
  error: { color: Colors.error, fontSize: FontSize.sm, textAlign: 'center' },
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
