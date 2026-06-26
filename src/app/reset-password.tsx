import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { supabase } from '@/lib/supabase';
import { Colors, FontSize, Spacing } from '@/theme/colors';

// Step 2 of the forgot-password flow: the user tapped the reset link in their
// email, the root deep-link handler (src/app/_layout.tsx) routed them here with
// the recovery credentials, and this screen turns those into a session and lets
// them set a new password. Native port of the web app's ResetPasswordPage.js.
//
// We establish the recovery session HERE (not in the deep-link handler) on
// purpose: the common case is a logged-out user, so no session exists while the
// landing screen (index.tsx) is mounted — which keeps its "logged-in → /chat"
// redirect from racing us off this screen. By the time `setSession` fires, the
// handler has already `replace`d index with this route.

type Phase = 'verifying' | 'ready' | 'invalid' | 'saving' | 'done';

export default function ResetPasswordScreen() {
  const router = useRouter();
  // Forwarded by the deep-link handler: implicit-flow tokens, a PKCE `code`, or
  // an `error` (e.g. an expired/used link).
  const params = useLocalSearchParams<{
    access_token?: string;
    refresh_token?: string;
    code?: string;
    error?: string;
  }>();

  const [phase, setPhase] = useState<Phase>('verifying');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState('');

  // Establish the recovery session exactly once, even if params re-emit.
  const established = useRef(false);
  // Cancel the post-success auto-redirect timer on unmount.
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (established.current) return;
    established.current = true;

    (async () => {
      // Expired/used link — Supabase reported an error instead of credentials.
      if (params.error) {
        setPhase('invalid');
        return;
      }
      try {
        if (params.access_token && params.refresh_token) {
          // Implicit flow (this project's default): set the session directly.
          const { error: e } = await supabase.auth.setSession({
            access_token: String(params.access_token),
            refresh_token: String(params.refresh_token),
          });
          if (e) throw e;
        } else if (params.code) {
          // PKCE flow: exchange the code (verifier is in our SecureStore).
          const { error: e } = await supabase.auth.exchangeCodeForSession(
            String(params.code),
          );
          if (e) throw e;
        } else {
          // No credentials in the link — only valid if a recovery session was
          // somehow already established; otherwise the link is unusable.
          const { data } = await supabase.auth.getSession();
          if (!data.session) {
            setPhase('invalid');
            return;
          }
        }
        setPhase('ready');
      } catch {
        setPhase('invalid');
      }
    })();
  }, [params]);

  useEffect(
    () => () => {
      if (doneTimer.current) clearTimeout(doneTimer.current);
    },
    [],
  );

  async function handleSave() {
    setError('');
    if (newPw.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (newPw !== confirmPw) {
      setError("Passwords don't match");
      return;
    }

    setPhase('saving');
    const { error: e } = await supabase.auth.updateUser({ password: newPw });
    if (e) {
      setPhase('ready');
      setError(e.message || "Couldn't update your password. Please try again.");
      return;
    }

    // The recovery session is now a full session — head into the app. Show a
    // brief confirmation first, with a manual button in case the timer is missed.
    setPhase('done');
    doneTimer.current = setTimeout(() => router.replace('/(app)/chat'), 1400);
  }

  // --- Verifying the link ----------------------------------------------------
  if (phase === 'verifying') {
    return (
      <AuthLayout title="One moment" subtitle="Verifying your reset link…">
        <View style={styles.centerCard}>
          <ActivityIndicator color={Colors.yellow} />
        </View>
      </AuthLayout>
    );
  }

  // --- Expired / invalid link ------------------------------------------------
  if (phase === 'invalid') {
    return (
      <AuthLayout
        title="This link has expired"
        subtitle="Password reset links are single-use and time-limited"
        onBack={() => router.replace('/login')}
        footer={
          <View style={styles.footerRow}>
            <Text style={styles.footerText}>Back to </Text>
            <Link href="/login" replace style={styles.link}>
              Sign in
            </Link>
          </View>
        }>
        <View style={styles.centerCard}>
          <Text style={styles.emoji}>⏰</Text>
          <Text style={styles.bodyText}>
            Request a fresh link and we&apos;ll email you a new one.
          </Text>
        </View>
        <Button
          label="Request a new link"
          onPress={() => router.replace('/forgot-password')}
        />
      </AuthLayout>
    );
  }

  // --- Success ---------------------------------------------------------------
  if (phase === 'done') {
    return (
      <AuthLayout title="Password updated! 🐕" subtitle="You're all set">
        <View style={styles.centerCard}>
          <Text style={styles.emoji}>✅</Text>
          <Text style={styles.bodyText}>Taking you to your chat…</Text>
        </View>
        <Button
          label="Continue to FetchIt"
          onPress={() => router.replace('/(app)/chat')}
        />
      </AuthLayout>
    );
  }

  // --- Set new password (phase: 'ready' | 'saving') --------------------------
  return (
    <AuthLayout
      title="Set your new password"
      subtitle="Choose a new password for your account">
      <TextField
        label="New password"
        value={newPw}
        onChangeText={(t) => {
          setNewPw(t);
          if (error) setError('');
        }}
        placeholder="At least 8 characters"
        autoCapitalize="none"
        autoComplete="password-new"
        textContentType="newPassword"
        secureToggle
      />
      <TextField
        label="Confirm new password"
        value={confirmPw}
        onChangeText={(t) => {
          setConfirmPw(t);
          if (error) setError('');
        }}
        placeholder="Re-enter new password"
        autoCapitalize="none"
        autoComplete="password-new"
        textContentType="newPassword"
        secureToggle
        onSubmitEditing={handleSave}
        returnKeyType="go"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label="Set New Password"
        onPress={handleSave}
        loading={phase === 'saving'}
      />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  error: { color: Colors.error, fontSize: FontSize.sm, textAlign: 'center' },
  footerRow: { flexDirection: 'row', alignItems: 'center' },
  footerText: { color: Colors.textMuted, fontSize: FontSize.sm },
  link: { color: Colors.yellow, fontSize: FontSize.sm, fontWeight: '700' },
  centerCard: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  emoji: { fontSize: 40 },
  bodyText: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
});
