import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { getProfile, type Profile } from '@/lib/api';
import {
  placeOrder,
  getCheckoutQuote,
  getCheckoutOrderStatus,
  getSavedSubmission,
  startNewPurchase,
  type CheckoutOrderStatus,
  type CheckoutQuote,
  PlaceOrderError,
  type PlacedOrder,
} from '@/services/orderService';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';
import { reviewCheckoutPrice, formatKnownPrice, hasApprovedEstimate, estimateApprovalText, parseRetailerBudget, formatUsdCents } from '@/services/checkoutPricing';

const param = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const cardBrand = (brand: string | null) =>
  brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'Card';

export default function CheckoutConfirmationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    productUrl?: string;
    title?: string;
    image?: string;
    retailer?: string;
    priceCents?: string;
    quantity?: string;
    currency?: string;
    listingProof?: string;
    size?: string;
    color?: string;
  }>();

  const listingProof = param(params.listingProof);
  const productUrl = param(params.productUrl);
  const title = param(params.title);
  const image = param(params.image) || null;
  const retailer = param(params.retailer);
  const variants = [
    ...(param(params.size) ? [{ label: 'Size', value: param(params.size) }] : []),
    ...(param(params.color) ? [{ label: 'Color', value: param(params.color) }] : []),
  ];
  const unitPriceCents = Number(param(params.priceCents));
  const quantity = param(params.quantity) === '' ? 1 : Number(param(params.quantity));
  const pricing = reviewCheckoutPrice(unitPriceCents, quantity, param(params.currency) || null);
  const totalCents = pricing.itemSubtotalCents ?? 0;
  const validProduct =
    productUrl.startsWith('https://') &&
    title.length > 0 &&
    retailer.length > 0 &&
    Number.isSafeInteger(unitPriceCents) &&
    unitPriceCents > 0 &&
    Number.isSafeInteger(quantity) && quantity >= 1 &&
    quantity <= 100 && pricing.itemSubtotalCents !== null && pricing.currency === 'USD';

  const idempotencyKey = useRef(Crypto.randomUUID()).current;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // React state does not update synchronously between two taps. Keep the lock
  // after acceptance or an unknown outcome, including a lost confirmation.
  const submissionLocked = useRef(false);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const [error, setError] = useState('');
  const [placedOrder, setPlacedOrder] = useState<PlacedOrder | null>(null);
  const [warning, setWarning] = useState('');
  const [latestStatus, setLatestStatus] = useState<CheckoutOrderStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [budgetInput, setBudgetInput] = useState('');
  const retailerBudgetCents = budgetInput ? parseRetailerBudget(budgetInput) : totalCents;
  const [quoteResult, setQuoteResult] = useState<{ quote: CheckoutQuote; context: string } | null>(null);
  const [approvedQuoteId, setApprovedQuoteId] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const quoteContext = JSON.stringify([productUrl, quantity, variants, listingProof, totalCents, pricing.currency, retailerBudgetCents, profile]);
  const quote = quoteResult?.context === quoteContext ? quoteResult.quote : null;
  const canSubmit = hasApprovedEstimate(quote, approvedQuoteId);


  useEffect(() => {
    let active = true;
    Promise.all([getProfile(), getSavedSubmission()]).then(([value, saved]) => {
      if (!active) return;
      setProfile(value);
      if (saved) {
        submissionLocked.current = true;
        if (saved.state === 'accepted') setPlacedOrder(saved.order);
        else {
          setOutcomeUnknown(true);
          setError('A previous checkout is unresolved. Check order history and contact support before submitting another purchase.');
        }
      }
      setLoadingProfile(false);
    }).catch(() => {
      if (!active) return;
      submissionLocked.current = true;
      setOutcomeUnknown(true);
      setLoadingProfile(false);
      setError('Checkout recovery is unavailable. Check order history before submitting another purchase.');
    });
    return () => {
      active = false;
    };
  }, []);

  const hasAddress = Boolean(
    profile?.fullName &&
      profile.addressLine1 &&
      profile.city &&
      profile.state &&
      profile.zip &&
      profile.country,
  );
  const hasCard = Boolean(
    profile?.stripeCustomerId && profile.stripePaymentMethodId && profile.cardLast4,
  );

  useEffect(() => {
    let active = true;
    setQuoteResult(null);
    setApprovedQuoteId(null);
    setQuoteError('');
    if (validProduct && hasAddress && hasCard && retailerBudgetCents && !outcomeUnknown && !submissionLocked.current) {
      getCheckoutQuote({ productUrl, quantity, variants, itemSubtotalCents: totalCents, unitPriceCents, listingProof, currency: 'USD', displayedPriceCents: retailerBudgetCents,
        productName: title, productImage: image, retailer, idempotencyKey }).then(value => {
        if (active) setQuoteResult({ quote: value, context: quoteContext });
      }).catch(() => {
        if (active) setQuoteError('The checkout estimate is unavailable. Refresh it before approving your purchase. No order was submitted.');
      });
    }
    return () => { active = false; };
  }, [quoteContext, validProduct, hasAddress, hasCard, quoteRefresh, outcomeUnknown]);

  useEffect(() => {
    if (!quote) return;
    const timer = setTimeout(() => {
      setQuoteResult(null);
      setApprovedQuoteId(null);
      setQuoteError('This estimate expired. Refresh it and approve again before placing your order.');
    }, Math.max(0, quote.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [quote]);

  useEffect(() => {
    if (!placedOrder?.id) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const status = await getCheckoutOrderStatus(placedOrder.id!);
        if (!active) return;
        setLatestStatus(status);
        setStatusError('');
      } catch {
        if (active) setStatusError('Latest order and payment status are unconfirmed. Do not submit another purchase.');
      }
      if (active) timer = setTimeout(refresh, 5000);
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [placedOrder?.id]);

  async function confirmPurchase() {
    if (!validProduct || !hasAddress || !hasCard || !hasApprovedEstimate(quote, approvedQuoteId) || !retailerBudgetCents || submissionLocked.current) return;
    submissionLocked.current = true;
    setError('');
    setSubmitting(true);
    try {
      const result = await placeOrder({
        productUrl,
        quantity, variants,
        displayedPriceCents: retailerBudgetCents,
        itemSubtotalCents: totalCents, unitPriceCents, listingProof, currency: 'USD',
        approval: { quoteId: quote!.id, mode: 'estimate', acceptsVariableFees: true, retailerBudgetCents: quote!.retailerBudgetCents, currency: quote!.currency },
        productName: title,
        productImage: image,
        retailer,
        idempotencyKey,
      });
      setPlacedOrder(result.order);
      setWarning(result.warning ?? '');
    } catch (orderError) {
      const unknown = !(orderError instanceof PlaceOrderError) || orderError.outcomeUnknown;
      setOutcomeUnknown(unknown);
      if (!unknown) submissionLocked.current = false;
      if (!unknown && orderError instanceof PlaceOrderError &&
          ['checkout_approval_required', 'max_price_exceeded'].includes(orderError.code)) {
        setApprovedQuoteId(null);
        setQuoteResult(null);
        setQuoteRefresh(value => value + 1);
      }
      setError(
        orderError instanceof PlaceOrderError && !unknown
          ? orderError.userMessage
          : 'We could not confirm the order outcome. Check order history and contact support before submitting another purchase.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function backToShopping() {
    try { await startNewPurchase(); router.replace('/(app)/chat'); }
    catch { setStatusError('The prior checkout is unresolved. Contact support before making another purchase.'); }
  }

  if (loadingProfile) {
    return (
      <Screen center edges={['bottom']}>
        <ActivityIndicator color={Colors.yellow} />
      </Screen>
    );
  }

  if (placedOrder) {
    return (
      <Screen edges={['bottom']}>
        <View style={styles.successWrap}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.heading}>Order submitted</Text>
          <Text style={styles.successText}>
            Zinc order {placedOrder.zincOrderId} is {placedOrder.status.replaceAll('_', ' ')}.
          </Text>
          <Text style={styles.detailText}>Submission accepted; retailer and payment outcomes are separate.</Text>
          {latestStatus ? (
            <>
              <Text style={styles.detailText}>Zinc status: {latestStatus.zincStatus}</Text>
              <Text style={styles.detailText}>Retailer status: {latestStatus.retailerStatus}</Text>
              {latestStatus.tracking?.map((shipment, index) => (
                <Text key={index} style={styles.detailText}>Tracking: {shipment.carrier ?? 'Carrier unconfirmed'} {shipment.trackingNumber ?? 'number pending'} · {shipment.status}{shipment.estimatedDeliveryDate ? ` · Estimated delivery ${shipment.estimatedDeliveryDate}` : ''}</Text>
              ))}
              <Text style={styles.detailText}>Payment status: {latestStatus.payment.status}</Text>
              {latestStatus.simulated ? <Text style={styles.warning}>Sandbox simulation. No real retailer purchase or card charge is confirmed.</Text> : null}
              {latestStatus.errorCode ? <Text style={styles.error}>Order error: {latestStatus.errorCode}. Review the failure before another purchase. A higher budget requires new approval.</Text> : null}
              {latestStatus.payment.actualChargeCents !== null ? (
                <Text style={styles.detailPrimary}>Actual captured amount: {formatKnownPrice(latestStatus.payment.actualChargeCents, latestStatus.payment.currency)}</Text>
              ) : <Text style={styles.detailText}>Captured amount: Unconfirmed</Text>}
            </>
          ) : <Text style={styles.detailText}>Actual payment amount must be confirmed in order status.</Text>}
          {statusError ? <Text style={styles.warning}>{statusError}</Text> : null}
          {warning ? <Text style={styles.warning}>{warning}</Text> : null}
          <Button label="View order history" onPress={() => router.replace('/(app)/order-history')} />
          <Button label="Back to shopping" variant="secondary" onPress={backToShopping} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.heading}>Confirm your order</Text>

        <View style={styles.productCard}>
          {image ? (
            <Image source={image} style={styles.productImage} contentFit="contain" />
          ) : (
            <View style={[styles.productImage, styles.imagePlaceholder]}>
              <Text style={styles.placeholderIcon}>🛍️</Text>
            </View>
          )}
          <View style={styles.productCopy}>
            <Text style={styles.productTitle}>{title || 'Unknown product'}</Text>
            <Text style={styles.retailer}>{retailer || 'Unknown retailer'}</Text>
            {variants.map(variant => <Text key={variant.label} style={styles.quantity}>{variant.label}: {variant.value}</Text>)}
            <Text style={styles.price}>Item subtotal: {formatKnownPrice(pricing.itemSubtotalCents, pricing.currency)}</Text>
            {quantity > 1 ? (
              <Text style={styles.quantity}>
                {quantity} × {formatKnownPrice(unitPriceCents, pricing.currency)}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.detailCard}>
          <Text style={styles.sectionTitle}>Estimated total</Text>
          <Text style={styles.detailText}>Estimated shipping: Unknown until retailer checkout</Text>
          <Text style={styles.detailText}>Estimated tax: Unknown until retailer checkout</Text>
          <Text style={styles.detailText}>Service fee: {quote ? formatKnownPrice(quote.serviceFeeCents, quote.currency) : 'pending verified estimate'}</Text>

          <Text style={styles.detailText}>Processing fees: Unknown; applicable rate not confirmed</Text>
          <Text style={styles.detailText}>Estimated total. Final shipping, taxes, and processing fees may vary.</Text>
          <Text style={styles.detailText}>Retailer spending limit in USD, including shipping and taxes:</Text>
          <TextInput accessibilityLabel="Retailer spending limit in USD" keyboardType="decimal-pad"
            value={budgetInput} placeholder={formatUsdCents(totalCents)}
            placeholderTextColor={Colors.textFaint} style={styles.budgetInput}
            editable={!submitting && !outcomeUnknown && !submissionLocked.current}
            onChangeText={value => { setApprovedQuoteId(null); setBudgetInput(value); }} />
          {quote ? (
            <>
              <Text style={styles.detailPrimary}>{estimateApprovalText(quote.knownCostsCents)}</Text>
              <Text style={styles.detailText}>Known costs include the item subtotal and Service fee. Unknown amounts are additional; this estimate is not an all-in limit.</Text>
              <Text style={styles.detailText}>Retailer budget: USD {formatUsdCents(quote.retailerBudgetCents)} for items, shipping, and taxes only. Service fee and processing fees are additional, so the card hold and final charge may exceed this budget.</Text>
              <Text style={styles.detailText}>By approving, you authorize Zinc to hold the retailer budget plus the Service fee and applicable processing fees, then charge the actual total after retailer placement. Unused authorization is released; your bank controls availability.</Text>
              <Button label={approvedQuoteId === quote.id ? 'Estimate approved' : 'Approve estimate'}
                variant="secondary" disabled={submitting || outcomeUnknown || approvedQuoteId === quote.id}
                onPress={() => { if (quote.expiresAt > Date.now()) setApprovedQuoteId(quote.id); }} />
            </>
          ) : <Text style={styles.detailPrimary}>{quoteError || 'Estimate unavailable.'}</Text>}
          {!quote && !submitting && !outcomeUnknown ? (
            <Button label="Refresh estimate" variant="secondary" onPress={() => setQuoteRefresh(value => value + 1)} />
          ) : null}
        </View>

        <View style={styles.detailCard}>
          <Text style={styles.sectionTitle}>Shipping to</Text>
          {hasAddress && profile ? (
            <>
              <Text style={styles.detailPrimary}>{profile.fullName}</Text>
              <Text style={styles.detailText}>{profile.addressLine1}</Text>
              {profile.addressLine2 ? <Text style={styles.detailText}>{profile.addressLine2}</Text> : null}
              <Text style={styles.detailText}>
                {profile.city}, {profile.state} {profile.zip}
              </Text>
              <Text style={styles.detailText}>{profile.country}</Text>
            </>
          ) : (
            <Text style={styles.missing}>Add a complete shipping address in Cards & Address.</Text>
          )}
        </View>

        <View style={styles.detailCard}>
          <Text style={styles.sectionTitle}>Payment method</Text>
          {hasCard && profile ? (
            <Text style={styles.detailPrimary}>
              {cardBrand(profile.cardBrand)} •••• {profile.cardLast4}
            </Text>
          ) : (
            <Text style={styles.missing}>Add a saved card in Cards & Address.</Text>
          )}
        </View>

        {!validProduct ? (
          <Text style={styles.error}>Checkout requires valid product details and confirmed USD pricing.</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          <Button
            label={quote ? 'Place Order' : 'Estimate unavailable'}
            onPress={confirmPurchase}
            loading={submitting}
            disabled={!validProduct || !hasAddress || !hasCard || !canSubmit || outcomeUnknown}
          />
          {outcomeUnknown ? (
            <Button label="View order history" variant="secondary" onPress={() => router.replace('/(app)/order-history')} />
          ) : null}
          <Button label="Cancel" variant="ghost" disabled={submitting} onPress={() => router.back()} />
        </View>
        <Text style={styles.disclaimer}>
          Approve the estimate and variable fees above before placing an order. If retailer costs exceed your spending limit, a higher limit requires new approval.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  heading: { color: Colors.text, fontSize: FontSize.xxl, fontWeight: '800', textAlign: 'center' },
  productCard: {
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  productImage: { width: 100, height: 100, flexShrink: 0, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderIcon: { fontSize: 36 },
  productCopy: { flex: 1, minWidth: 0 },
  productTitle: { color: Colors.text, fontSize: FontSize.md, fontWeight: '700', lineHeight: 22 },
  retailer: { color: Colors.textMuted, fontSize: FontSize.sm, marginTop: Spacing.xs, textTransform: 'capitalize' },
  price: { color: Colors.yellow, fontSize: FontSize.xl, fontWeight: '800', marginTop: Spacing.sm },
  quantity: { color: Colors.textFaint, fontSize: FontSize.xs, marginTop: 2 },
  budgetInput: { color: Colors.text, borderColor: Colors.border, borderWidth: 1, borderRadius: Radius.md, padding: Spacing.sm },
  detailCard: { padding: Spacing.md, gap: Spacing.xs, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border },
  sectionTitle: { color: Colors.textMuted, fontSize: FontSize.sm, fontWeight: '700', marginBottom: Spacing.xs },
  detailPrimary: { color: Colors.text, fontSize: FontSize.md, fontWeight: '700' },
  detailText: { color: Colors.textMuted, fontSize: FontSize.sm },
  missing: { color: Colors.error, fontSize: FontSize.sm },
  actions: { gap: Spacing.sm, marginTop: Spacing.sm },
  error: { color: Colors.error, fontSize: FontSize.sm, textAlign: 'center' },
  disclaimer: { color: Colors.textFaint, fontSize: FontSize.xs, lineHeight: 18, textAlign: 'center' },
  successWrap: { flex: 1, justifyContent: 'center', gap: Spacing.md },
  successIcon: { alignSelf: 'center', color: Colors.charcoal, backgroundColor: Colors.success, width: 64, height: 64, borderRadius: 32, textAlign: 'center', lineHeight: 64, fontSize: FontSize.xxl, fontWeight: '900', overflow: 'hidden' },
  successText: { color: Colors.textMuted, fontSize: FontSize.md, lineHeight: 23, textAlign: 'center' },
  total: { color: Colors.yellow, fontSize: FontSize.xxl, fontWeight: '800', textAlign: 'center' },
  warning: { color: Colors.orange, fontSize: FontSize.sm, lineHeight: 20, textAlign: 'center' },
});
