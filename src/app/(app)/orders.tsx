import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth';
import {
  categoryBreakdown,
  getOrderStreak,
  getOrders,
  money,
  spendSummary,
  SPEND_PERIODS,
  type Order,
  type PeriodKey,
} from '@/lib/data';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

// Orders & Analytics — full port of the web app's OrdersAnalytics.js: spend
// summary cards, an order streak badge, a category breakdown with a period
// switcher and bar chart, and the full order history list.

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const STATUS: Record<string, { color: string; label: string }> = {
  pending: { color: Colors.textMuted, label: 'Pending' },
  processing: { color: Colors.planPlus, label: 'Processing' },
  completed: { color: Colors.success, label: 'Completed' },
  failed: { color: Colors.error, label: 'Failed' },
};
function statusInfo(s: string | null): { color: string; label: string } {
  return (
    STATUS[(s || '').toLowerCase()] || { color: Colors.success, label: s || '—' }
  );
}

export default function OrdersAnalyticsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const email = session?.user?.email;

  const [orders, setOrders] = useState<Order[]>([]);
  const [fetching, setFetching] = useState(true);
  const [period, setPeriod] = useState<PeriodKey>('lifetime');
  const [streak, setStreak] = useState(0);

  // Load this user's orders + streak (RLS scopes them to the signed-in account).
  useEffect(() => {
    if (!email) return undefined;
    let active = true;
    setFetching(true);
    getOrders().then((list) => {
      if (!active) return;
      setOrders(list);
      setFetching(false);
    });
    getOrderStreak().then((n) => {
      if (active) setStreak(n);
    });
    return () => {
      active = false;
    };
  }, [email]);

  const summary = useMemo(() => spendSummary(orders), [orders]);
  const breakdown = useMemo(
    () => categoryBreakdown(orders, period),
    [orders, period],
  );
  const maxCat = breakdown.length ? breakdown[0].total : 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* ---------- Analytics ---------- */}
        <View style={styles.headingRow}>
          <Text style={styles.heading}>Your Spending 🐕</Text>
          {streak >= 2 ? (
            <View style={styles.streakBadge}>
              <Text style={styles.streakText}>🔥 {streak} week streak</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.spendCards}>
          {SPEND_PERIODS.map((p) => (
            <View key={p.key} style={styles.spendCard}>
              <Text style={styles.spendLabel}>{p.label}</Text>
              <Text style={styles.spendAmount}>{money(summary[p.key] || 0)}</Text>
            </View>
          ))}
        </View>

        {/* ---------- Category breakdown ---------- */}
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Category breakdown</Text>
          <View style={styles.tabs}>
            {SPEND_PERIODS.map((p) => {
              const active = period === p.key;
              return (
                <Pressable
                  key={p.key}
                  onPress={() => setPeriod(p.key)}
                  style={[styles.tab, active && styles.tabActive]}>
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>
                    {p.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {breakdown.length === 0 ? (
            <Text style={styles.breakdownEmpty}>
              No spending in this period yet.
            </Text>
          ) : (
            <View style={styles.breakdownList}>
              {breakdown.map((c) => (
                <View key={c.category} style={styles.breakdownRow}>
                  <View style={styles.breakdownRowTop}>
                    <Text style={styles.breakdownCat}>{c.category}</Text>
                    <Text style={styles.breakdownAmt}>{money(c.total)}</Text>
                  </View>
                  <View style={styles.bar}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${maxCat ? (c.total / maxCat) * 100 : 0}%` },
                      ]}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ---------- Order history ---------- */}
        <Text style={[styles.heading, styles.historyHeading]}>Order History</Text>

        {fetching ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={Colors.yellow} />
            <Text style={styles.loadingText}>Fetching your orders…</Text>
          </View>
        ) : orders.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🛍️</Text>
            <Text style={styles.emptyTitle}>No orders yet — start shopping!</Text>
            <Button
              label="Start Shopping"
              onPress={() => router.replace('/(app)/chat')}
              style={styles.emptyBtn}
            />
          </View>
        ) : (
          <View style={styles.list}>
            {orders.map((o) => {
              const s = statusInfo(o.status);
              return (
                <View key={o.id} style={styles.card}>
                  <View style={styles.thumb}>
                    <Text style={styles.thumbText}>{o.productImage || '🛍️'}</Text>
                  </View>
                  <View style={styles.cardBody}>
                    <View style={styles.cardTop}>
                      <Text style={styles.name} numberOfLines={2}>
                        {o.productName}
                      </Text>
                      <View style={[styles.statusPill, { borderColor: s.color }]}>
                        <Text style={[styles.statusText, { color: s.color }]}>
                          {s.label}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.meta}>
                      {[o.retailer, o.category, formatDate(o.createdAt)]
                        .filter(Boolean)
                        .join('  ·  ')}
                    </Text>
                    <View style={styles.prices}>
                      <Text style={styles.price}>{money(o.orderPrice)}</Text>
                      <Text style={styles.fee}>
                        + {money(o.serviceFee)} FetchIt fee
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: Spacing.lg, gap: Spacing.md },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  heading: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: '800' },
  historyHeading: { marginTop: Spacing.md },
  streakBadge: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.orange,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  streakText: { color: Colors.orange, fontSize: FontSize.xs, fontWeight: '700' },
  // Spend summary cards
  spendCards: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  spendCard: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  spendLabel: {
    color: Colors.textFaint,
    fontSize: FontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  spendAmount: { color: Colors.yellow, fontSize: FontSize.xl, fontWeight: '800' },
  // Breakdown panel
  panel: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  panelTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '700' },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tab: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  tabActive: { backgroundColor: Colors.yellow, borderColor: Colors.yellow },
  tabText: { color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '700' },
  tabTextActive: { color: Colors.charcoal },
  breakdownEmpty: { color: Colors.textMuted, fontSize: FontSize.sm },
  breakdownList: { gap: Spacing.md },
  breakdownRow: { gap: Spacing.xs },
  breakdownRowTop: { flexDirection: 'row', justifyContent: 'space-between' },
  breakdownCat: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '600' },
  breakdownAmt: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: '700' },
  bar: {
    height: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceAlt,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: Radius.pill, backgroundColor: Colors.yellow },
  // Order history
  loadingWrap: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  loadingText: { color: Colors.textMuted, fontSize: FontSize.sm },
  empty: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xl },
  emptyIcon: { fontSize: 56 },
  emptyTitle: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyBtn: { alignSelf: 'stretch', marginTop: Spacing.sm },
  list: { gap: Spacing.md },
  card: {
    flexDirection: 'row',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbText: { fontSize: 26 },
  cardBody: { flex: 1, gap: Spacing.xs },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  name: { flex: 1, color: Colors.text, fontSize: FontSize.md, fontWeight: '700' },
  statusPill: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  statusText: { fontSize: FontSize.xs, fontWeight: '700' },
  meta: { color: Colors.textMuted, fontSize: FontSize.xs },
  prices: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.sm,
    marginTop: 2,
  },
  price: { color: Colors.yellow, fontSize: FontSize.md, fontWeight: '800' },
  fee: { color: Colors.textFaint, fontSize: FontSize.xs },
});
