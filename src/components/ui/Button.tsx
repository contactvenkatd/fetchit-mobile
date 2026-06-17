import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * App-wide button. `primary` is the yellow FetchIt CTA; `secondary` is a
 * charcoal pill with a yellow border; `ghost` is text-only (links, "Skip");
 * `danger` is an outlined pill with a red border + red text (destructive
 * actions like sign out / delete).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        variant === 'danger' && styles.danger,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}>
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator
            color={
              variant === 'primary'
                ? Colors.charcoal
                : variant === 'danger'
                  ? Colors.error
                  : Colors.yellow
            }
          />
        ) : (
          <Text
            style={[
              styles.label,
              variant === 'primary' && styles.labelPrimary,
              (variant === 'secondary' || variant === 'ghost') &&
                styles.labelAccent,
              variant === 'danger' && styles.labelDanger,
            ]}>
            {label}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.pill,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: Colors.yellow },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.yellow,
  },
  ghost: { backgroundColor: 'transparent', paddingVertical: Spacing.sm },
  danger: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.error,
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  content: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  label: { fontSize: FontSize.md, fontWeight: '700' },
  labelPrimary: { color: Colors.charcoal },
  labelAccent: { color: Colors.yellow },
  labelDanger: { color: Colors.error },
});
