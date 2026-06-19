import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth';
import { familyManage } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

// Family Sharing. The owner-side management UI is still a stub (ScreenPlaceholder
// below). What's built here is the MEMBER side: someone who joined another user's
// Max plan can exit it, which drops them back to Free and routes them to pick a
// new plan.
//
// Membership is detected from the member's OWN user_metadata
// (`plan === 'max_family'` + `family_owner_email`), set by the family-invite
// edge function on accept. We do NOT detect it by reading `family_members` from
// the client: that table's RLS only lets owners read their rows (auth.uid() =
// owner_id), so a member's own row isn't visible to them. We still attempt the
// row lookup (by `member_id`, the real column) to pass the record id to
// `familyManage('leave', …)`, but `leave` identifies the caller by JWT
// server-side and works with or without it.

type MemberState = {
  ownerEmail: string;
  recordId?: string;
};

export default function FamilySharingScreen() {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const [checking, setChecking] = useState(true);
  const [member, setMember] = useState<MemberState | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    let active = true;

    (async () => {
      const user = session?.user;
      if (!user) {
        if (active) setChecking(false);
        return;
      }

      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const isMember =
        String(meta.plan ?? '').toLowerCase() === 'max_family' &&
        Boolean(meta.family_owner_id || meta.family_owner_email);

      if (!isMember) {
        if (active) setChecking(false);
        return;
      }

      // Best-effort: fetch the membership row to recover its id for the leave
      // call. Blocked by RLS for members, so this typically returns null — leave
      // still works (the server resolves the caller from the JWT).
      const { data: memberRecord } = await supabase
        .from('family_members')
        .select('*')
        .eq('member_id', user.id)
        .maybeSingle();

      if (!active) return;
      setMember({
        ownerEmail: String(meta.family_owner_email ?? memberRecord?.member_email ?? 'the plan owner'),
        recordId: memberRecord?.id,
      });
      setChecking(false);
    })();

    return () => {
      active = false;
    };
  }, [authLoading, session]);

  async function exitFamily() {
    if (!member || exiting) return;
    setExiting(true);

    const { error } = await familyManage('leave', member.recordId);
    if (error) {
      setExiting(false);
      Alert.alert('Could not exit', error.message);
      return;
    }

    // The edge function already reset our metadata server-side, but mirror it
    // onto the local session immediately so getPlan() reflects Free before the
    // plans screen reads it.
    await supabase.auth.updateUser({ data: { plan: 'Free', plan_billing: null } });

    router.replace('/(onboarding)/plans');
  }

  function confirmExit() {
    Alert.alert(
      'Exit Family Plan',
      'Are you sure you want to exit this family plan? You will lose access immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Exit Family', style: 'destructive', onPress: exitFamily },
      ],
    );
  }

  if (authLoading || checking) {
    return (
      <Screen center>
        <ActivityIndicator color={Colors.yellow} />
      </Screen>
    );
  }

  // Not a family member → keep the existing owner-side placeholder.
  if (!member) {
    return (
      <ScreenPlaceholder
        emoji="👨‍👩‍👧"
        title="Family Sharing"
        description="Share your Max plan with up to 4 family members."
        bullets={[
          'Max owners only — others see an upgrade gate',
          'Invite members by email',
          'Remove members or disband the family',
          'Backed by the family_invites / family_members tables',
        ]}
      />
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.emoji}>👨‍👩‍👧</Text>
        <Text style={styles.title}>Family Sharing</Text>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>You're a family member</Text>
          <Text style={styles.cardBody}>
            You are part of <Text style={styles.owner}>{member.ownerEmail}</Text>'s family plan.
          </Text>
          <Text style={styles.cardNote}>
            Exiting drops you to the Free plan right away and lets you choose your own plan.
          </Text>
        </View>

        <Button
          label="Exit Family"
          variant="danger"
          loading={exiting}
          onPress={confirmExit}
          style={styles.exitButton}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xl,
  },
  emoji: { fontSize: 56 },
  title: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: '800' },
  card: {
    alignSelf: 'stretch',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  cardLabel: {
    color: Colors.yellow,
    fontSize: FontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardBody: { color: Colors.text, fontSize: FontSize.md, lineHeight: 22 },
  owner: { fontWeight: '700' },
  cardNote: { color: Colors.textMuted, fontSize: FontSize.sm, lineHeight: 20 },
  exitButton: { alignSelf: 'stretch', marginTop: Spacing.sm },
});
