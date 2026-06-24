import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth';
import { getOrders, money, type Order } from '@/lib/data';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

// Order History — port of the order-list ("right column") of the web app's
// OrdersAnalytics.js. Newest order first; each card shows the product, retailer,
// category, date, price, and FetchIt service fee, with a colored status pill.

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

// pending | processing | completed | failed → a color + label.
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

export default function OrderHistoryScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const email = session?.user?.email;

  const [orders, setOrders] = useState<Order[]>([]);
  const [fetching, setFetching] = useState(true);

  // Load this user's orders (RLS scopes them to the signed-in account).
  useEffect(() => {
    if (!email) return undefined;
    let active = true;
    setFetching(true);
    getOrders().then((list) => {
      if (!active) return;
      setOrders(list);
      setFetching(false);
    });
    return () => {
      active = false;
    };
  }, [email]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.heading}>Order History 🐕</Text>

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
                  <View style={styles.body}>
                    <View style={styles.top}>
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
  heading: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: '800' },
  loadingWrap: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xxl },
  loadingText: { color: Colors.textMuted, fontSize: FontSize.sm },
  empty: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xxl },
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
  body: { flex: 1, gap: Spacing.xs },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
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
