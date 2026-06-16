import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { Colors, Spacing } from '@/theme/colors';

/**
 * Dark, safe-area-aware page container — the FetchIt charcoal background applied
 * everywhere. Pass `padded` for the standard horizontal gutter, and `center`
 * to vertically center content (used by auth/onboarding cards).
 */
export function Screen({
  children,
  padded = true,
  center = false,
  edges = ['top', 'bottom'],
  style,
}: {
  children: ReactNode;
  padded?: boolean;
  center?: boolean;
  edges?: Edge[];
  style?: ViewStyle;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <View
        style={[
          styles.body,
          padded && styles.padded,
          center && styles.center,
          style,
        ]}>
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1 },
  padded: { paddingHorizontal: Spacing.lg },
  center: { justifyContent: 'center' },
});
