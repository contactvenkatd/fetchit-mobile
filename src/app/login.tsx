import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { signIn } from '@/lib/auth';
import { Colors, FontSize, Spacing } from '@/theme/colors';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
    const { data, error: signInError } = await signIn(email.trim(), password);
    setLoading(false);

    if (signInError) {
      // Mirror the web app's friendly mapping of Supabase auth errors.
      const msg = signInError.message.toLowerCase();
      if (msg.includes('confirm') || msg.includes('not confirmed')) {
        setError('Please verify your email before signing in');
      } else {
        setError('Incorrect email or password');
      }
      return;
    }

    if (data.session) {
      // onAuthStateChange updates the context; route into the app.
      router.replace('/(app)/chat');
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to keep fetching deals"
      footer={
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>New to FetchIt? </Text>
          <Link href="/signup" replace style={styles.link}>
            Create an account
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
        placeholder="Your password"
        autoCapitalize="none"
        autoComplete="password"
        textContentType="password"
        secureToggle
        onSubmitEditing={handleLogin}
        returnKeyType="go"
      />

      <Pressable
        onPress={() => router.push('/login')}
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
  footerRow: { flexDirection: 'row', alignItems: 'center' },
  footerText: { color: Colors.textMuted, fontSize: FontSize.sm },
  link: { color: Colors.yellow, fontSize: FontSize.sm, fontWeight: '700' },
});
