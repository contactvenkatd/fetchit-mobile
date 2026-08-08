import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatHistoryDrawer } from '@/components/ChatHistoryDrawer';
import { Logo } from '@/components/ui/Logo';
import { greetingName, useAuth } from '@/lib/auth';
import {
  createChat,
  updateChatMessages,
  type Chat,
  type StoredMessage,
} from '@/lib/chats';
import { GrokServiceError, sendChatMessage } from '@/services/grokService';
import {
  searchProducts,
  type ProductResult,
  ZincServiceError,
} from '@/services/zincService';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

type Msg = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  products?: ProductResult[];
  quantity?: number;
};

const SUGGESTIONS = [
  'A gift for my mom, around $50',
  'Best wireless headphones under $100',
  'Restock my coffee pods',
];

let seq = 0;
const nextId = () => `m${(seq += 1)}`;

function TypingIndicator() {
  const dots = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  useEffect(() => {
    const animations = dots.map((dot, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 140),
          Animated.timing(dot, {
            toValue: 1,
            duration: 240,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 240,
            useNativeDriver: true,
          }),
          Animated.delay((dots.length - index - 1) * 140),
        ]),
      ),
    );

    animations.forEach((animation) => animation.start());
    return () => animations.forEach((animation) => animation.stop());
  }, [dots]);

  return (
    <View
      style={[styles.bubble, styles.aiBubble, styles.typingBubble]}
      accessible
      accessibilityLabel="Assistant is typing"
      accessibilityLiveRegion="polite">
      {dots.map((dot, index) => (
        <Animated.View
          key={index}
          style={[
            styles.typingDot,
            {
              opacity: dot.interpolate({
                inputRange: [0, 1],
                outputRange: [0.35, 1],
              }),
              transform: [
                {
                  translateY: dot.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -4],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function ChatScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [persisting, setPersisting] = useState(false);
  const [incognito, setIncognito] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const listRef = useRef<FlatList<Msg>>(null);

  // Open the history drawer on a rightward swipe from a dedicated strip on the
  // LEFT edge (see `edgeSwipe`). It declines the touch on start (so taps pass
  // through) and only claims a clearly-horizontal rightward drag, opening on
  // release.
  const swipe = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) =>
        g.dx > 25 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_e, g) => {
        if (g.dx > 40) setDrawerOpen(true);
      },
    }),
  ).current;

  // Load a past conversation from the drawer into the active screen.
  function loadChat(chat: Chat) {
    if (sending || persisting) return;
    setMessages(
      chat.messages.map((m) => ({ id: nextId(), role: m.role, text: m.text })),
    );
    setCurrentChatId(chat.id);
    setDrawerOpen(false);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
  }

  function startNewChat() {
    if (sending || persisting) return;
    setMessages([]);
    setCurrentChatId(null);
    setDraft('');
    setDrawerOpen(false);
  }

  function toggleIncognito() {
    if (sending || persisting) return;
    setIncognito((enabled) => !enabled);
    setMessages([]);
    setCurrentChatId(null);
    setDraft('');
    setDrawerOpen(false);
  }

  function handleChatDeleted(chatId: string) {
    if (chatId !== currentChatId) return;
    setMessages([]);
    setCurrentChatId(null);
    setDraft('');
    setDrawerOpen(false);
  }

  async function send(text: string) {
    const body = text.trim();
    if (!body || sending || persisting) return;
    const userMessage: Msg = { id: nextId(), role: 'user', text: body };
    const messagesWithUser = [...messages, userMessage];
    setDraft('');
    setMessages(messagesWithUser);
    setSending(true);

    try {
      const result = await sendChatMessage(body);
      const assistantMessage: Msg = {
        id: nextId(),
        role: 'assistant',
        text:
          result.type === 'shopping_intent'
            ? `Got it — searching for ${result.intent.productQuery}. 🔍`
            : result.text,
      };
      const completedMessages = [...messagesWithUser, assistantMessage];

      // Show the real response and remove the typing indicator before the
      // transcript persistence round-trip.
      setMessages(completedMessages);

      if (result.type === 'shopping_intent') {
        try {
          const products = await searchProducts(result.intent);
          completedMessages.push({
            id: nextId(),
            role: 'assistant',
            text: products.length
              ? `I found ${products.length} option${products.length === 1 ? '' : 's'}:`
              : "I couldn't find any matching products. Try broadening your search.",
            products,
            quantity: result.intent.quantity,
          });
          setMessages([...completedMessages]);
        } catch (searchError) {
          completedMessages.push({
            id: nextId(),
            role: 'assistant',
            text:
              searchError instanceof ZincServiceError
                ? searchError.userMessage
                : "I couldn't search for products right now. Please try again in a moment.",
          });
          setMessages([...completedMessages]);
          console.error('Product search failed:', searchError);
        }
      }

      setSending(false);

      // Incognito transcripts remain exclusively in local React state.
      if (incognito) return;

      const storedMessages: StoredMessage[] = completedMessages.map(({ role, text }) => ({
        role,
        text,
      }));
      setPersisting(true);
      try {
        if (currentChatId) {
          await updateChatMessages(currentChatId, storedMessages);
        } else {
          const title = body.length > 40 ? `${body.slice(0, 40)}…` : body;
          const chat = await createChat(title, storedMessages);
          setCurrentChatId(chat.id);
        }
        setHistoryRevision((revision) => revision + 1);
      } catch (saveError) {
        console.error('Chat persistence failed:', saveError);
      } finally {
        setPersisting(false);
      }
    } catch (error) {
      const text =
        error instanceof GrokServiceError
          ? error.userMessage
          : "I couldn't respond right now. Please try again in a moment.";
      setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', text }]);
      console.error('Chat request failed:', error);
    } finally {
      setSending(false);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }

  const empty = messages.length === 0;
  const busy = sending || persisting;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Top bar */}
      <View style={[styles.topBar, incognito && styles.topBarIncognito]}>
        <Logo size={36} />
        <View style={styles.headerCopy}>
          <Text style={styles.greeting}>Hi, {greetingName(session)} 👋</Text>
          {incognito ? <Text style={styles.incognitoLabel}>Incognito</Text> : null}
        </View>
        <Pressable
          onPress={toggleIncognito}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="switch"
          accessibilityLabel="Incognito mode"
          accessibilityState={{ checked: incognito, disabled: busy }}
          style={[styles.incognitoButton, incognito && styles.incognitoButtonActive]}>
          <Text style={[styles.incognitoIcon, busy && styles.topBarActionDisabled]}>🕶</Text>
        </Pressable>
        <Pressable
          onPress={startNewChat}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="New chat"
          accessibilityState={{ disabled: busy }}>
          <Text style={[styles.newChat, busy && styles.topBarActionDisabled]}>＋</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/(app)/account')}
          hitSlop={8}
          accessibilityLabel="Account menu">
          <Text style={styles.menu}>☰</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}>
        {empty ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🐕</Text>
            <Text style={styles.emptyTitle}>What can we get you?</Text>
            <View style={styles.chips}>
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} style={styles.chip} onPress={() => send(s)}>
                  <Text style={styles.chipText}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.messages}
            renderItem={({ item }) => (
              <View
                style={[
                  styles.bubble,
                  item.role === 'user' ? styles.userBubble : styles.aiBubble,
                  item.products && styles.productResultsBubble,
                ]}>
                <Text
                  style={item.role === 'user' ? styles.userText : styles.aiText}>
                  {item.text}
                </Text>
                {item.products?.map((product) => (
                  <Pressable
                    key={product.productId}
                    accessibilityRole="button"
                    accessibilityLabel={`${product.title}, ${product.retailer}`}
                    onPress={() =>
                      router.push({
                        pathname: '/(app)/checkout-confirmation',
                        params: {
                          productUrl: product.url,
                          title: product.title,
                          image: product.image ?? '',
                          retailer: product.retailer,
                          priceCents: product.price?.toString() ?? '',
                          quantity: (item.quantity ?? 1).toString(),
                        },
                      })
                    }
                    style={({ pressed }) => [
                      styles.productCard,
                      pressed && styles.productCardPressed,
                    ]}>
                    {product.image ? (
                      <Image
                        source={product.image}
                        style={styles.productImage}
                        contentFit="contain"
                        accessibilityLabel={product.title}
                      />
                    ) : (
                      <View style={[styles.productImage, styles.productImagePlaceholder]}>
                        <Text style={styles.productImagePlaceholderText}>🛍️</Text>
                      </View>
                    )}
                    <View style={styles.productCopy}>
                      <Text style={styles.productTitle} numberOfLines={3}>
                        {product.title}
                      </Text>
                      <Text style={styles.productRetailer}>{product.retailer}</Text>
                      <View style={styles.productFooter}>
                        <Text style={styles.productPrice}>
                          {product.price === null
                            ? 'Price unavailable'
                            : `$${(product.price / 100).toFixed(2)}`}
                        </Text>
                        <Text style={styles.productDisclosure} aria-hidden>
                          ›
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
            ListFooterComponent={sending ? <TypingIndicator /> : null}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          />
        )}

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            editable={!busy}
            placeholder="Ask FetchIt anything..."
            placeholderTextColor={Colors.placeholder}
            onSubmitEditing={() => send(draft)}
            returnKeyType="send"
          />
          <Pressable
            style={[styles.sendBtn, (!draft.trim() || busy) && styles.sendBtnOff]}
            onPress={() => send(draft)}
            disabled={!draft.trim() || busy}>
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Left-edge swipe zone — opens the drawer on a rightward swipe. */}
      <View
        style={styles.edgeSwipe}
        {...swipe.panHandlers}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />

      <ChatHistoryDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSelectChat={loadChat}
        currentChatId={currentChatId}
        refreshKey={historyRevision}
        onChatDeleted={handleChatDeleted}
        actionsDisabled={busy}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  // Invisible left-edge gesture zone that opens the chat-history drawer.
  edgeSwipe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 40, zIndex: 999 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  topBarIncognito: { backgroundColor: Colors.incognito },
  headerCopy: { flex: 1 },
  greeting: { color: Colors.text, fontSize: FontSize.md, fontWeight: '700' },
  incognitoLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '600',
    marginTop: 1,
  },
  incognitoButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  incognitoButtonActive: {
    backgroundColor: Colors.surfaceAlt,
    borderColor: Colors.textMuted,
  },
  incognitoIcon: { fontSize: FontSize.lg },
  newChat: { color: Colors.yellow, fontSize: 28, lineHeight: 30 },
  topBarActionDisabled: { opacity: 0.4 },
  menu: { color: Colors.yellow, fontSize: 26 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.lg },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { color: Colors.text, fontSize: FontSize.xl, fontWeight: '800' },
  chips: { gap: Spacing.sm, alignSelf: 'stretch', marginTop: Spacing.sm },
  chip: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  chipText: { color: Colors.textMuted, fontSize: FontSize.sm, textAlign: 'center' },
  messages: { padding: Spacing.md, gap: Spacing.sm },
  bubble: { maxWidth: '85%', borderRadius: Radius.lg, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
  userBubble: { alignSelf: 'flex-end', backgroundColor: Colors.yellow },
  aiBubble: { alignSelf: 'flex-start', backgroundColor: Colors.surfaceAlt },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 38,
    marginTop: Spacing.sm,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.textMuted,
  },
  userText: { color: Colors.charcoal, fontSize: FontSize.md },
  aiText: { color: Colors.text, fontSize: FontSize.md },
  productResultsBubble: {
    alignSelf: 'stretch',
    maxWidth: '100%',
    width: '100%',
  },
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: Spacing.md,
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  productCardPressed: { opacity: 0.78, borderColor: Colors.borderFocus },
  productImage: {
    width: 88,
    height: 88,
    flexShrink: 0,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceAlt,
  },
  productImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceAlt,
  },
  productImagePlaceholderText: { fontSize: 28 },
  productCopy: { flex: 1, minWidth: 0, alignSelf: 'stretch' },
  productTitle: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '700',
    lineHeight: 21,
  },
  productRetailer: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    marginTop: Spacing.xs,
    textTransform: 'capitalize',
  },
  productFooter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 'auto',
    paddingTop: Spacing.sm,
  },
  productPrice: { color: Colors.yellow, fontSize: FontSize.lg, fontWeight: '800' },
  productDisclosure: {
    color: Colors.textFaint,
    fontSize: FontSize.xl,
    lineHeight: FontSize.xl,
    marginLeft: Spacing.sm,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === 'ios' ? Spacing.md : Spacing.sm,
    color: Colors.text,
    fontSize: FontSize.md,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { opacity: 0.4 },
  sendText: { color: Colors.charcoal, fontSize: 22, fontWeight: '900' },
});
