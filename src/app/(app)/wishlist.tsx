import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth';
import { getWishlist, money, removeWishlistItem, type WishlistItem } from '@/lib/data';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

// Wishlist — full port of the web app's WishlistPage.js. Products saved from the
// chat ("Save to Wishlist") to buy later; each can be removed.

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function WishlistScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const email = session?.user?.email;

  const [items, setItems] = useState<WishlistItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Load this user's wishlist (RLS scopes it to the signed-in account).
  useEffect(() => {
    if (!email) return undefined;
    let active = true;
    setFetching(true);
    getWishlist().then((list) => {
      if (!active) return;
      setItems(list);
      setFetching(false);
    });
    return () => {
      active = false;
    };
  }, [email]);

  async function handleRemove(id: string) {
    setRemovingId(id);
    await removeWishlistItem(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    setRemovingId(null);
  }

  function confirmRemove(item: WishlistItem) {
    Alert.alert(
      'Remove from wishlist',
      `Remove ${item.productName || 'this item'} from your wishlist?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => handleRemove(item.id),
        },
      ],
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.heading}>Your Wishlist 🐕</Text>

        {fetching ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={Colors.yellow} />
            <Text style={styles.loadingText}>Fetching your wishlist…</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>♡</Text>
            <Text style={styles.emptyTitle}>
              No items in your wishlist yet. Ask FetchIt to save something for you!
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
              <View key={item.id} style={styles.card}>
                <View style={styles.thumb}>
                  <Text style={styles.thumbText}>{item.productImage || '🛍️'}</Text>
                </View>
                <View style={styles.body}>
                  <Text style={styles.name} numberOfLines={2}>
                    {item.productName}
                  </Text>
                  <Text style={styles.meta}>
                    {[item.retailer, `Added ${formatDate(item.createdAt)}`]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </Text>
                  {item.notes ? <Text style={styles.notes}>{item.notes}</Text> : null}
                  <Text style={styles.price}>{money(item.price)}</Text>
                </View>
                <Button
                  label="Remove"
                  variant="danger"
                  loading={removingId === item.id}
                  onPress={() => confirmRemove(item)}
                  style={styles.removeBtn}
                />
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
  emptyIcon: { fontSize: 56, color: Colors.yellow },
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
  meta: { color: Colors.textMuted, fontSize: FontSize.xs },
  notes: { color: Colors.textFaint, fontSize: FontSize.sm, fontStyle: 'italic' },
  price: { color: Colors.yellow, fontSize: FontSize.md, fontWeight: '800', marginTop: 2 },
  removeBtn: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
});
