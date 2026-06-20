import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { getPlan, useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

// Family Sharing — full port of the web app's FamilySharingPage.js.
//
// Three audiences, gated on the effective plan (getPlan honors the web's grace
// periods):
//   • Max OWNER (getPlan === 'Max')        → manage up to 4 slots + disband.
//   • Family MEMBER (getPlan === 'max_family') → read-only "you're covered" + leave.
//   • Everyone else                        → upgrade gate.
//
// DATA MODEL (matches the web): the owner's slots are ALL derived from the
// `family_invites` table, split on `status`:
//   • status 'accepted' → an active MEMBER (also has a family_members row)
//   • status 'pending'  → an outstanding INVITE
// Remove (member) and Cancel (invite) both call family-manage `remove` with the
// `family_invites` row id (`inviteId`) — that is the id the edge function looks
// up (`.eq('id', inviteId)`), for both cases.
//
// CRITICAL: the owner's plan is NEVER touched by any family action — remove /
// disband only downgrade MEMBERS (server-side, in the family-manage edge
// function). The owner keeps Max. Only `leave` (member) flips the caller's plan.

const MAX_FAMILY_SLOTS = 4;

// The web app's production origin. Used as `appOrigin` for `send-family-invite`,
// which builds the invite email's join link (`${appOrigin}/join-family?token=…`).
// RN has no window.location, so this is the web equivalent. MUST be a real,
// absolute origin or the emailed link will be broken. If the web app isn't
// deployed yet, swap this for the local dev URL ('http://localhost:3000').
const WEB_APP_ORIGIN = 'https://fetchit-app.vercel.app';

// Pragmatic email check, mirrors the web utils isValidEmail.
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

// A row from the `family_invites` table (the owner's slot source of truth).
type InviteRow = {
  id: string;
  invitee_email?: string | null;
  status?: string | null;
  created_at?: string | null;
};

function inviteEmailOf(row: InviteRow): string {
  return row.invitee_email || 'Member';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function FamilySharingScreen() {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();

  // Owner check honors the grace period (getPlan → Free once a cancel date
  // passes). 'max_family' isn't in the PlanName type but is a real runtime value,
  // so read the member plan straight off the raw metadata, case-insensitively.
  const rawPlan = String(
    (session?.user?.user_metadata as { plan?: string } | undefined)?.plan ?? '',
  ).toLowerCase();
  const isOwner = getPlan(session) === 'Max';
  const isMember = !isOwner && rawPlan === 'max_family';

  // ---- Owner state ----
  const [members, setMembers] = useState<InviteRow[]>([]); // accepted invites
  const [pending, setPending] = useState<InviteRow[]>([]); // pending invites
  const [fetching, setFetching] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [sending, setSending] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [disbanding, setDisbanding] = useState(false);

  // ---- Member state ----
  const [leaving, setLeaving] = useState(false);

  const ownerId = session?.user?.id;
  const slotsUsed = members.length + pending.length;
  const canInvite = slotsUsed < MAX_FAMILY_SLOTS;

  // Load the owner's accepted members AND pending invites from `family_invites`,
  // split by status. Two scoped queries (the explicit pending query the spec
  // asks for, plus its accepted counterpart) run in parallel.
  const loadFamily = useCallback(async () => {
    if (!ownerId) return;
    setFetching(true);
    setLoadError('');
    const [acceptedRes, pendingRes] = await Promise.all([
      supabase
        .from('family_invites')
        .select('*')
        .eq('owner_id', ownerId)
        .eq('status', 'accepted'),
      supabase
        .from('family_invites')
        .select('*')
        .eq('owner_id', ownerId)
        .eq('status', 'pending'),
    ]);
    const err = acceptedRes.error || pendingRes.error;
    if (err) {
      setLoadError(err.message || 'Could not load your family.');
      setMembers([]);
      setPending([]);
    } else {
      setMembers((acceptedRes.data as InviteRow[]) ?? []);
      setPending((pendingRes.data as InviteRow[]) ?? []);
    }
    setFetching(false);
  }, [ownerId]);

  useEffect(() => {
    if (authLoading) return;
    if (isOwner) loadFamily();
    else setFetching(false);
  }, [authLoading, isOwner, loadFamily]);

  // ---- Owner actions ----
  async function sendInvite() {
    if (sending) return;
    setInviteError('');
    // Body matches the web's sendFamilyInvite exactly: { email (trimmed),
    // appOrigin }. Goes to `send-family-invite` (mints a token, inserts the
    // family_invites row, emails the invitee) — NOT `family-invite`, which is the
    // token-based join flow and rejects a tokenless call with "Missing invite
    // token."
    const email = inviteEmail.trim();
    if (!isValidEmail(email)) {
      setInviteError('Please enter a valid email.');
      return;
    }
    setSending(true);
    const { data, error } = await supabase.functions.invoke('send-family-invite', {
      body: { email, appOrigin: WEB_APP_ORIGIN },
    });
    setSending(false);

    const message = error?.message || (data as { error?: string })?.error;
    if (message) {
      setInviteError(message);
      return;
    }

    // Success: clear the input and refresh both lists so the new pending invite
    // shows up immediately.
    setInviteEmail('');
    loadFamily();
  }

  // Remove an accepted member OR cancel a pending invite. Both hit family-manage
  // `remove` with the `family_invites` row id — the id the function looks up.
  async function removeSlot(inviteId: string, failTitle: string) {
    if (removingId) return;
    setRemovingId(inviteId);
    const { data, error } = await supabase.functions.invoke('family-manage', {
      body: { action: 'remove', inviteId },
    });
    setRemovingId(null);

    const message = error?.message || (data as { error?: string })?.error;
    if (message) {
      Alert.alert(failTitle, message);
      return;
    }
    loadFamily();
  }

  function confirmRemoveMember(member: InviteRow) {
    Alert.alert(
      'Remove member',
      `Remove ${inviteEmailOf(member)} from your family plan? They'll lose Max access.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeSlot(member.id, 'Could not remove member'),
        },
      ],
    );
  }

  function confirmCancelInvite(invite: InviteRow) {
    Alert.alert(
      'Cancel invite',
      `Cancel the pending invite to ${inviteEmailOf(invite)}?`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel invite',
          style: 'destructive',
          onPress: () => removeSlot(invite.id, 'Could not cancel invite'),
        },
      ],
    );
  }

  async function disbandFamily() {
    if (disbanding) return;
    setDisbanding(true);

    // NOTE: this only downgrades MEMBERS server-side. The owner keeps Max —
    // their plan is never touched here.
    const { data, error } = await supabase.functions.invoke('family-manage', {
      body: { action: 'disband' },
    });
    setDisbanding(false);

    const message = error?.message || (data as { error?: string })?.error;
    if (message) {
      Alert.alert('Could not disband', message);
      return;
    }
    router.replace('/(app)/chat');
  }

  function confirmDisband() {
    Alert.alert(
      'Disband Family',
      'Remove everyone from your family plan? All members lose Max access immediately. You keep your Max plan.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disband', style: 'destructive', onPress: disbandFamily },
      ],
    );
  }

  // ---- Member actions ----
  async function leaveFamily() {
    if (leaving) return;
    setLeaving(true);

    const { data, error } = await supabase.functions.invoke('family-manage', {
      body: { action: 'leave' },
    });

    const message = error?.message || (data as { error?: string })?.error;
    if (message) {
      setLeaving(false);
      Alert.alert('Could not leave', message);
      return;
    }

    // The edge function already reset our metadata server-side; mirror it onto
    // the local session so getPlan() reads Free before the plans screen mounts.
    await supabase.auth.updateUser({ data: { plan: 'Free', plan_billing: null } });
    router.replace('/(onboarding)/plans');
  }

  function confirmLeave() {
    Alert.alert(
      'Leave Family',
      'Leave this family plan? You will drop to the Free plan and lose Max access immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave Family', style: 'destructive', onPress: leaveFamily },
      ],
    );
  }

  // ---- Render ----
  if (authLoading || (isOwner && fetching)) {
    return (
      <Screen center>
        <ActivityIndicator color={Colors.yellow} />
      </Screen>
    );
  }

  // Upgrade gate — not a Max owner and not a family member.
  if (!isOwner && !isMember) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.gateScroll}>
          <Text style={styles.emoji}>👨‍👩‍👧‍👦</Text>
          <Text style={styles.title}>Family Sharing</Text>
          <View style={styles.card}>
            <Text style={styles.cardBody}>
              Family Sharing is a Max plan feature. Upgrade to Max to invite up to{' '}
              {MAX_FAMILY_SLOTS} family members — each gets full Max-level access,
              covered by your plan.
            </Text>
          </View>
          <Button
            label="Upgrade to Max"
            onPress={() => router.push('/(onboarding)/plans')}
            style={styles.cta}
          />
        </ScrollView>
      </Screen>
    );
  }

  // Member UI — read-only "you're covered" + Leave Family.
  if (isMember) {
    const meta = (session?.user?.user_metadata ?? {}) as Record<string, unknown>;
    const ownerLabel = String(
      meta.family_owner_label ||
        meta.family_owner_name ||
        meta.family_owner_email ||
        'the plan owner',
    );
    const disbandAt =
      typeof meta.pending_disband_at === 'string' ? meta.pending_disband_at : '';

    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.emoji}>👨‍👩‍👧‍👦</Text>
          <Text style={styles.title}>Family Sharing</Text>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>You're a family member</Text>
            <Text style={styles.cardBody}>
              You are part of <Text style={styles.owner}>{ownerLabel}</Text>'s
              family plan.
            </Text>
            <Text style={styles.cardNote}>
              You have full Max-level access, covered by {ownerLabel}. To change
              your plan, ask the plan owner or leave the family.
            </Text>
            {disbandAt ? (
              <Text style={styles.warning}>Access ends {formatDate(disbandAt)}.</Text>
            ) : null}
          </View>

          <Button
            label="Leave Family"
            variant="danger"
            loading={leaving}
            onPress={confirmLeave}
            style={styles.cta}
          />
        </ScrollView>
      </Screen>
    );
  }

  // Owner UI — invite input + Members list + Pending invites list + Disband.
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.emoji}>🐕</Text>
        <Text style={styles.title}>Your Family</Text>
        <Text style={styles.subtitle}>
          Invite up to {MAX_FAMILY_SLOTS} people to share your FetchIt Max plan.
          Each gets their own account with Max-level access — no payment needed.
        </Text>

        {loadError ? <Text style={styles.error}>{loadError}</Text> : null}

        {/* Invite a member */}
        {canInvite ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Invite a member</Text>
            <TextInput
              style={styles.input}
              placeholder="name@example.com"
              placeholderTextColor={Colors.placeholder}
              value={inviteEmail}
              onChangeText={(t) => {
                setInviteEmail(t);
                if (inviteError) setInviteError('');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={!sending}
              onSubmitEditing={sendInvite}
              returnKeyType="send"
            />
            {inviteError ? <Text style={styles.error}>{inviteError}</Text> : null}
            <Button
              label="Send Invite"
              loading={sending}
              onPress={sendInvite}
              style={styles.sendBtn}
            />
            <Text style={styles.slotsNote}>
              {slotsUsed} of {MAX_FAMILY_SLOTS} slots used
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardNote}>
              All {MAX_FAMILY_SLOTS} family slots are used. Remove a member or
              cancel an invite to free one up.
            </Text>
          </View>
        )}

        {/* Accepted members */}
        {members.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Members</Text>
            {members.map((m) => (
              <View key={m.id} style={styles.row}>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowEmail} numberOfLines={1}>
                    {inviteEmailOf(m)}
                  </Text>
                  <Text style={styles.rowStatus}>Member</Text>
                </View>
                <Button
                  label="Remove"
                  variant="danger"
                  loading={removingId === m.id}
                  onPress={() => confirmRemoveMember(m)}
                  style={styles.rowBtn}
                />
              </View>
            ))}
          </View>
        ) : null}

        {/* Pending invites */}
        {pending.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pending invites</Text>
            {pending.map((p) => (
              <View key={p.id} style={styles.row}>
                <View style={styles.rowInfo}>
                  <View style={styles.emailRow}>
                    <Text style={styles.rowEmail} numberOfLines={1}>
                      {inviteEmailOf(p)}
                    </Text>
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>Pending</Text>
                    </View>
                  </View>
                </View>
                <Button
                  label="Cancel invite"
                  variant="danger"
                  loading={removingId === p.id}
                  onPress={() => confirmCancelInvite(p)}
                  style={styles.rowBtn}
                />
              </View>
            ))}
          </View>
        ) : null}

        {members.length === 0 && pending.length === 0 ? (
          <Text style={styles.subtitle}>
            No members yet — invite someone above to get started.
          </Text>
        ) : null}

        <Button
          label="Disband Family"
          variant="danger"
          loading={disbanding}
          onPress={confirmDisband}
          style={styles.disbandBtn}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingVertical: Spacing.xl,
    gap: Spacing.md,
  },
  gateScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xl,
  },
  emoji: { fontSize: 56, textAlign: 'center' },
  title: {
    color: Colors.text,
    fontSize: FontSize.xxl,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
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
  cardNote: { color: Colors.textMuted, fontSize: FontSize.sm, lineHeight: 20 },
  owner: { fontWeight: '700' },
  warning: {
    color: Colors.orange,
    fontSize: FontSize.sm,
    fontWeight: '600',
    marginTop: Spacing.xs,
  },
  cta: { alignSelf: 'stretch', marginTop: Spacing.md },
  input: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    color: Colors.text,
    fontSize: FontSize.md,
  },
  sendBtn: { alignSelf: 'stretch' },
  slotsNote: { color: Colors.textFaint, fontSize: FontSize.xs },
  // Sections (Members / Pending invites)
  section: { alignSelf: 'stretch', gap: Spacing.sm },
  sectionTitle: {
    color: Colors.textFaint,
    fontSize: FontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  rowInfo: { flex: 1, gap: 2 },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 1 },
  rowEmail: { color: Colors.text, fontSize: FontSize.md, fontWeight: '600', flexShrink: 1 },
  rowStatus: { color: Colors.textMuted, fontSize: FontSize.xs },
  rowBtn: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
  badge: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.yellow,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    color: Colors.yellow,
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
  disbandBtn: { alignSelf: 'stretch', marginTop: Spacing.lg },
  error: { color: Colors.error, fontSize: FontSize.sm },
});
