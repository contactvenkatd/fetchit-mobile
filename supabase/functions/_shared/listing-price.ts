// Price evidence is minted only from the provider response, never client input.
// Existing service-role secret signs it; no new credentials are introduced.
export interface AmazonEvidence {
  asin: string; sellerId: string; sellerName: string; condition: 'New';
  variants: { label: string; value: string }[];
  minimumQuantity?: number;
}
interface ListingPrice { url: string; unitPriceCents: number; currency: 'USD'; expiresAt: number; amazon?: AmazonEvidence }
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), v => v.toString(16).padStart(2, '0')).join('');
async function signingKey(secret: string) {
  if (!secret) throw new Error('listing_price_unavailable');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signListingPrice(url: string, unitPriceCents: number, currency: string | null, secret: string, now = Date.now(), amazon?: AmazonEvidence): Promise<string | null> {
  if (currency !== 'USD' || !Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0) return null;
  const payload: ListingPrice = { url, unitPriceCents, currency, expiresAt: now + 30 * 60 * 1000, ...(amazon ? { amazon } : {}) };
  const signature = hex(await crypto.subtle.sign('HMAC', await signingKey(secret), new TextEncoder().encode(JSON.stringify(payload))));
  return JSON.stringify({ payload, signature });
}
export async function verifyListingPrice(proof: unknown, url: string, secret: string, now = Date.now()): Promise<ListingPrice | null> {
  try {
    if (typeof proof !== 'string' || proof.length > 6000) return null;
    const { payload, signature } = JSON.parse(proof);
    if (!payload || payload.url !== url || payload.currency !== 'USD' ||
        !Number.isSafeInteger(payload.unitPriceCents) || payload.unitPriceCents <= 0 ||
        !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= now ||
        typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return null;
    if (payload.amazon && (payload.url !== `https://www.amazon.com/dp/${payload.amazon.asin}` ||
        !/^[A-Z0-9]{10}$/.test(payload.amazon.asin) || payload.amazon.condition !== 'New' ||
        typeof payload.amazon.sellerId !== 'string' || !payload.amazon.sellerId ||
        typeof payload.amazon.sellerName !== 'string' || !Array.isArray(payload.amazon.variants) ||
        (payload.amazon.minimumQuantity !== undefined && (!Number.isInteger(payload.amazon.minimumQuantity) || payload.amazon.minimumQuantity < 1 || payload.amazon.minimumQuantity > 100)) ||
        payload.amazon.variants.length > 2 || payload.amazon.variants.some((v: { label?: unknown; value?: unknown }) =>
          !['Size', 'Color'].includes(String(v.label)) || typeof v.value !== 'string' || !v.value))) return null;
    const bytes = Uint8Array.from(signature.match(/../g), (v: string) => parseInt(v, 16));
    return await crypto.subtle.verify('HMAC', await signingKey(secret), bytes, new TextEncoder().encode(JSON.stringify(payload))) ? payload : null;
  } catch { return null; }
}
