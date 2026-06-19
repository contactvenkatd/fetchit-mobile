import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { Screen } from '@/components/ui/Screen';
import type { PlanName } from '@/lib/stripe';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

// Step 1 of onboarding — choose a plan. Prices mirror src/lib/stripe.ts
// PLAN_PRICING (monthly). Free needs no card and goes straight to chat; paid
// plans carry the chosen plan into the payment (card) step.
type PlanCard = {
  name: PlanName;
  price: string;
  tagline: string;
  features: string[];
  accent: string;
  popular?: boolean;
};

const PLANS: PlanCard[] = [
  {
    name: 'Free',
    price: '$0',
    tagline: 'Get started — no card needed',
    features: ['AI shopping assistant', 'Up to 5 searches a day', 'Order tracking'],
    accent: Colors.planFree,
  },
  {
    name: 'Plus',
    price: '$4.99/mo',
    tagline: 'For everyday shoppers',
    features: ['Everything in Free', 'Unlimited searches', 'Price-drop alerts'],
    accent: Colors.planPlus,
  },
  {
    name: 'Pro',
    price: '$19.99/mo',
    tagline: 'Most popular',
    features: ['Everything in Plus', 'Auto-reorder', 'Wishlist & analytics'],
    accent: Colors.planPro,
    popular: true,
  },
  {
    name: 'Max',
    price: '$99.99/mo',
    tagline: 'For families',
    features: ['Everything in Pro', 'Family sharing — 5 members', 'Priority support'],
    accent: Colors.planMax,
  },
];

export default function PlansScreen() {
  const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState<PlanName | null>(null);

  function handleContinue() {
    if (!selectedPlan) return;
    if (selectedPlan === 'Free') {
      router.replace('/(app)/chat'); // Free needs no card step
      return;
    }
    router.push({
      pathname: '/(onboarding)/payment',
      params: { plan: selectedPlan },
    });
  }

  return (
    <Screen padded={false}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Logo size={60} />
          <Text style={styles.title}>Choose your plan</Text>
          <Text style={styles.subtitle}>Pick the plan that fits — change anytime</Text>
        </View>

        {PLANS.map((p) => {
          const selected = p.name === selectedPlan;
          return (
            <Pressable
              key={p.name}
              onPress={() => setSelectedPlan(p.name)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.card, selected && styles.cardSelected]}>
              <View style={styles.cardTop}>
                <View style={styles.nameRow}>
                  <Text style={[styles.planName, { color: p.accent }]}>{p.name}</Text>
                  {p.popular ? <Text style={styles.badge}>POPULAR</Text> : null}
                </View>
                <Text style={styles.price}>{p.price}</Text>
              </View>
              <Text style={styles.tagline}>{p.tagline}</Text>
              <View style={styles.features}>
                {p.features.map((f) => (
                  <Text key={f} style={styles.feature}>
                    ✓ {f}
                  </Text>
                ))}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={selectedPlan === 'Free' ? 'Continue with Free' : 'Continue'}
          onPress={handleContinue}
          disabled={!selectedPlan}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.md,
  },
  header: { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
  title: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: '800' },
  subtitle: { color: Colors.textMuted, fontSize: FontSize.md, textAlign: 'center' },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  cardSelected: { borderColor: Colors.yellow },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  planName: { fontSize: FontSize.xl, fontWeight: '800' },
  badge: {
    color: Colors.charcoal,
    backgroundColor: Colors.orange,
    fontSize: FontSize.xs,
    fontWeight: '800',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  price: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '700' },
  tagline: { color: Colors.textMuted, fontSize: FontSize.sm },
  features: { gap: Spacing.xs, marginTop: Spacing.xs },
  feature: { color: Colors.textMuted, fontSize: FontSize.sm },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
});
