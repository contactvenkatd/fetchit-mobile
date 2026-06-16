import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

type Props = TextInputProps & {
  label?: string;
  error?: string;
  /** Render a show/hide toggle (for passwords). */
  secureToggle?: boolean;
};

/**
 * Labeled text input matching the FetchIt dark theme. Shows an inline error and
 * an optional show/hide toggle for password fields.
 */
export function TextField({
  label,
  error,
  secureToggle = false,
  style,
  ...props
}: Props) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(secureToggle);

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={[
          styles.inputRow,
          focused && styles.focused,
          !!error && styles.errored,
        ]}>
        <TextInput
          style={[styles.input, style]}
          placeholderTextColor={Colors.placeholder}
          secureTextEntry={secureToggle ? hidden : props.secureTextEntry}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...props}
        />
        {secureToggle ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}>
            <Text style={styles.toggle}>{hidden ? 'Show' : 'Hide'}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  label: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: '600' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
  },
  focused: { borderColor: Colors.borderFocus },
  errored: { borderColor: Colors.error },
  input: {
    flex: 1,
    color: Colors.text,
    fontSize: FontSize.md,
    paddingVertical: Spacing.md,
  },
  toggle: { color: Colors.yellow, fontSize: FontSize.sm, fontWeight: '600' },
  error: { color: Colors.error, fontSize: FontSize.xs },
});
