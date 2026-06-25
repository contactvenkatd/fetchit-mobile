import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { FontSize, Radius, Spacing } from '@/theme/colors';

// Google brand spec values — deliberately hardcoded (not theme tokens): the
// "Continue with Google" button is a brand element with a fixed white surface,
// a #DADCE0 hairline border, and #1F1F1F label per Google's sign-in guidelines.
const GOOGLE_BG = '#FFFFFF';
const GOOGLE_BORDER = '#DADCE0';
const GOOGLE_TEXT = '#1F1F1F';

// The official multicolor Google "G" mark (same paths as the web app's
// GoogleButton.js), drawn with react-native-svg.
function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" accessibilityRole="image">
      <Path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <Path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <Path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <Path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </Svg>
  );
}

/**
 * "Continue with Google" — white surface, multicolor Google "G" on the left, and
 * a dark label. The mobile counterpart of the web `GoogleButton`.
 */
export function GoogleButton({
  onPress,
  loading = false,
  disabled = false,
  label = 'Continue with Google',
}: {
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  label?: string;
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
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
      ]}>
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={GOOGLE_TEXT} />
        ) : (
          <>
            <GoogleG />
            <Text style={styles.label}>{label}</Text>
          </>
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
    backgroundColor: GOOGLE_BG,
    borderWidth: 1,
    borderColor: GOOGLE_BORDER,
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  content: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  label: { color: GOOGLE_TEXT, fontSize: FontSize.md, fontWeight: '600' },
});
