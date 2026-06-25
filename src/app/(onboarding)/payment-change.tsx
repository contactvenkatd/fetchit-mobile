import { CardField, useStripe } from '@stripe/stripe-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';
import { createSubscription, getProfile, saveCard } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

// Plan-switch step — reached only by EXISTING users from Account Settings'
// "Change Plan" (plans.tsx routes here when mode=change). It is purely the
// billing change: no address, no terms, no name step. The chosen plan arrives as
// a route param.
//   • Paid plan, card on file: createSubscription charges the saved default card
//     off-session (no client secret to confirm) → record plan.
//   • Paid plan, no card: collect one via CardField, confirmPayment → saveCard.
//   • Free (downgrade): no charge — just record the plan.
// Either way it lands back on /(app)/account.

const brandLabel = (b: string | null) =>
  b ? b.charAt(0).toUpperCase() + b.slice(1) : 'Card';
const formatExpiry = (m: number | null, y: number | null) =>
  m && y ? `${String(m).padStart(2, '0')}/${String(y).slice(-2)}` : '';

type SavedCard = {
  paymentMethodId: string | null;
  brand: string | null;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
};

export default function PaymentChangeScreen() {
  const router = useRouter();
  const { plan: planParam } = useLocalSearchParams<{ plan?: string }>();
  const plan = typeof planParam === 'string' ? planParam : '';
  const isPaid = plan !== '' && plan !== 'Free';
  const billing = 'monthly' as const; // plans screen offers monthly pricing

  const { confirmPayment } = useStripe();
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [card, setCard] = useState<SavedCard | null>(null);
  const [cardComplete, setCardComplete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const hasCard = !!card;

  // Load the saved card once on mount so paid changes can charge it off-session
  // instead of re-collecting card details.
  useEffect(() => {
    let active = true;
    getProfile().then((p) => {
      if (!active) return;
      if (p?.cardLast4) {
        setCard({
          paymentMethodId: p.stripePaymentMethodId,
          brand: p.cardBrand,
          last4: p.cardLast4,
          expMonth: p.cardExpMonth,
          expYear: p.cardExpYear,
        });
      }
      setLoadingProfile(false);
    });
    return () => {
      active = false;
    };
  }, []);

  function backToAccount() {
    router.canGoBack() ? router.back() : router.replace('/(app)/account');
  }

  async function handleConfirm() {
    setError('');
    if (!plan) {
      setError('No plan selected. Go back and choose a plan.');
      return;
    }
    setSaving(true);

    // Downgrade to Free — no payment, just record the new plan.
    if (!isPaid) {
      await supabase.auth.updateUser({ data: { plan: 'Free', plan_billing: billing } });
      setSaving(false);
      router.replace('/(app)/account');
      return;
    }

    // With no card on file we must collect one via the CardField first.
    if (!hasCard && !cardComplete) {
      setError('Please enter your full card details.');
      setSaving(false);
      return;
    }

    // 1. Server reuses/creates the customer + subscription. When a default
    //    payment method is already on file it charges off-session and returns NO
    //    clientSecret; otherwise it returns the first invoice's PaymentIntent
    //    clientSecret to confirm on-device.
    const { data: sub, error: subErr } = await createSubscription({ plan, billing });
    if (subErr || !sub) {
      setError(subErr?.message ?? 'Could not start your subscription.');
      setSaving(false);
      return;
    }

    if (sub.clientSecret) {
      // 2a. Confirm the card payment on-device (new card, or SCA required).
      const { paymentIntent, error: payErr } = await confirmPayment(sub.clientSecret, {
        paymentMethodType: 'Card',
      });
      if (payErr) {
        setError(payErr.message ?? 'Payment could not be completed.');
        setSaving(false);
        return;
      }
      // Set the just-used card as the customer's default (best-effort).
      const paymentMethodId = paymentIntent?.paymentMethod?.id;
      if (paymentMethodId) {
        const { error: cardErr } = await saveCard(paymentMethodId);
        if (cardErr) console.warn('saveCard after plan change failed:', cardErr.message);
      }
    } else if (card?.paymentMethodId) {
      // 2b. Subscription completed immediately against the saved default card —
      //     nothing to confirm. Re-assert the default (no-op if already set).
      const { error: cardErr } = await saveCard(card.paymentMethodId);
      if (cardErr) console.warn('saveCard after plan change failed:', cardErr.message);
    }

    // 3. Record the new plan on the user.
    await supabase.auth.updateUser({ data: { plan, plan_billing: billing } });

    setSaving(false);
    router.replace('/(app)/account');
  }

  if (loadingProfile) {
    return (
      <AuthLayout
        title={isPaid ? `Switch to ${plan}` : 'Switch to Free'}
        onBack={backToAccount}>
        <ActivityIndicator color={Colors.yellow} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={isPaid ? `Switch to ${plan}` : 'Switch to Free'}
      subtitle={
        isPaid
          ? hasCard
            ? 'Confirm to start your new plan'
            : 'Add a card to start the new plan'
          : "You'll move to the Free plan — no charge"
      }
      onBack={backToAccount}>
      {isPaid && hasCard ? (
        <>
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
          <Text style={styles.chargeNote}>FetchIt will charge this card.</Text>
        </>
      ) : null}

      {isPaid && !hasCard ? (
        <>
          <Text style={styles.label}>Card details</Text>
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
        </>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label={isPaid ? 'Confirm change' : 'Switch to Free'}
        onPress={handleConfirm}
        loading={saving}
        disabled={isPaid && !hasCard && !cardComplete}
      />
      {isPaid ? (
        <Text style={styles.note}>🔒 Secured by Stripe · Cancel anytime</Text>
      ) : null}
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  label: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: '600' },
  cardField: { width: '100%', height: 50, marginVertical: Spacing.xs },
  error: { color: Colors.error, fontSize: FontSize.sm, textAlign: 'center' },
  note: { color: Colors.textFaint, fontSize: FontSize.xs, textAlign: 'center' },
  // Saved-card display row (mirrors cards-address.tsx).
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
  chargeNote: { color: Colors.textMuted, fontSize: FontSize.sm },
});
