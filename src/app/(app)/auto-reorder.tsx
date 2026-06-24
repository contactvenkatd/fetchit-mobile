import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth';
import {
  deleteAutoReorder,
  frequencyLabel,
  getAutoReorders,
  money,
  setAutoReorderActive,
  type AutoReorder,
} from '@/lib/data';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

// Auto-Reorder — full port of the web app's AutoReorderPage.js. Recurring
// purchase schedules set from the chat; each can be paused/resumed (optimistic
// toggle, reverts on error) or deleted.

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// A small RN switch matching the web's ar-toggle (yellow when on).
function Toggle({ active, onPress }: { active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      style={[styles.toggle, active && styles.toggleActive]}>
      <View style={[styles.knob, active && styles.knobActive]} />
    </Pressable>
  );
}

export default function AutoReorderScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const email = session?.user?.email;

  const [items, setItems] = useState<AutoReorder[]>([]);
  const [fetching, setFetching] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Load this user's auto-reorders (RLS scopes them to the signed-in account).
  useEffect(() => {
    if (!email) return undefined;
    let active = true;
    setFetching(true);
    getAutoReorders().then((list) => {
      if (!active) return;
      setItems(list);
      setFetching(false);
    });
    return () => {
      active = false;
    };
  }, [email]);

  async function handleToggle(item: AutoReorder) {
    const nextActive = !item.active;
    // Optimistic flip; revert on error.
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, active: nextActive } : i)),
    );
    const { error } = await setAutoReorderActive(item.id, nextActive);
    if (error) {
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, active: item.active } : i)),
      );
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    await deleteAutoReorder(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    setDeletingId(null);
  }

  function confirmDelete(item: AutoReorder) {
    Alert.alert(
      'Delete auto-reorder',
      `Stop auto-reordering ${item.productName || 'this item'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => handleDelete(item.id),
        },
      ],
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.heading}>Auto-Reorders 🔁</Text>

        {fetching ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={Colors.yellow} />
            <Text style={styles.loadingText}>Fetching your auto-reorders…</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🔁</Text>
            <Text style={styles.emptyTitle}>
              No auto-reorders set up yet. Ask FetchIt to set one up for you!
            </Text>
            <Button
              label="Start Shopping"
              onPress={() => router.replace('/(app)/chat')}
              style={styles.emptyBtn}
            />
          </View>
        ) : (
          <View style={styles.list}>
            {items.map((item) => (
              <View
                key={item.id}
                style={[styles.card, !item.active && styles.cardPaused]}>
                <View style={styles.thumb}>
                  <Text style={styles.thumbText}>{item.productImage || '🛍️'}</Text>
                </View>
                <View style={styles.body}>
                  <Text style={styles.name} numberOfLines={2}>
                    {item.productName}
                  </Text>
                  <Text style={styles.meta}>
                    <Text style={styles.freq}>{frequencyLabel(item.frequency)}</Text>
                    {item.price != null ? `  ·  ${money(item.price)}` : ''}
                  </Text>
                  <Text style={styles.next}>
                    {item.active
                      ? `Next order: ${formatDate(item.nextOrderDate)}`
                      : 'Paused'}
                  </Text>
                </View>
                <View style={styles.actions}>
                  <Toggle active={item.active} onPress={() => handleToggle(item)} />
                  <Button
                    label="Delete"
                    variant="danger"
                    loading={deletingId === item.id}
                    onPress={() => confirmDelete(item)}
                    style={styles.deleteBtn}
                  />
                </View>
              </View>
            ))}
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
    fontSize: FontSize.md,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyBtn: { alignSelf: 'stretch', marginTop: Spacing.sm },
  list: { gap: Spacing.md },
  card: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'flex-start',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  cardPaused: { opacity: 0.6 },
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
  name: { color: Colors.text, fontSize: FontSize.md, fontWeight: '700' },
  meta: { color: Colors.textMuted, fontSize: FontSize.sm },
  freq: { color: Colors.yellow, fontWeight: '700' },
  next: { color: Colors.textFaint, fontSize: FontSize.xs },
  actions: { alignItems: 'flex-end', gap: Spacing.sm },
  toggle: {
    width: 46,
    height: 28,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 2,
    justifyContent: 'center',
  },
  toggleActive: { backgroundColor: Colors.yellow, borderColor: Colors.yellow },
  knob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.textMuted,
    alignSelf: 'flex-start',
  },
  knobActive: { backgroundColor: Colors.charcoal, alignSelf: 'flex-end' },
  deleteBtn: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
});
