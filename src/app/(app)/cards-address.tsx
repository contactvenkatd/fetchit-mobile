import { CardField, useStripe } from '@stripe/stripe-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import {
  createSetupIntent,
  getProfile,
  saveCard,
  saveProfile,
  type Profile,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

// Cards & Address — native port of the web app's CardsAddressPage.js.
//
// Two sections backed by the shared `profiles` table:
//   • Shipping address — where FetchIt ships what it buys (saveProfile).
//   • Payment method   — the card FetchIt charges, saved for off-session use via
//     createSetupIntent → confirmSetupIntent → saveCard, then the returned
//     brand/last4 metadata is persisted on the profile.
//
// DEVIATION from web: the web gates this page behind a reauthentication wall
// (<ReauthGate> — password or Google). That component isn't ported to mobile
// yet, so we load the profile directly. Add the gate here once it exists.

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
type SavedCard = {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
};

const brandLabel = (b: string | null) =>
  b ? b.charAt(0).toUpperCase() + b.slice(1) : 'Card';
const formatExpiry = (m: number | null, y: number | null) =>
  m && y ? `${String(m).padStart(2, '0')}/${String(y).slice(-2)}` : '';

function cardFromProfile(p: Profile): SavedCard | null {
  return p.cardLast4
    ? { brand: p.cardBrand, last4: p.cardLast4, expMonth: p.cardExpMonth, expYear: p.cardExpYear }
    : null;
}

export default function CardsAddressScreen() {
  const { session, loading: authLoading } = useAuth();
  const { confirmSetupIntent } = useStripe();

  // Profile / address.
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [address, setAddress] = useState<AddressForm>(EMPTY_ADDRESS);
  const [savingAddress, setSavingAddress] = useState(false);

  // Saved card + the "update card" sub-form.
  const [card, setCard] = useState<SavedCard | null>(null);
  const [editingCard, setEditingCard] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);
  const [cardError, setCardError] = useState('');
  const [savingCard, setSavingCard] = useState(false);

  // Lightweight toast (web uses a <Toast>; here a self-clearing banner).
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

  // Load the profile once auth resolves.
  useEffect(() => {
    if (authLoading || !session) return;
    let active = true;
    setLoadingProfile(true);
    getProfile().then((p) => {
      if (!active) return;
      if (p) {
        setAddress({
          fullName: p.fullName,
          addressLine1: p.addressLine1,
          addressLine2: p.addressLine2,
          city: p.city,
          state: p.state,
          zip: p.zip,
          country: p.country || 'United States',
        });
        setCard(cardFromProfile(p));
      }
      setLoadingProfile(false);
    });
    return () => {
      active = false;
    };
  }, [authLoading, session]);

  const setField = (key: keyof AddressForm) => (value: string) =>
    setAddress((a) => ({ ...a, [key]: value }));

  async function handleSaveAddress() {
    setSavingAddress(true);
    const { error } = await saveProfile(
      {
        fullName: address.fullName.trim(),
        addressLine1: address.addressLine1.trim(),
        addressLine2: address.addressLine2.trim(),
        city: address.city.trim(),
        state: address.state.trim(),
        zip: address.zip.trim(),
        country: address.country.trim() || 'United States',
      },
      new Date().toISOString(),
    );
    setSavingAddress(false);
    showToast(error ? "Couldn't save — try again." : 'Address updated! 🐕');
  }

  async function handleSaveCard() {
    setCardError('');
    if (!cardComplete) {
      setCardError('Please enter your full card details.');
      return;
    }
    setSavingCard(true);

    // 1. Server reuses/creates the customer and starts a SetupIntent (saves the
    //    card for later off-session charges — NO charge now).
    const { data: setup, error: setupErr } = await createSetupIntent();
    if (setupErr || !setup) {
      setCardError(setupErr?.message ?? 'Could not start card setup.');
      setSavingCard(false);
      return;
    }

    // 2. Confirm the SetupIntent on-device. The CardField holds the entered
    //    details; we attach the shipping name/address as billing details.
    const { setupIntent, error: cardErr } = await confirmSetupIntent(setup.clientSecret, {
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
    if (cardErr) {
      setCardError(cardErr.message ?? 'Your card could not be saved.');
      setSavingCard(false);
      return;
    }

    const paymentMethodId = setupIntent?.paymentMethod?.id;
    if (!paymentMethodId) {
      setCardError('Your card could not be saved.');
      setSavingCard(false);
      return;
    }

    // 3. Set the card as the customer's default and get back display metadata.
    const { data: saved, error: saveErr } = await saveCard(paymentMethodId);
    if (saveErr) {
      setCardError(saveErr.message);
      setSavingCard(false);
      return;
    }

    // 4. Persist the Stripe ids + non-sensitive card metadata on the profile.
    const c = saved?.card ?? {};
    await saveProfile(
      {
        stripeCustomerId: setup.customerId ?? null,
        stripePaymentMethodId: paymentMethodId,
        cardBrand: c.brand ?? null,
        cardLast4: c.last4 ?? null,
        cardExpMonth: c.expMonth ?? null,
        cardExpYear: c.expYear ?? null,
      },
      new Date().toISOString(),
    );

    setCard(
      c.last4
        ? { brand: c.brand ?? null, last4: c.last4, expMonth: c.expMonth ?? null, expYear: c.expYear ?? null }
        : null,
    );
    setEditingCard(false);
    setCardComplete(false);
    setSavingCard(false);
    showToast('Card updated! 🐕');
  }

  if (authLoading || loadingProfile) {
    return (
      <Screen center>
        <ActivityIndicator color={Colors.yellow} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* ---------- Shipping address ---------- */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Shipping address</Text>
          <Text style={styles.sectionSub}>
            Where FetchIt ships the things it buys for you.
          </Text>

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
            label="Save changes"
            onPress={handleSaveAddress}
            loading={savingAddress}
            style={styles.saveBtn}
          />
        </View>

        {/* ---------- Payment method ---------- */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Payment method</Text>
          <Text style={styles.sectionSub}>
            The card FetchIt charges when it checks out for you.
          </Text>

          {card ? (
            <View style={styles.cardRow}>
              <Text style={styles.cardIcon}>💳</Text>
              <View style={styles.cardInfo}>
                <Text style={styles.cardBrand}>
                  {brandLabel(card.brand)} •••• {card.last4}
                </Text>
                <Text style={styles.cardExp}>
                  Expires {formatExpiry(card.expMonth, card.expYear)}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={styles.noCard}>No card on file yet.</Text>
          )}

          {!editingCard ? (
            <Button
              label={card ? 'Update card' : 'Add card'}
              variant="secondary"
              onPress={() => {
                setCardError('');
                setEditingCard(true);
              }}
              style={styles.saveBtn}
            />
          ) : (
            <View style={styles.cardForm}>
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

              {cardError ? <Text style={styles.error}>{cardError}</Text> : null}
              <Text style={styles.note}>
                🔒 Secured by Stripe — your card is never stored on our servers.
                Test card 4242 4242 4242 4242.
              </Text>

              <Button
                label="Save card"
                onPress={handleSaveCard}
                loading={savingCard}
                disabled={!cardComplete}
              />
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => {
                  setEditingCard(false);
                  setCardError('');
                  setCardComplete(false);
                }}
                disabled={savingCard}
              />
            </View>
          )}
        </View>
      </ScrollView>

      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: Spacing.lg, gap: Spacing.md },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  sectionTitle: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '800' },
  sectionSub: {
    color: Colors.textMuted,
    fontSize: FontSize.sm,
    marginBottom: Spacing.xs,
  },
  row: { flexDirection: 'row', gap: Spacing.md },
  rowItem: { flex: 1 },
  saveBtn: { alignSelf: 'stretch', marginTop: Spacing.sm },
  // Saved-card display row
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  cardIcon: { fontSize: 24 },
  cardInfo: { gap: 2 },
  cardBrand: { color: Colors.text, fontSize: FontSize.md, fontWeight: '700' },
  cardExp: { color: Colors.textMuted, fontSize: FontSize.sm },
  noCard: { color: Colors.textMuted, fontSize: FontSize.sm },
  // Card edit sub-form
  cardForm: { gap: Spacing.sm, marginTop: Spacing.sm },
  fieldLabel: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: '600' },
  cardField: { width: '100%', height: 50, marginVertical: Spacing.xs },
  note: { color: Colors.textFaint, fontSize: FontSize.xs, lineHeight: 18 },
  error: { color: Colors.error, fontSize: FontSize.sm },
  // Toast
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
