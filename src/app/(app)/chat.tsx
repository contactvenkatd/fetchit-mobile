import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Logo } from '@/components/ui/Logo';
import { greetingName, useAuth } from '@/lib/auth';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

type Msg = { id: string; role: 'user' | 'assistant'; text: string };

const SUGGESTIONS = [
  'A gift for my mom, around $50',
  'Best wireless headphones under $100',
  'Restock my coffee pods',
];

let seq = 0;
const nextId = () => `m${(seq += 1)}`;

export default function ChatScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<Msg>>(null);

  function send(text: string) {
    const body = text.trim();
    if (!body) return;
    setDraft('');
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text: body }]);

    // Mocked assistant reply (web app parity — real AI + product cards land later).
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          text: 'Got it! Let me find the best options for you... 🔍',
        },
      ]);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }, 700);
  }

  const empty = messages.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Logo size={36} />
        <Text style={styles.greeting}>Hi, {greetingName(session)} 👋</Text>
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
                ]}>
                <Text
                  style={item.role === 'user' ? styles.userText : styles.aiText}>
                  {item.text}
                </Text>
              </View>
            )}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          />
        )}

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask FetchIt anything..."
            placeholderTextColor={Colors.placeholder}
            onSubmitEditing={() => send(draft)}
            returnKeyType="send"
          />
          <Pressable
            style={[styles.sendBtn, !draft.trim() && styles.sendBtnOff]}
            onPress={() => send(draft)}
            disabled={!draft.trim()}>
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  greeting: { flex: 1, color: Colors.text, fontSize: FontSize.md, fontWeight: '700' },
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
  userText: { color: Colors.charcoal, fontSize: FontSize.md },
  aiText: { color: Colors.text, fontSize: FontSize.md },
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
