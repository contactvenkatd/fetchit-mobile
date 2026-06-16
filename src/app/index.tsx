import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth';
import { Colors, FontSize, Spacing } from '@/theme/colors';

export default function Landing() {
  const router = useRouter();
  const { session, loading } = useAuth();

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
    <Screen padded={false}>
      <LinearGradient
        colors={[Colors.background, '#241f08']}
        style={styles.fill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}>
        <View style={styles.hero}>
          <Logo size={140} />
          <Text style={styles.headline}>Shop Smarter. Fetch Faster.</Text>
          <Text style={styles.tagline}>Your shopping best friend 🐕</Text>
          <Text style={styles.sub}>
            FetchIt&apos;s AI searches Amazon, Walmart, Target, Best Buy and more
            — then checks out for you automatically.
          </Text>
        </View>

        <View style={styles.actions}>
          <Button label="Create Account" onPress={() => router.push('/signup')} />
          <Button
            label="Sign In"
            variant="secondary"
            onPress={() => router.push('/login')}
          />
        </View>
      </LinearGradient>
    </Screen>
  );
}

const styles = StyleSheet.create({
  splash: { alignItems: 'center', gap: Spacing.lg },
  fill: { flex: 1, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xxl },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  headline: {
    color: Colors.text,
    fontSize: FontSize.display,
    fontWeight: '800',
    textAlign: 'center',
  },
  tagline: { color: Colors.yellow, fontSize: FontSize.lg, fontWeight: '700' },
  sub: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: Spacing.sm,
  },
  actions: { gap: Spacing.md },
});
