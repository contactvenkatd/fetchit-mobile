import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { signUp } from '@/lib/auth';
import { Colors, FontSize, Spacing } from '@/theme/colors';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

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

    if (signUpError) {
      const msg = signUpError.message.toLowerCase();
      if (msg.includes('already') || msg.includes('registered')) {
        setError('An account already exists with this email. Please sign in.');
      } else {
        setError(signUpError.message);
      }
      return;
    }

    // Email verification is ON → signUp returns no session. Show the
    // "check your email" screen instead of advancing (web app parity).
    if (!data.session) {
      setSent(true);
      return;
    }
    // If confirmation were ever disabled, route straight into onboarding.
    router.replace('/(onboarding)/plans');
  }

  if (sent) {
    return (
      <Screen center>
        <View style={styles.confirm}>
          <Logo size={96} />
          <Text style={styles.confirmTitle}>Check your email 🐕</Text>
          <Text style={styles.confirmBody}>
            We sent a confirmation link to{'\n'}
            <Text style={styles.email}>{email.trim()}</Text>.{'\n'}Tap it to
            verify your account, then come back and sign in.
          </Text>
          <Button
            label="Back to sign in"
            variant="secondary"
            onPress={() => router.replace('/login')}
          />
        </View>
      </Screen>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start fetching deals in seconds"
      footer={
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Link href="/login" replace style={styles.link}>
            Sign in
          </Link>
        </View>
      }>
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

      <Text style={styles.legal}>
        By creating an account you agree to our{' '}
        <Link href="/tos" style={styles.legalLink}>
          Terms of Service
        </Link>{' '}
        and{' '}
        <Link href="/privacy-policy" style={styles.legalLink}>
          Privacy Policy
        </Link>
        .
      </Text>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  error: { color: Colors.error, fontSize: FontSize.sm, textAlign: 'center' },
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
  confirm: { alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg },
  confirmTitle: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: '800' },
  confirmBody: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  email: { color: Colors.text, fontWeight: '700' },
});
