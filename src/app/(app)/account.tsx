import { useRouter, type Href } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { getName, getPlan, signOut, useAuth } from '@/lib/auth';
import { monthlyDisplay, money } from '@/lib/stripe';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

const PLAN_COLOR: Record<string, string> = {
  Free: Colors.planFree,
  Plus: Colors.planPlus,
  Pro: Colors.planPro,
  Max: Colors.planMax,
};

const LINKS: { label: string; href: Href; icon: string }[] = [
  { label: 'Order History', href: '/(app)/order-history', icon: '📦' },
  { label: 'Orders & Analytics', href: '/(app)/orders', icon: '📊' },
  { label: 'Wishlist', href: '/(app)/wishlist', icon: '♡' },
  { label: 'Auto-Reorder', href: '/(app)/auto-reorder', icon: '🔁' },
  { label: 'Family Sharing', href: '/(app)/family-sharing', icon: '👨‍👩‍👧' },
  { label: 'Cards & Address', href: '/(app)/cards-address', icon: '💳' },
  { label: 'Terms of Service', href: '/tos', icon: '📜' },
  { label: 'Privacy Policy', href: '/privacy-policy', icon: '🔒' },
];

export default function AccountScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const plan = getPlan(session);
  const { firstName, lastName } = getName(session);
  const name = [firstName, lastName].filter(Boolean).join(' ');
  const perMonth = monthlyDisplay(plan, 'monthly');

  function confirmSignOut() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/');
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        scrollEnabled={true}>
        <View style={styles.content}>
          {/* Plan card */}
          <View style={[styles.planCard, { borderColor: PLAN_COLOR[plan] ?? Colors.border }]}>
            <Text style={styles.planLabel}>Your Plan</Text>
            <Text style={[styles.planName, { color: PLAN_COLOR[plan] ?? Colors.text }]}>
              {plan}
            </Text>
            <Text style={styles.planPrice}>
              {plan === 'Free' ? '$0/mo' : `$${money(perMonth)}/mo`}
            </Text>
            <Button label="Change Plan" variant="secondary" onPress={() => router.push({ pathname: '/(onboarding)/plans', params: { mode: 'change' } })} />
          </View>

          {/* Profile */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Profile</Text>
            <Text style={styles.sectionValue}>{name || '—'}</Text>
            <Text style={styles.sectionSub}>{session?.user?.email}</Text>
          </View>

          {/* Navigation */}
          <View style={styles.menu}>
            {LINKS.map((l) => (
              <Text
                key={l.label}
                style={styles.menuItem}
                onPress={() => router.push(l.href)}>
                {l.icon}  {l.label}
              </Text>
            ))}
          </View>

          {/* Sign Out lives at the bottom of the scrollable content. */}
          <View style={styles.signOut}>
            <Button label="Sign Out" variant="danger" onPress={confirmSignOut} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Vertical rhythm between the cards; the ScrollView owns the outer padding.
  content: { gap: Spacing.lg },
  // Sits at the bottom of the scrollable content, divided from the list above.
  signOut: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.lg,
  },
  planCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 2,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  planLabel: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: '600' },
  planName: { fontSize: FontSize.xxl, fontWeight: '800' },
  planPrice: { color: Colors.text, fontSize: FontSize.md, marginBottom: Spacing.sm },
  section: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  sectionTitle: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: '600' },
  sectionValue: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '700' },
  sectionSub: { color: Colors.textFaint, fontSize: FontSize.sm },
  menu: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  menuItem: {
    color: Colors.text,
    fontSize: FontSize.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
});
