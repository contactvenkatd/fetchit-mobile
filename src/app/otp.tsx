import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';

import { Logo } from '@/components/ui/Logo';
import { Screen } from '@/components/ui/Screen';
import { supabase } from '@/lib/supabase';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

const LENGTH = 8;
const COOLDOWN_SECONDS = 30;
const EMPTY = Array.from({ length: LENGTH }, () => '');

export default function OtpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; mode?: string }>();
  const email = String(params.email ?? '').trim();
  // Anything that isn't an explicit "login" is treated as the signup flow.
  const mode = params.mode === 'login' ? 'login' : 'signup';

  const [digits, setDigits] = useState<string[]>(EMPTY);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(COOLDOWN_SECONDS);

  const inputs = useRef<Array<TextInput | null>>([]);
  const shake = useRef(new Animated.Value(0)).current;

  // Resend cooldown countdown (also runs once on mount — a code was just sent).
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  function runShake() {
    shake.setValue(0);
    Animated.sequence(
      [10, -10, 8, -8, 5, 0].map((toValue) =>
        Animated.timing(shake, {
          toValue,
          duration: 55,
          useNativeDriver: true,
        }),
      ),
    ).start();
  }

  async function verify(code: string) {
    if (verifying) return;
    setVerifying(true);
    setError('');

    const { error: otpError } = await supabase.auth.verifyOtp({
      email,
      token: code,
      // Login uses the email-OTP flow; signup confirms via the signup token.
      type: mode === 'login' ? 'email' : 'signup',
    });

    setVerifying(false);

    if (otpError) {
      setError('That code is incorrect or expired. Please try again.');
      setDigits(EMPTY);
      runShake();
      inputs.current[0]?.focus();
      return;
    }

    // onAuthStateChange updates the auth context; route by flow.
    router.replace(mode === 'login' ? '/(app)/chat' : '/(onboarding)/plans');
  }

  function handleChange(text: string, index: number) {
    const clean = text.replace(/\D/g, '');

    // Paste / iOS one-time-code autofill: distribute across boxes from here.
    if (clean.length > 1) {
      const next = [...digits];
      let i = index;
      for (const ch of clean) {
        if (i >= LENGTH) break;
        next[i] = ch;
        i += 1;
      }
      setDigits(next);
      inputs.current[Math.min(i, LENGTH - 1)]?.focus();
      if (next.every((d) => d !== '')) verify(next.join(''));
      return;
    }

    // Single character — take the last typed digit (handles overwrite via
    // selectTextOnFocus); empty string means the box was cleared.
    const digit = clean.slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);

    if (digit && index < LENGTH - 1) inputs.current[index + 1]?.focus();
    if (digit && next.every((d) => d !== '')) verify(next.join(''));
  }

  function handleKeyPress(
    e: NativeSyntheticEvent<TextInputKeyPressEventData>,
    index: number,
  ) {
    if (e.nativeEvent.key !== 'Backspace') return;
    // On an empty box, hop back and clear the previous one.
    if (!digits[index] && index > 0) {
      const next = [...digits];
      next[index - 1] = '';
      setDigits(next);
      inputs.current[index - 1]?.focus();
    }
  }

  async function resend() {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setError('');

    // Signup confirmation vs. email-OTP login use different Supabase calls.
    const { error: resendError } =
      mode === 'login'
        ? await supabase.auth.signInWithOtp({ email })
        : await supabase.auth.resend({ type: 'signup', email });

    setResending(false);

    if (resendError) {
      setError('Could not resend the code. Please try again in a moment.');
      return;
    }
    setDigits(EMPTY);
    setCooldown(COOLDOWN_SECONDS);
    inputs.current[0]?.focus();
  }

  return (
    <Screen>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={({ pressed }) => [styles.back, pressed && styles.backPressed]}>
        <Text style={styles.backIcon}>←</Text>
      </Pressable>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          <Logo size={64} />

          <View style={styles.headingBlock}>
            <Text style={styles.heading}>Check Your Email</Text>
            <Text style={styles.subtext}>We sent an 8-digit code to</Text>
            <Text style={styles.email}>{email || 'your email'}</Text>
          </View>

          <Animated.View
            style={[styles.boxRow, { transform: [{ translateX: shake }] }]}>
            {digits.map((digit, index) => (
              <TextInput
                key={index}
                ref={(el) => {
                  inputs.current[index] = el;
                }}
                value={digit}
                onChangeText={(text) => handleChange(text, index)}
                onKeyPress={(e) => handleKeyPress(e, index)}
                onFocus={() => setFocusedIndex(index)}
                onBlur={() => setFocusedIndex(null)}
                style={[
                  styles.box,
                  focusedIndex === index && styles.boxFocused,
                  !!error && styles.boxErrored,
                ]}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={1}
                selectTextOnFocus
                editable={!verifying}
                autoFocus={index === 0}
                returnKeyType="done"
                selectionColor={Colors.yellow}
                accessibilityLabel={`Digit ${index + 1}`}
              />
            ))}
          </Animated.View>

          <View style={styles.status}>
            {verifying ? (
              <ActivityIndicator color={Colors.yellow} />
            ) : error ? (
              <Text style={styles.error}>{error}</Text>
            ) : null}
          </View>

          <View style={styles.resendRow}>
            <Text style={styles.resendText}>Didn&apos;t receive a code? </Text>
            {cooldown > 0 ? (
              <Text style={styles.resendCountdown}>Resend in {cooldown}s</Text>
            ) : (
              <Pressable onPress={resend} hitSlop={8} disabled={resending}>
                <Text style={styles.resendLink}>
                  {resending ? 'Sending…' : 'Resend code'}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.xl,
  },

  // Back arrow (matches AuthLayout's back button)
  back: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.md,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  backPressed: { opacity: 0.6 },
  backIcon: { color: Colors.yellow, fontSize: 28, fontWeight: '600', lineHeight: 28 },

  headingBlock: { alignItems: 'center', gap: Spacing.xs },
  heading: {
    color: Colors.text,
    fontSize: FontSize.display,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtext: {
    color: Colors.textMuted,
    fontSize: FontSize.md,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  email: {
    color: Colors.yellow,
    fontSize: FontSize.md,
    fontWeight: '700',
    textAlign: 'center',
  },

  // Flex boxes so all 8 digits fit edge-to-edge on any phone width.
  boxRow: { flexDirection: 'row', gap: Spacing.xs, alignSelf: 'stretch' },
  box: {
    flex: 1,
    minWidth: 0,
    aspectRatio: 0.66,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '700',
    textAlign: 'center',
  },
  boxFocused: { borderColor: Colors.yellow },
  boxErrored: { borderColor: Colors.error },

  // Fixed-height slot so the layout doesn't jump between spinner/error/empty.
  status: { height: 24, justifyContent: 'center' },
  error: {
    color: Colors.error,
    fontSize: FontSize.sm,
    textAlign: 'center',
    paddingHorizontal: Spacing.md,
  },

  resendRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' },
  resendText: { color: Colors.textMuted, fontSize: FontSize.sm },
  resendCountdown: { color: Colors.textFaint, fontSize: FontSize.sm, fontWeight: '600' },
  resendLink: { color: Colors.yellow, fontSize: FontSize.sm, fontWeight: '700' },
});
