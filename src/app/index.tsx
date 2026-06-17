import { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

const BULLETS = [
  'Describe what you want in plain English',
  'FetchIt searches Amazon, Walmart, Target, Best Buy and more',
  'We buy it for you automatically',
];

export default function Landing() {
  const router = useRouter();
  const { session, loading } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);

  // While restoring the cached session, hold on a branded splash.
  if (loading) {
    return (
      <Screen center>
        <View style={styles.splash}>
          <Logo size={120} />
          <ActivityIndicator color={Colors.yellow} />
        </View>
      </Screen>
    );
  }

  // Auto-login: an active session skips the landing page (web RedirectIfAuthed).
  if (session) return <Redirect href="/(app)/chat" />;

  return (
    <Screen>
      <View style={styles.hero}>
        <Logo size={140} />
        <Text style={styles.tagline}>Shop Smarter. Fetch Faster.</Text>
      </View>

      <View style={styles.actions}>
        <Button label="Create Account" onPress={() => router.push('/signup')} />
        <Button
          label="Sign In"
          variant="secondary"
          onPress={() => router.push('/login')}
        />
      </View>

      <Pressable
        onPress={() => setSheetOpen(true)}
        accessibilityRole="button"
        style={styles.learnMore}>
        <Text style={styles.learnMoreText}>Learn More</Text>
      </Pressable>

      <LearnMoreSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </Screen>
  );
}

/** Dark, slide-up bottom sheet explaining what FetchIt does. */
function LearnMoreSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Close"
          onPress={onClose}
        />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <Text style={styles.sheetHeading}>What is FetchIt?</Text>

          <View style={styles.bullets}>
            {BULLETS.map((bullet) => (
              <View key={bullet} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.bulletText}>{bullet}</Text>
              </View>
            ))}
          </View>

          <View style={styles.badge}>
            <Text style={styles.badgeText}>⚡ Powered by Grok 4.3</Text>
          </View>

          <Button label="Get Started" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  splash: { alignItems: 'center', gap: Spacing.lg },

  // Landing
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  tagline: {
    color: Colors.text,
    fontSize: FontSize.xxl,
    fontWeight: '800',
    textAlign: 'center',
  },
  actions: { gap: Spacing.md },
  learnMore: {
    alignSelf: 'center',
    paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
  },
  learnMoreText: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },

  // Bottom sheet
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surfaceAlt,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
  },
  sheetHeading: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '800',
  },
  bullets: { gap: Spacing.md },
  bulletRow: { flexDirection: 'row', gap: Spacing.sm },
  bulletDot: {
    color: Colors.yellow,
    fontSize: FontSize.md,
    lineHeight: 22,
    fontWeight: '800',
  },
  bulletText: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: FontSize.md,
    lineHeight: 22,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  badgeText: {
    color: Colors.yellow,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
});
