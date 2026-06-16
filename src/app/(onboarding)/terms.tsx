import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

// Step 2 — TOS agreement (the web app's /terms). A summary + a single checkbox;
// Continue is disabled until the box is checked. (A full port also writes
// tos_accepted to the profiles table.)
export default function TermsAgreementScreen() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);

  return (
    <AuthLayout title="Before we get started" subtitle="A few quick things to agree to">
      <View style={styles.summary}>
        <Text style={styles.point}>• A service fee applies to every order</Text>
        <Text style={styles.point}>• Shopping data may train AI models</Text>
        <Text style={styles.point}>• You must be 18 or older</Text>
        <Text style={styles.point}>• Orders are placed via third-party retailers</Text>
      </View>

      <Pressable style={styles.checkRow} onPress={() => setAgreed((a) => !a)}>
        <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
          {agreed ? <Text style={styles.checkmark}>✓</Text> : null}
        </View>
        <Text style={styles.checkLabel}>
          I have read and agree to the{' '}
          <Link href="/tos" style={styles.link}>
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy-policy" style={styles.link}>
            Privacy Policy
          </Link>
        </Text>
      </Pressable>

      <Button
        label="Continue"
        disabled={!agreed}
        onPress={() => router.push('/(onboarding)/delivery')}
      />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  summary: { gap: Spacing.xs },
  point: { color: Colors.textMuted, fontSize: FontSize.sm, lineHeight: 22 },
  checkRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: Radius.sm,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: Colors.yellow, borderColor: Colors.yellow },
  checkmark: { color: Colors.charcoal, fontWeight: '900', fontSize: FontSize.sm },
  checkLabel: { color: Colors.textMuted, fontSize: FontSize.sm, flex: 1, lineHeight: 20 },
  link: { color: Colors.yellow, fontWeight: '700' },
});
