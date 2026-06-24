import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, FontSize, Spacing } from '@/theme/colors';

// Reusable dark-theme prose primitives for the legal pages (Terms of Service,
// Privacy Policy) — the native counterpart of the web app's TosPage.css prose
// column. Yellow accents on headings, readable muted body text, indented
// bullets.

export function H1({ children }: { children: ReactNode }) {
  return <Text style={styles.h1}>{children}</Text>;
}

export function H2({ children }: { children: ReactNode }) {
  return <Text style={styles.h2}>{children}</Text>;
}

export function H3({ children }: { children: ReactNode }) {
  return <Text style={styles.h3}>{children}</Text>;
}

export function P({ children }: { children: ReactNode }) {
  return <Text style={styles.p}>{children}</Text>;
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <View style={styles.bullets}>
      {items.map((item, i) => (
        <View key={i} style={styles.bulletRow}>
          <Text style={styles.bulletDot}>•</Text>
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export function Dates({ effective, updated }: { effective: string; updated: string }) {
  return (
    <Text style={styles.dates}>
      <Text style={styles.bold}>Effective Date:</Text> {effective}
      {'\n'}
      <Text style={styles.bold}>Last Updated:</Text> {updated}
    </Text>
  );
}

export function Closing({ children }: { children: ReactNode }) {
  return <Text style={styles.closing}>{children}</Text>;
}

export const Bold = ({ children }: { children: ReactNode }) => (
  <Text style={styles.bold}>{children}</Text>
);

const styles = StyleSheet.create({
  h1: {
    color: Colors.text,
    fontSize: FontSize.xxl,
    fontWeight: '800',
    marginBottom: Spacing.sm,
  },
  h2: {
    color: Colors.yellow,
    fontSize: FontSize.lg,
    fontWeight: '700',
    marginTop: Spacing.lg,
    marginBottom: Spacing.xs,
  },
  h3: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '700',
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  p: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    lineHeight: 22,
    marginBottom: Spacing.sm,
  },
  dates: {
    color: Colors.textFaint,
    fontSize: FontSize.sm,
    lineHeight: 22,
    marginBottom: Spacing.md,
  },
  bold: { color: Colors.text, fontWeight: '700' },
  bullets: { gap: Spacing.xs, marginBottom: Spacing.sm },
  bulletRow: { flexDirection: 'row', gap: Spacing.sm },
  bulletDot: { color: Colors.yellow, fontSize: FontSize.sm, lineHeight: 22 },
  bulletText: { flex: 1, color: Colors.textMuted, fontSize: FontSize.sm, lineHeight: 22 },
  closing: {
    color: Colors.text,
    fontSize: FontSize.sm,
    lineHeight: 22,
    fontStyle: 'italic',
    marginTop: Spacing.lg,
  },
});
