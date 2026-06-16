import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

/**
 * Themed stub for screens whose UI hasn't been ported from the web app yet.
 * Each lists what it will contain so the navigation graph is browsable end-to-end
 * while the real implementations land. (Login + Signup are fully built; the rest
 * start here.)
 */
export function ScreenPlaceholder({
  emoji,
  title,
  description,
  bullets = [],
}: {
  emoji: string;
  title: string;
  description: string;
  bullets?: string[];
}) {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.emoji}>{emoji}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>

        {bullets.length > 0 ? (
          <View style={styles.card}>
            {bullets.map((b) => (
              <View key={b} style={styles.bulletRow}>
                <Text style={styles.dot}>•</Text>
                <Text style={styles.bullet}>{b}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={styles.note}>Coming soon — ported from the web app.</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xl,
  },
  emoji: { fontSize: 56 },
  title: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: '800' },
  description: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  card: {
    alignSelf: 'stretch',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  bulletRow: { flexDirection: 'row', gap: Spacing.sm },
  dot: { color: Colors.yellow, fontSize: FontSize.md },
  bullet: { color: Colors.textMuted, fontSize: FontSize.sm, flex: 1, lineHeight: 20 },
  note: { color: Colors.textFaint, fontSize: FontSize.xs, marginTop: Spacing.sm },
});
