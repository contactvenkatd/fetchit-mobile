export function reviewCheckoutPrice(unitCents: number, quantity: number, currency: string | null) {
  const valid = Number.isSafeInteger(unitCents) && unitCents > 0 &&
    Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 100 &&
    Number.isSafeInteger(unitCents * quantity);
  return {
    itemSubtotalCents: valid ? unitCents * quantity : null,
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    shippingCents: null, taxCents: null, zincFeeCents: currency === 'USD' ? 100 : null, paymentFeeCents: null,
    fetchitMarginCents: null,
    estimatedTotalCents: null,
    canSubmit: false,
  };
}

export function formatKnownPrice(cents: number | null, currency: string | null) {
  if (cents === null) return 'Unavailable';
  if (!currency) return `${cents} minor units · currency unconfirmed`;
  // Only USD's minor-unit scale is verified for the intended checkout test.
  if (currency !== 'USD') return `${cents} minor units · ${currency}`;
  return `USD ${formatUsdCents(cents)}`;
}


export function parseRetailerBudget(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function hasApprovedEstimate(
  quote: { id: string; mode: string; knownCostsCents: number; retailerBudgetCents: number; currency: string; expiresAt: number } | null,
  approvedId: string | null,
  now = Date.now(),
): boolean {
  return Boolean(quote && quote.id === approvedId && quote.currency === 'USD' &&
    quote.mode === 'estimate' && Number.isSafeInteger(quote.knownCostsCents) && quote.knownCostsCents > 0 &&
    Number.isSafeInteger(quote.retailerBudgetCents) && quote.retailerBudgetCents > 0 && now < quote.expiresAt);
}

export function formatUsdCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) return 'Unavailable';
  const amount = BigInt(cents);
  return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
}

export function estimateApprovalText(knownCostsCents: number): string {
  return `Estimated total: USD ${formatUsdCents(knownCostsCents)} + shipping, taxes, and processing fees (amounts unknown).`;
}
