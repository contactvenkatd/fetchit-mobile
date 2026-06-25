import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';
import { GoogleButton } from '@/components/ui/GoogleButton';
import { TextField } from '@/components/ui/TextField';
import { isRegistered, signUp } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Colors, FontSize, Spacing } from '@/theme/colors';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // "Continue with Google" — native, fully in-app sign-in (same flow as the
  // login screen). The Google SDK presents its own sheet, returns an ID token,
  // and we hand that straight to Supabase (signInWithIdToken) — no browser
  // round-trip. GoogleSignin.configure() runs once at startup in _layout.tsx.
  // Google auto-creates the auth user on first sign-in, so we branch on the
  // `fetchit_registered` flag: a returning account that already finished
  // onboarding goes to chat; a brand-new account runs onboarding first.
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

      const { data, error: authError } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      if (authError) {
        setGoogleLoading(false);
        setError('Could not sign in with Google. Please try again.');
        return;
      }

      setGoogleLoading(false);
      // Existing (registered) account → straight to chat; new account → onboarding.
      router.replace(
        isRegistered(data.session) ? '/(app)/chat' : '/(onboarding)/plans',
      );
    } catch (e) {
      setGoogleLoading(false);
      // User-cancelled (closed the sheet) is not an error worth surfacing.
      if ((e as { code?: string })?.code === statusCodes.SIGN_IN_CANCELLED) {
        return;
      }
      setError('Could not sign in with Google. Please try again.');
    }
  }

  async function handleSignup() {
    setError('');
    if (!EMAIL_RE.test(email)) {
      setError('Please enter a valid email');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    const { data, error: signUpError } = await signUp(email.trim(), password);
    setLoading(false);

    console.log('signUp data:', JSON.stringify(data));
    console.log('signUp error:', JSON.stringify(signUpError));

    if (signUpError) {
      const msg = signUpError.message.toLowerCase();
      if (msg.includes('already') || msg.includes('registered')) {
        setError('An account already exists with this email. Please sign in.');
      } else {
        setError(signUpError.message);
      }
      return;
    }

    // Email verification is ON → signUp returns no session. Send the user to
    // the OTP screen to enter the 8-digit code from their email.
    if (!data.session) {
      router.push({
        pathname: '/otp',
        params: { email: email.trim(), mode: 'signup' },
      });
      return;
    }
    // If confirmation were ever disabled, route straight into onboarding.
    router.replace('/(onboarding)/plans');
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start fetching deals in seconds"
      onBack={() => router.replace('/')}
      footer={
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Link href="/login" replace style={styles.link}>
            Sign in
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
        placeholder="At least 8 characters"
        autoCapitalize="none"
        autoComplete="password-new"
        textContentType="newPassword"
        secureToggle
        onSubmitEditing={handleSignup}
        returnKeyType="go"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button label="Create Account" onPress={handleSignup} loading={loading} />

      {/* Inline legal links use Text onPress (not nested expo-router <Link>):
          a <Link> nested inside a <Text> installs its own press/gesture handler
          that conflicts with the parent Text's native text-press handling on
          iOS, which can swallow touches across this subtree (the cause of the
          unresponsive-buttons issue). Plain Text onPress navigates the same way
          without a nested gesture handler. */}
      <Text style={styles.legal}>
        By creating an account you agree to our{' '}
        <Text style={styles.legalLink} onPress={() => router.push('/tos')}>
          Terms of Service
        </Text>{' '}
        and{' '}
        <Text
          style={styles.legalLink}
          onPress={() => router.push('/privacy-policy')}>
          Privacy Policy
        </Text>
        .
      </Text>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
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
  legal: {
    color: Colors.textFaint,
    fontSize: FontSize.xs,
    textAlign: 'center',
    lineHeight: 18,
  },
  legalLink: { color: Colors.textMuted, textDecorationLine: 'underline' },
});
