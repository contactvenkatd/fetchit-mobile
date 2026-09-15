import {
  CardForm,
  PlatformPay,
  PlatformPayButton,
  useStripe,
} from '@stripe/stripe-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';
import { cancelStripeSubscriptions, createSubscription, getProfile, saveCard } from '@/lib/api';
import { monthlyDisplay, type PlanName } from '@/lib/stripe';
import { supabase } from '@/lib/supabase';
import { getPlan, useAuth } from '@/lib/auth';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

// Plan-switch step — reached only by EXISTING users from Account Settings'
// "Change Plan" (plans.tsx routes here when mode=change). It is purely the
// billing change: no address, no terms, no name step. The chosen plan arrives as
// a route param.
//   • Paid plan, card on file: confirm the saved card on-device, then cancel
//     the previous subscription with the same policy as the web app.
//   • Paid plan, no card: collect one via CardForm, confirmPayment → saveCard.
//   • Free (downgrade): schedule Stripe cancellation at period end.
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
  const { session } = useAuth();
  const previousPlan = useRef(getPlan(session));
  const [paidSubscriptionId, setPaidSubscriptionId] = useState<string | null>(null);
  const { plan: planParam } = useLocalSearchParams<{ plan?: string }>();
  const plan = typeof planParam === 'string' ? planParam : '';
  const isPaid = plan !== '' && plan !== 'Free';
  const billing = 'monthly' as const; // plans screen offers monthly pricing

  const {
    confirmPayment,
    confirmPlatformPayPayment,
    isPlatformPaySupported,
  } = useStripe();
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [card, setCard] = useState<SavedCard | null>(null);
  const [cardComplete, setCardComplete] = useState(false);
  const [applePaySupported, setApplePaySupported] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const hasCard = !!card;

  useEffect(() => {
    let active = true;
    isPlatformPaySupported()
      .then((supported) => {
        if (active) setApplePaySupported(supported);
      })
      .catch(() => {
        if (active) setApplePaySupported(false);
      });
    return () => {
      active = false;
    };
  }, [isPlatformPaySupported]);

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

  async function finishPlanChange(subscriptionId: string, paymentMethodId?: string) {
    if (paymentMethodId) {
      const { error: cardErr } = await saveCard(paymentMethodId);
      if (cardErr) console.warn('saveCard after plan change failed:', cardErr.message);
    }
    setPaidSubscriptionId(subscriptionId);
    const rank: Record<string, number> = { Free: 0, Plus: 1, Pro: 2, Max: 3 };
    const { error: cancelError } = await cancelStripeSubscriptions({
      exceptSubscriptionId: subscriptionId,
      atPeriodEnd: (rank[plan] ?? 0) < (rank[previousPlan.current] ?? 0),
    });
    if (cancelError) {
      setError('Your new plan was paid, but the previous subscription still needs updating. Tap Confirm to retry without another payment.');
      setSaving(false);
      return;
    }
    await supabase.auth.updateUser({ data: { plan, plan_billing: billing, plan_cancels_at: null } });
    setSaving(false);
    router.replace('/(app)/account');
  }

  async function handleConfirm() {
    setError('');
    if (!plan) {
      setError('No plan selected. Go back and choose a plan.');
      return;
    }
    setSaving(true);

    if (paidSubscriptionId) {
      await finishPlanChange(paidSubscriptionId);
      return;
    }

    // Schedule actual Stripe cancellation; retain paid access through period end.
    if (!isPaid) {
      const { data, error: cancelError } = await cancelStripeSubscriptions({ atPeriodEnd: true });
      if (cancelError) { setError(cancelError.message); setSaving(false); return; }
      const periodEnd = data?.periodEnd;
      await supabase.auth.updateUser({ data: periodEnd
        ? { plan_cancels_at: new Date(periodEnd * 1000).toISOString() }
        : { plan: 'Free', plan_billing: billing, plan_cancels_at: null } });
      setSaving(false);
      router.replace('/(app)/account');
      return;
    }

    // With no card on file we must collect one via the CardForm first.
    if (!hasCard && !cardComplete) {
      setError('Please enter your full card details.');
      setSaving(false);
      return;
    }

    // The mobile request always confirms on-device, including saved cards.
    const { data: sub, error: subErr } = await createSubscription({ plan, billing });
    if (subErr || !sub?.subscriptionId || !sub.clientSecret) {
      setError(subErr?.message ?? 'Could not start your subscription.');
      setSaving(false);
      return;
    }

    if (sub.clientSecret) {
      // 2a. Confirm the card payment on-device (new card, or SCA required).
      const { paymentIntent, error: payErr } = await confirmPayment(sub.clientSecret,
        hasCard && card?.paymentMethodId
          ? { paymentMethodType: 'Card', paymentMethodData: { paymentMethodId: card.paymentMethodId } }
          : { paymentMethodType: 'Card' },
      );
      if (payErr || paymentIntent?.status !== 'Succeeded') {
        setError(payErr?.message ?? 'Payment could not be completed.');
        setSaving(false);
        return;
      }
      // Set the just-used card as the customer's default (best-effort).
      await finishPlanChange(sub.subscriptionId, paymentIntent?.paymentMethod?.id);
      return;
    }
  }

  async function handleApplePay() {
    setError('');
    if (paidSubscriptionId) { setSaving(true); await finishPlanChange(paidSubscriptionId); return; }
    if (!plan || !isPaid) {
      setError('No paid plan selected. Go back and choose a plan.');
      return;
    }
    setSaving(true);

    const { data: sub, error: subErr } = await createSubscription({ plan, billing });
    if (subErr || !sub?.subscriptionId || !sub.clientSecret) {
      setError(subErr?.message ?? 'Could not start your subscription.');
      setSaving(false);
      return;
    }

    const amount = monthlyDisplay(plan as PlanName, billing).toFixed(2);
    const { paymentIntent, error: payErr } = await confirmPlatformPayPayment(
      sub.clientSecret,
      {
        applePay: {
          merchantCountryCode: 'US',
          currencyCode: 'USD',
          cartItems: [
            {
              label: `FetchIt ${plan}`,
              amount,
              paymentType: PlatformPay.PaymentType.Immediate,
            },
          ],
        },
      },
    );
    if (payErr || paymentIntent?.status !== 'Succeeded') {
      setError(payErr?.message ?? 'Payment could not be completed.');
      setSaving(false);
      return;
    }

    await finishPlanChange(sub.subscriptionId, paymentIntent?.paymentMethod?.id);
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
          {applePaySupported ? (
            <>
              <Text style={styles.label}>Pay with Apple Pay</Text>
              <PlatformPayButton
                type={PlatformPay.ButtonType.Pay}
                appearance={PlatformPay.ButtonStyle.White}
                borderRadius={Radius.pill}
                onPress={handleApplePay}
                disabled={saving}
                style={styles.applePayButton}
              />
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or enter card details</Text>
                <View style={styles.dividerLine} />
              </View>
            </>
          ) : null}
          <Text style={styles.label}>Card details</Text>
          <CardForm
            placeholders={{ number: '4242 4242 4242 4242' }}
            onFormComplete={(d) => setCardComplete(d.complete)}
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
  applePayButton: { width: '100%', height: 50, marginVertical: Spacing.xs },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginVertical: Spacing.xs,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { color: Colors.textFaint, fontSize: FontSize.xs },
  cardField: { width: '100%', height: 200, marginVertical: Spacing.xs },
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
