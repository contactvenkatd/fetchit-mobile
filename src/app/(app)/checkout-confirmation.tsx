import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { getProfile, type Profile } from '@/lib/api';
import {
  placeOrder,
  PlaceOrderError,
  type PlacedOrder,
} from '@/services/orderService';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

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
  }>();

  const productUrl = param(params.productUrl);
  const title = param(params.title);
  const image = param(params.image) || null;
  const retailer = param(params.retailer);
  const unitPriceCents = Number(param(params.priceCents));
  const quantity = Math.max(1, Number(param(params.quantity)) || 1);
  const totalCents = unitPriceCents * quantity;
  const validProduct =
    productUrl.startsWith('https://') &&
    title.length > 0 &&
    retailer.length > 0 &&
    Number.isInteger(unitPriceCents) &&
    unitPriceCents > 0 &&
    Number.isInteger(quantity) &&
    quantity <= 100;

  const idempotencyKey = useRef(Crypto.randomUUID()).current;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [placedOrder, setPlacedOrder] = useState<PlacedOrder | null>(null);
  const [warning, setWarning] = useState('');

  useEffect(() => {
    let active = true;
    getProfile().then((value) => {
      if (!active) return;
      setProfile(value);
      setLoadingProfile(false);
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

  async function confirmPurchase() {
    if (!validProduct || !hasAddress || !hasCard || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const result = await placeOrder({
        productUrl,
        quantity,
        displayedPriceCents: totalCents,
        productName: title,
        productImage: image,
        retailer,
        idempotencyKey,
      });
      setPlacedOrder(result.order);
      setWarning(result.warning ?? '');
    } catch (orderError) {
      setError(
        orderError instanceof PlaceOrderError
          ? orderError.userMessage
          : "We couldn't place your order. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
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
          <Text style={styles.total}>${(placedOrder.totalCents / 100).toFixed(2)}</Text>
          {warning ? <Text style={styles.warning}>{warning}</Text> : null}
          <Button label="View order history" onPress={() => router.replace('/(app)/order-history')} />
          <Button label="Back to shopping" variant="secondary" onPress={() => router.replace('/(app)/chat')} />
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
            <Text style={styles.price}>${(totalCents / 100).toFixed(2)}</Text>
            {quantity > 1 ? (
              <Text style={styles.quantity}>
                {quantity} × ${(unitPriceCents / 100).toFixed(2)}
              </Text>
            ) : null}
          </View>
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
          <Text style={styles.error}>This product does not have valid checkout details.</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          <Button
            label="Confirm & Buy"
            onPress={confirmPurchase}
            loading={submitting}
            disabled={!validProduct || !hasAddress || !hasCard}
          />
          <Button label="Cancel" variant="ghost" disabled={submitting} onPress={() => router.back()} />
        </View>
        <Text style={styles.disclaimer}>
          Your card may be authorized for exactly ${(totalCents / 100).toFixed(2)}. The order will not proceed if the retailer price exceeds this amount.
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
