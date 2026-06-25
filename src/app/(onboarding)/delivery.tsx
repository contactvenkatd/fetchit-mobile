import { CardField, useStripe } from '@stripe/stripe-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import {
  createSetupIntent,
  createSubscription,
  saveCard,
  saveProfile,
} from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

// Onboarding step 3 — Delivery & Payment. Collects the shipping address and the
// card FetchIt charges, then either:
//   • Paid plan (Plus/Pro/Max): starts the subscription —
//     createSubscription → confirmPayment → saveCard → saveProfile → save plan.
//   • Free plan: just saves the card off-session —
//     createSetupIntent → confirmSetupIntent → saveCard → saveProfile.
// Both finish on the name step. The chosen plan arrives as a route param from
// the terms step. Edge-function errors already carry a human message (the
// readFnError pattern in src/lib/api.ts), so we surface `err.message` directly.

const EMPTY_ADDRESS = {
  fullName: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  zip: '',
  country: 'United States',
};

type AddressForm = typeof EMPTY_ADDRESS;

export default function DeliveryScreen() {
  const router = useRouter();
  const { plan: planParam } = useLocalSearchParams<{ plan?: string }>();
  const plan = typeof planParam === 'string' ? planParam : 'Free';
  const isPaid = plan !== 'Free';

  const { confirmPayment, confirmSetupIntent } = useStripe();

  // Shipping address.
  const [address, setAddress] = useState<AddressForm>(EMPTY_ADDRESS);
  const [savingAddress, setSavingAddress] = useState(false);

  // Payment card.
  const [cardComplete, setCardComplete] = useState(false);
  const [savingCard, setSavingCard] = useState(false);
  const [error, setError] = useState('');

  // Self-clearing toast for the address save (mirrors cards-address.tsx).
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  };
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const setField = (key: keyof AddressForm) => (value: string) =>
    setAddress((a) => ({ ...a, [key]: value }));

  // The trimmed address fields written to the profile on every save.
  const addressFields = () => ({
    fullName: address.fullName.trim(),
    addressLine1: address.addressLine1.trim(),
    addressLine2: address.addressLine2.trim(),
    city: address.city.trim(),
    state: address.state.trim(),
    zip: address.zip.trim(),
    country: address.country.trim() || 'United States',
  });

  async function handleSaveAddress() {
    setSavingAddress(true);
    const { error: saveErr } = await saveProfile(addressFields(), new Date().toISOString());
    setSavingAddress(false);
    showToast(saveErr ? "Couldn't save — try again." : 'Address saved! 🐕');
  }

  // Persist the Stripe ids + non-sensitive card metadata on the profile.
  async function persistCard(customerId: string | null, paymentMethodId: string, card: {
    brand?: string;
    last4?: string;
    expMonth?: number;
    expYear?: number;
  }) {
    await saveProfile(
      {
        stripeCustomerId: customerId,
        stripePaymentMethodId: paymentMethodId,
        cardBrand: card.brand ?? null,
        cardLast4: card.last4 ?? null,
        cardExpMonth: card.expMonth ?? null,
        cardExpYear: card.expYear ?? null,
      },
      new Date().toISOString(),
    );
  }

  async function handleContinue() {
    setError('');
    if (!cardComplete) {
      setError('Please enter your full card details.');
      return;
    }
    setSavingCard(true);

    if (isPaid) {
      // 1. Server reuses/creates the customer + an incomplete subscription and
      //    returns the first invoice's PaymentIntent client secret.
      const { data: sub, error: subErr } = await createSubscription({ plan, billing: 'monthly' });
      if (subErr || !sub) {
        setError(subErr?.message ?? 'Could not start your subscription.');
        setSavingCard(false);
        return;
      }

      // 2. Confirm the card payment on-device.
      const { paymentIntent, error: payErr } = await confirmPayment(sub.clientSecret, {
        paymentMethodType: 'Card',
      });
      if (payErr) {
        setError(payErr.message ?? 'Payment could not be completed.');
        setSavingCard(false);
        return;
      }

      const paymentMethodId = paymentIntent?.paymentMethod?.id;
      if (!paymentMethodId) {
        setError('Your card could not be saved.');
        setSavingCard(false);
        return;
      }

      // 3. Set the just-used card as the customer's default for off-session use.
      const { data: saved, error: cardErr } = await saveCard(paymentMethodId);
      if (cardErr) {
        setError(cardErr.message);
        setSavingCard(false);
        return;
      }

      // 4. Persist card metadata, record the plan, then continue.
      await persistCard(sub.customerId ?? null, paymentMethodId, saved?.card ?? {});
      await supabase.auth.updateUser({ data: { plan, plan_billing: 'monthly' } });
      setSavingCard(false);
      router.replace('/(onboarding)/name');
      return;
    }

    // Free plan: save the card off-session via a SetupIntent (no charge).
    const { data: setup, error: setupErr } = await createSetupIntent();
    if (setupErr || !setup) {
      setError(setupErr?.message ?? 'Could not start card setup.');
      setSavingCard(false);
      return;
    }

    const { setupIntent, error: confirmErr } = await confirmSetupIntent(setup.clientSecret, {
      paymentMethodType: 'Card',
      paymentMethodData: {
        billingDetails: {
          name: address.fullName.trim() || undefined,
          address: {
            line1: address.addressLine1.trim() || undefined,
            line2: address.addressLine2.trim() || undefined,
            city: address.city.trim() || undefined,
            state: address.state.trim() || undefined,
            postalCode: address.zip.trim() || undefined,
          },
        },
      },
    });
    if (confirmErr) {
      setError(confirmErr.message ?? 'Your card could not be saved.');
      setSavingCard(false);
      return;
    }

    const paymentMethodId = setupIntent?.paymentMethod?.id;
    if (!paymentMethodId) {
      setError('Your card could not be saved.');
      setSavingCard(false);
      return;
    }

    const { data: saved, error: cardErr } = await saveCard(paymentMethodId);
    if (cardErr) {
      setError(cardErr.message);
      setSavingCard(false);
      return;
    }

    await persistCard(setup.customerId ?? null, paymentMethodId, saved?.card ?? {});
    setSavingCard(false);
    router.replace('/(onboarding)/name');
  }

  // Free plan only — skip the card and just keep the address.
  async function handleSkip() {
    setSavingCard(true);
    await saveProfile(addressFields(), new Date().toISOString());
    setSavingCard(false);
    router.replace('/(onboarding)/name');
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Almost there! 🐕</Text>
          <Text style={styles.subtitle}>Where should we ship, and what should we charge?</Text>
        </View>

        {/* ---------- Shipping address ---------- */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Shipping address</Text>
          <Text style={styles.sectionSub}>Where FetchIt ships the things it buys for you.</Text>

          <TextField
            label="Full name"
            value={address.fullName}
            onChangeText={setField('fullName')}
            autoComplete="name"
            textContentType="name"
          />
          <TextField
            label="Address line 1"
            value={address.addressLine1}
            onChangeText={setField('addressLine1')}
            autoComplete="address-line1"
            textContentType="streetAddressLine1"
          />
          <TextField
            label="Address line 2 (optional)"
            value={address.addressLine2}
            onChangeText={setField('addressLine2')}
            autoComplete="address-line2"
            textContentType="streetAddressLine2"
          />
          <View style={styles.row}>
            <View style={styles.rowItem}>
              <TextField
                label="City"
                value={address.city}
                onChangeText={setField('city')}
                autoComplete="postal-address-locality"
                textContentType="addressCity"
              />
            </View>
            <View style={styles.rowItem}>
              <TextField
                label="State"
                value={address.state}
                onChangeText={setField('state')}
                autoComplete="postal-address-region"
                textContentType="addressState"
              />
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.rowItem}>
              <TextField
                label="ZIP code"
                value={address.zip}
                onChangeText={setField('zip')}
                autoComplete="postal-code"
                textContentType="postalCode"
                keyboardType="number-pad"
              />
            </View>
            <View style={styles.rowItem}>
              <TextField
                label="Country"
                value={address.country}
                onChangeText={setField('country')}
                autoComplete="country"
                textContentType="countryName"
              />
            </View>
          </View>

          <Button
            label="Save address"
            onPress={handleSaveAddress}
            loading={savingAddress}
            style={styles.saveBtn}
          />
        </View>

        {/* ---------- Payment card ---------- */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Payment method</Text>
          <Text style={styles.sectionSub}>
            {isPaid
              ? 'The card for your subscription and future checkouts.'
              : 'The card FetchIt charges when it checks out for you.'}
          </Text>

          <Text style={styles.fieldLabel}>Card details</Text>
          <CardField
            postalCodeEnabled
            placeholders={{ number: '4242 4242 4242 4242' }}
            onCardChange={(d) => setCardComplete(d.complete)}
            cardStyle={{
              backgroundColor: Colors.surface,
              textColor: Colors.text,
              placeholderColor: Colors.placeholder,
              borderColor: Colors.border,
              borderWidth: 1,
              borderRadius: Radius.sm,
              fontSize: FontSize.md,
              cursorColor: Colors.yellow,
            }}
            style={styles.cardField}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.note}>
            🔒 Secured by Stripe — your card is never stored on our servers. Test card
            4242 4242 4242 4242.
          </Text>

          <Button
            label={isPaid ? 'Subscribe & continue' : 'Save card & continue'}
            onPress={handleContinue}
            loading={savingCard}
            disabled={!cardComplete || savingCard}
          />
          {!isPaid ? (
            <Button
              label="Skip for now"
              variant="ghost"
              onPress={handleSkip}
              disabled={savingCard}
            />
          ) : null}
        </View>
      </ScrollView>

      <Pressable
        onPress={() => router.back()}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={({ pressed }) => [styles.back, pressed && styles.backPressed]}>
        <Text style={styles.backIcon}>←</Text>
      </Pressable>

      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.lg,
    gap: Spacing.md,
  },
  header: { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
  title: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: Colors.textMuted, fontSize: FontSize.md, textAlign: 'center' },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  sectionTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '800' },
  sectionSub: { color: Colors.textMuted, fontSize: FontSize.sm, marginBottom: Spacing.xs },
  row: { flexDirection: 'row', gap: Spacing.md },
  rowItem: { flex: 1 },
  saveBtn: { alignSelf: 'stretch', marginTop: Spacing.sm },
  fieldLabel: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: '600' },
  cardField: { width: '100%', height: 50, marginVertical: Spacing.xs },
  note: { color: Colors.textFaint, fontSize: FontSize.xs, lineHeight: 18 },
  error: { color: Colors.error, fontSize: FontSize.sm },
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
  toast: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: Spacing.xl,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
  },
  toastText: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '600' },
});
