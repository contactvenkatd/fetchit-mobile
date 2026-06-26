import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Colors, FontSize, Spacing } from '@/theme/colors';

// In-app change password for a logged-in user. Native port of the web app's
// account "Change password" section (see fetchit-app utils.js
// `requestPasswordChange` / `applyNewPassword`).
//
// DEVIATION from web: the web flow is email-confirmed (verify current password
// → email a link → set the new password in the recovery session). This mobile
// screen does it directly per spec: verify the current password, then update.
//
// NOTE: Supabase's `updateUser({ password })` does NOT verify the current
// password on its own, so we re-authenticate with `signInWithPassword` first
// (exactly what the web `requestPasswordChange` does). That reauth call is
// captcha-gated on this project, so this flow won't complete until captcha is
// resolved — same dependency as the forgot-password flow.

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const email = session?.user?.email ?? '';

  // Google-only accounts have no password identity — there's nothing to change.
  // Default to "has password" if identities are absent so we never wrongly block.
  const hasPassword =
    session?.user?.identities?.some((i) => i.provider === 'email') ?? true;

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  function clearError() {
    if (error) setError('');
  }

  async function handleSave() {
    setError('');
    if (!email) {
      setError("You're not signed in.");
      return;
    }
    if (newPw.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (newPw !== confirmPw) {
      setError("New passwords don't match");
      return;
    }
    if (newPw === currentPw) {
      setError('New password must be different from your current one');
      return;
    }

    setSaving(true);

    // 1. Re-authenticate — confirm the current password is correct, since
    //    updateUser won't check it. A failure here is almost always a wrong
    //    current password.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPw,
    });
    if (reauthError) {
      setSaving(false);
      setError('Current password is incorrect.');
      return;
    }

    // 2. Set the new password on the (now freshly re-authenticated) session.
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPw,
    });
    setSaving(false);
    if (updateError) {
      setError(updateError.message || "Couldn't update your password.");
      return;
    }

    setDone(true);
  }

  // Google-only user — no password to change.
  if (!hasPassword) {
    return (
      <AuthLayout
        title="No password to change"
        subtitle="You signed in with Google"
        onBack={() => router.back()}>
        <View style={styles.centerCard}>
          <Text style={styles.emoji}>🔐</Text>
          <Text style={styles.bodyText}>
            Your account uses Google Sign-In, so there&apos;s no FetchIt password
            to change. Manage your password in your Google account instead.
          </Text>
        </View>
        <Button label="Back to Account" onPress={() => router.replace('/(app)/account')} />
      </AuthLayout>
    );
  }

  // Success.
  if (done) {
    return (
      <AuthLayout title="Password updated! 🐕" subtitle="Your new password is set">
        <View style={styles.centerCard}>
          <Text style={styles.emoji}>✅</Text>
          <Text style={styles.bodyText}>
            Use your new password next time you sign in.
          </Text>
        </View>
        <Button
          label="Back to Account"
          onPress={() => router.replace('/(app)/account')}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Change password"
      subtitle="Update the password for your account"
      onBack={() => router.back()}>
      <TextField
        label="Current password"
        value={currentPw}
        onChangeText={(t) => {
          setCurrentPw(t);
          clearError();
        }}
        placeholder="Your current password"
        autoCapitalize="none"
        autoComplete="password"
        textContentType="password"
        secureToggle
      />
      <TextField
        label="New password"
        value={newPw}
        onChangeText={(t) => {
          setNewPw(t);
          clearError();
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
          clearError();
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

      <Button label="Update Password" onPress={handleSave} loading={saving} />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  error: { color: Colors.error, fontSize: FontSize.sm, textAlign: 'center' },
  centerCard: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  emoji: { fontSize: 40 },
  bodyText: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
});
