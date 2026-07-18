import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Radius } from '@/theme/colors';

const APPLE_BG = '#FFFFFF';
const APPLE_TEXT = '#000000';

/**
 * Native, Apple-approved "Continue with Apple" button. It mirrors the
 * GoogleButton interaction props while letting AuthenticationServices own the
 * Apple logo, typography, localization, and accessibility.
 */
export function AppleButton({
  onPress,
  loading = false,
  disabled = false,
}: {
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    AppleAuthentication.isAvailableAsync()
      .then((isAvailable) => {
        if (active) setAvailable(isAvailable);
      })
      .catch(() => {
        if (active) setAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!available) return null;

  const isDisabled = disabled || loading;
  return (
    <View
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={[styles.container, isDisabled && styles.disabled]}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={Radius.pill}
        onPress={() => {
          if (!isDisabled) onPress?.();
        }}
        style={styles.button}
      />
      {loading ? (
        <View pointerEvents="none" style={styles.loading}>
          <ActivityIndicator color={APPLE_TEXT} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 52,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    backgroundColor: APPLE_BG,
  },
  button: { width: '100%', height: '100%' },
  disabled: { opacity: 0.5 },
  loading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: APPLE_BG,
  },
});
