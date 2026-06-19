import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getChats, type Chat } from '@/lib/chats';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

const SCREEN_W = Dimensions.get('window').width;
const DRAWER_W = Math.min(340, Math.round(SCREEN_W * 0.84));
const OPEN_MS = 240;

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Right-side chat-history drawer. Mounted only while open or animating; the
 * caller flips `open` (e.g. from a left-swipe on the chat screen). Slides in
 * from the right, fades a scrim behind it, and supports swipe-right / tap-scrim
 * to close. Tapping a row calls `onSelectChat` with the full conversation.
 */
export function ChatHistoryDrawer({
  open,
  onClose,
  onSelectChat,
  currentChatId,
}: {
  open: boolean;
  onClose: () => void;
  onSelectChat: (chat: Chat) => void;
  currentChatId?: string | null;
}) {
  const translateX = useRef(new Animated.Value(-DRAWER_W)).current;
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);

  // Scrim darkens as the panel slides in from the left (closed -DRAWER_W → 0,
  // open 0 → 0.55).
  const scrimOpacity = translateX.interpolate({
    inputRange: [-DRAWER_W, 0],
    outputRange: [0, 0.55],
    extrapolate: 'clamp',
  });

  function animateTo(toValue: number, after?: () => void) {
    Animated.timing(translateX, {
      toValue,
      duration: OPEN_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && after) after();
    });
  }

  // Drive mount + slide from the `open` prop, and (re)load history on each open.
  useEffect(() => {
    if (open) {
      setMounted(true);
      translateX.setValue(-DRAWER_W);
      requestAnimationFrame(() => animateTo(0));
      setLoading(true);
      getChats().then((rows) => {
        setChats(rows);
        setLoading(false);
      });
    } else if (mounted) {
      animateTo(-DRAWER_W, () => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Swipe-left on the panel to close; follow the finger, then settle.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        g.dx < -8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
      onPanResponderMove: (_e, g) => {
        if (g.dx < 0) translateX.setValue(Math.max(g.dx, -DRAWER_W));
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -DRAWER_W / 3 || g.vx < -0.5) onClose();
        else animateTo(0);
      },
      onPanResponderTerminate: () => animateTo(0),
    }),
  ).current;

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {/* Scrim — tap to close */}
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.scrim, { opacity: scrimOpacity }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close chat history"
          />
        </Animated.View>

        {/* Sliding panel */}
        <Animated.View
          style={[styles.panel, { width: DRAWER_W, transform: [{ translateX }] }]}
          {...pan.panHandlers}>
          <SafeAreaView style={styles.flex} edges={['top', 'bottom', 'left']}>
            <View style={styles.header}>
            <Text style={styles.heading}>Chat history</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={Colors.yellow} />
            </View>
          ) : chats.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyText}>No past conversations yet.</Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}>
              {chats.map((c) => {
                const active = c.id === currentChatId;
                return (
                  <Pressable
                    key={c.id}
                    style={[styles.item, active && styles.itemActive]}
                    onPress={() => onSelectChat(c)}>
                    <Text
                      style={[styles.itemTitle, active && styles.itemTitleActive]}
                      numberOfLines={1}>
                      {c.title || 'Untitled chat'}
                    </Text>
                    <Text style={styles.itemDate}>{formatDate(c.createdAt)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { backgroundColor: Colors.scrim },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: Colors.sidebar,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  heading: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '800' },
  close: { color: Colors.yellow, fontSize: FontSize.lg, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  emptyText: { color: Colors.textFaint, fontSize: FontSize.sm, textAlign: 'center' },
  list: { padding: Spacing.md, gap: Spacing.sm },
  item: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    gap: 2,
  },
  itemActive: { borderColor: Colors.yellow },
  itemTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: '600' },
  itemTitleActive: { color: Colors.yellow },
  itemDate: { color: Colors.textFaint, fontSize: FontSize.xs },
});
