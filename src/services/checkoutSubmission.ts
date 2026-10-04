import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import type { PlacedOrder } from '@/services/orderService';

export type SavedSubmission = { idempotencyKey: string; state: 'pending'; order?: never } |
  { idempotencyKey: string; state: 'accepted'; order: PlacedOrder };
let claiming = false;
const keyForUser = async () => {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('checkout_recovery_unavailable');
  return `fetchit.checkout.pending.${data.user.id}`;
};
const read = async (key: string): Promise<SavedSubmission | null> => {
  const raw = await SecureStore.getItemAsync(key);
  if (raw === null) return null;
  const value = JSON.parse(raw);
  if (!value || typeof value.idempotencyKey !== 'string' ||
      !['pending', 'accepted'].includes(value.state) ||
      (value.state === 'accepted' && (!value.order || typeof value.order.zincOrderId !== 'string'))) {
    throw new Error('checkout_recovery_unavailable');
  }
  return value;
};
export async function getSavedSubmission(): Promise<SavedSubmission | null> {
  return read(await keyForUser());
}
export async function beginSubmission(idempotencyKey: string) {
  if (claiming) throw new Error('checkout_submission_pending');
  claiming = true;
  try {
    const key = await keyForUser();
    if (await read(key)) throw new Error('checkout_submission_pending');
    // Persist BEFORE any financial request. A crash/timeout remains unresolved.
    await SecureStore.setItemAsync(key, JSON.stringify({ idempotencyKey, state: 'pending' }));
  } finally { claiming = false; }
}
export async function acceptSubmission(idempotencyKey: string, order: PlacedOrder) {
  const key = await keyForUser();
  const existing = await read(key);
  if (existing?.idempotencyKey !== idempotencyKey) throw new Error('checkout_recovery_unavailable');
  await SecureStore.setItemAsync(key, JSON.stringify({ idempotencyKey, state: 'accepted', order }));
}
export async function releaseRejectedSubmission(idempotencyKey: string) {
  const key = await keyForUser();
  if ((await read(key))?.idempotencyKey === idempotencyKey) await SecureStore.deleteItemAsync(key);
}
export async function startNewPurchase() {
  const key = await keyForUser();
  const existing = await read(key);
  // Only explicit customer action after an acknowledged acceptance may reset.
  // An uncertain submission needs reconciliation/support; never silently retry.
  if (existing?.state === 'pending') throw new Error('checkout_submission_pending');
  await SecureStore.deleteItemAsync(key);
}
