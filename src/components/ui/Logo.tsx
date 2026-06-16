import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

const SOURCE = require('@/assets/images/fetchit-logo.png');

/**
 * The FetchIt logo badge (single square image). `size` sets the rendered
 * square; use large on the landing/auth hero, small (~44) on tight top bars.
 */
export function Logo({ size = 96 }: { size?: number }) {
  return (
    <Image
      source={SOURCE}
      style={[styles.logo, { width: size, height: size }]}
      contentFit="contain"
      accessibilityLabel="FetchIt"
    />
  );
}

const styles = StyleSheet.create({
  logo: { borderRadius: 18 },
});
