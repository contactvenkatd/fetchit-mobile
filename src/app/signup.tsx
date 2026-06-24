import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { signUp } from '@/lib/auth';
import { Colors, FontSize } from '@/theme/colors';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
