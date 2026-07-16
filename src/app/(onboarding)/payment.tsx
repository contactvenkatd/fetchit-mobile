import { CardField, useStripe } from '@stripe/stripe-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';
import { createSubscription, saveCard } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

// Onboarding card step — shown only for paid plans (the plans screen routes Free
// straight to chat and passes the chosen plan here). Subscribes the user via the
// real backend flow, mirroring the web app's CheckoutPage:
//   createSubscription({ plan, billing }) → confirmPayment(clientSecret) → save plan.
export default function PaymentScreen() {
  const router = useRouter();
  const { plan: planParam } = useLocalSearchParams<{ plan?: string }>();
  const plan = typeof planParam === 'string' ? planParam : '';
  const billing = 'monthly' as const; // plans screen offers monthly pricing
  const { confirmPayment } = useStripe();
  const [cardComplete, setCardComplete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleContinue() {
    setError('');
    if (!plan) {
      setError('No plan selected. Go back and choose a plan.');
      return;
    }
    if (!cardComplete) {
      setError('Please enter your full card details.');
      return;
    }
    setSaving(true);

    // 1. Server reuses/creates the customer + an incomplete subscription and
    //    hands back the first invoice's PaymentIntent client secret.
    const { data: sub, error: subErr } = await createSubscription({ plan, billing });
    if (subErr || !sub) {
      setError(subErr?.message ?? 'Could not start your subscription.');
      setSaving(false);
      return;
    }

    // 2. Confirm the card payment on-device — the CardField holds the entered
    //    details, so Stripe tokenizes them; raw card data never touches our state.
    const { paymentIntent, error: payErr } = await confirmPayment(sub.clientSecret, {
      paymentMethodType: 'Card',
    });
    if (payErr) {
      setError(payErr.message ?? 'Payment could not be completed.');
      setSaving(false);
      return;
    }

    // 3. Save the just-used card as the customer's DEFAULT payment method so
    //    FetchIt can charge it for future off-session checkouts. Best-effort: the
    //    subscription is already paid, so a save-card hiccup shouldn't strand the
    //    user — log it and continue.
    const paymentMethodId = paymentIntent?.paymentMethod?.id;
    if (paymentMethodId) {
      const { error: cardErr } = await saveCard(paymentMethodId);
      if (cardErr) console.warn('saveCard after subscription failed:', cardErr.message);
    }

    // 4. Record the new plan on the user (mirrors the web's finalizePlan).
    await supabase.auth.updateUser({ data: { plan, plan_billing: billing } });

    setSaving(false);
    router.replace('/(app)/chat');
  }

  return (
    <AuthLayout
      title="Add Payment Method"
      subtitle="You won't be charged until your trial ends"
      onBack={() =>
        router.canGoBack() ? router.back() : router.replace('/(onboarding)/plans')
      }>
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

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label="Continue"
        onPress={handleContinue}
        loading={saving}
        disabled={!cardComplete}
      />
      <Text style={styles.note}>🔒 Secured by Stripe · Cancel anytime</Text>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  label: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: '600' },
  cardField: { width: '100%', height: 50, marginVertical: Spacing.xs },
  error: { color: Colors.error, fontSize: FontSize.sm, textAlign: 'center' },
  note: { color: Colors.textFaint, fontSize: FontSize.xs, textAlign: 'center' },
});
