import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Logo } from '@/components/ui/Logo';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Colors, FontSize, Spacing } from '@/theme/colors';

// Family invite acceptance — the landing screen for a `join-family?token=…`
// deep link (routed here from the root layout's link handler).
//
// Flow:
//   1. Show a spinner immediately.
//   2. Wait for the auth session to resolve. The deep link can fire before
//      AuthProvider has restored the cached session, so we poll up to ~5s
//      (10 × 500ms) rather than treating an early "no session" as logged-out.
//   3. Session present  → call the `family-invite` edge function with
//      { action: 'accept', token }. The function creates the family_members row
//      and sets THIS user's plan to max_family server-side. We mirror the plan
//      locally, show a success message, then land in chat.
//   3b. No session after the wait → bounce to /login carrying the token as
//      `joinToken` so login can resume the accept once the user signs in.
//   4. Any failure → inline error (invalid / expired / full / not pending).

type Phase = 'loading' | 'success' | 'error';

const MAX_WAIT_ATTEMPTS = 10; // × 500ms ≈ 5s for auth to resolve
const SUCCESS_REDIRECT_MS = 1200;

// Edge-function errors carry a generic `.message`; the real reason lives either
// on `data.error` (rare) or the Response stashed at `error.context`. Dig it out.
async function fnErrorMessage(
  error: unknown,
  data: unknown,
  fallback: string,
): Promise<string> {
  const d = data as { error?: string } | null;
  if (d?.error) return d.error;
  const e = error as {
    message?: string;
    context?: { json?: () => Promise<unknown> };
  };
  try {
    const body = (await e?.context?.json?.()) as { error?: string } | undefined;
    if (body?.error) return body.error;
  } catch {
    /* fall through to the generic message */
  }
  return e?.message || fallback;
}

export default function JoinFamilyScreen() {
  const router = useRouter();
  const { session, loading } = useAuth();

  const rawToken = useLocalSearchParams<{ token?: string }>().token;
  const token = typeof rawToken === 'string' ? rawToken : '';

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [attempts, setAttempts] = useState(0);

  // Guard so the accept call fires exactly once even if the effect re-runs.
  const startedRef = useRef(false);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    },
    [],
  );

  useEffect(() => {
    // A malformed/empty link can never be accepted.
    if (!token) {
      setErrorMsg('This invite link is invalid or has expired.');
      setPhase('error');
      return;
    }

    // Still resolving the cached session — keep the spinner up.
    if (loading) return;

    if (session) {
      acceptInvite();
      return;
    }

    // No session yet. Poll a few times in case AuthProvider is mid-restore…
    if (attempts < MAX_WAIT_ATTEMPTS) {
      const t = setTimeout(() => setAttempts((a) => a + 1), 500);
      return () => clearTimeout(t);
    }

    // …still nothing → send to login, preserving the token to resume after.
    router.replace({ pathname: '/login', params: { joinToken: token } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, loading, attempts, token]);

  async function acceptInvite() {
    if (startedRef.current) return;
    startedRef.current = true;
    setPhase('loading');
    setErrorMsg('');

    const { data, error } = await supabase.functions.invoke('family-invite', {
      body: { action: 'accept', token },
    });

    if (error || (data as { error?: string })?.error) {
      const message = await fnErrorMessage(
        error,
        data,
        "We couldn't accept this invite. Please try again.",
      );
      setErrorMsg(message);
      setPhase('error');
      return;
    }

    // The edge function already set plan=max_family + family_owner_* server-side;
    // mirror the plan onto the local session so getPlan() reflects it right away
    // (updateUser MERGES into user_metadata, so the owner fields are preserved).
    await supabase.auth.updateUser({ data: { plan: 'max_family' } });

    setPhase('success');
    redirectTimer.current = setTimeout(() => {
      router.replace('/(app)/chat');
    }, SUCCESS_REDIRECT_MS);
  }

  return (
    <Screen center>
      <View style={styles.content}>
        <Logo size={72} />

        {phase === 'loading' ? (
          <>
            <Text style={styles.title}>Joining the family plan…</Text>
            <ActivityIndicator color={Colors.yellow} style={styles.spinner} />
          </>
        ) : phase === 'success' ? (
          <>
            <Text style={styles.emoji}>🎉</Text>
            <Text style={styles.title}>You&apos;ve joined the family plan!</Text>
            <Text style={styles.subtitle}>
              You now have full Max-level access. Taking you to FetchIt…
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.emoji}>😕</Text>
            <Text style={styles.title}>Couldn&apos;t join the family</Text>
            <Text style={styles.error}>{errorMsg}</Text>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  emoji: { fontSize: 48 },
  title: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  spinner: { marginTop: Spacing.sm },
  error: {
    color: Colors.error,
    fontSize: FontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
});
