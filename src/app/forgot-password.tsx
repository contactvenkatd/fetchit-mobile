import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { gatewayForgotPassword } from '@/lib/nativeAuth';
import { Colors, FontSize, Spacing } from '@/theme/colors';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Forgot-password — request a reset link by email. Native port of the web app's
 * forgot-password sender (utils.js `sendPasswordReset`). Native uses the
 * attestation-gated auth gateway because the direct GoTrue endpoint requires
 * the project-wide CAPTCHA that React Native cannot render.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSend() {
    setError('');
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError('Please enter a valid email');
      return;
    }

    setLoading(true);
    const result = await gatewayForgotPassword(trimmed);
    setLoading(false);

    if (!result.ok) {
      const msg = result.message.toLowerCase();
      if (msg.includes('rate') || msg.includes('limit') || msg.includes('many')) {
        setError('Too many attempts. Please wait a minute and try again.');
      } else {
        setError(result.message || "Couldn't send the reset email. Please try again.");
      }
      return;
    }

    setSent(true);
  }

  // Success — a neutral confirmation. We say "if an account exists" rather than
  // "we sent it" so the screen never confirms whether the address is registered.
  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle="A password reset link is on its way"
        onBack={() => router.back()}
        footer={
          <View style={styles.footerRow}>
            <Text style={styles.footerText}>Back to </Text>
            <Link href="/login" replace style={styles.link}>
              Sign in
            </Link>
          </View>
        }>
        <View style={styles.sentCard}>
          <Text style={styles.sentEmoji}>📬</Text>
          <Text style={styles.sentText}>
            If an account exists for{' '}
            <Text style={styles.sentEmail}>{email.trim()}</Text>, we&apos;ve sent
            a link to reset your password. Check your inbox — and your spam
            folder, just in case.
          </Text>
        </View>

        <Button label="Back to Sign In" onPress={() => router.back()} />
        <Button
          label="Use a different email"
          variant="ghost"
          onPress={() => setSent(false)}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a reset link"
      onBack={() => router.back()}
      footer={
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>Remembered it? </Text>
          <Link href="/login" replace style={styles.link}>
            Sign in
          </Link>
        </View>
      }>
      <TextField
        label="Email"
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          if (error) setError('');
        }}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        autoFocus
        onSubmitEditing={handleSend}
        returnKeyType="send"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button label="Send Reset Link" onPress={handleSend} loading={loading} />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  error: { color: Colors.error, fontSize: FontSize.sm, textAlign: 'center' },
  footerRow: { flexDirection: 'row', alignItems: 'center' },
  footerText: { color: Colors.textMuted, fontSize: FontSize.sm },
  link: { color: Colors.yellow, fontSize: FontSize.sm, fontWeight: '700' },
  sentCard: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  sentEmoji: { fontSize: 40 },
  sentText: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  sentEmail: { color: Colors.text, fontWeight: '700' },
});
