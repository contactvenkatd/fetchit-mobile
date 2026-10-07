import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export interface ZincOpsStatus {
  lastCheckedAt: string | null;
  monitorStale: boolean;
  keyMode: 'live' | 'test' | null;
  balanceCents: number | null;
  spendableCents: number | null;
  thresholdCents: number | null;
  belowThreshold: boolean | null;
  readError: string | null;
  lastAlertAt: string | null;
  lastAlertReason: 'low_balance' | 'read_failed' | null;
  daysSinceLastAlert: number | null;
  alertsLast30Days: number;
  checksLast24Hours: number;
  lowChecksLast24Hours: number;
}

/**
 * Admins are flagged in app_metadata, which only the server can write. The
 * ops-status endpoint enforces the same flag; this only decides whether to ask.
 */
export function isOpsAdmin(session: Session | null): boolean {
  return session?.user?.app_metadata?.fetchit_admin === true;
}

/** Zinc wallet status from the balance monitor's log (admins only). */
export async function fetchOpsStatus(): Promise<ZincOpsStatus> {
  const { data, error } = await supabase.functions.invoke('ops-status', { method: 'GET' });
  if (error) throw error;
  const zinc = (data as { zinc?: ZincOpsStatus } | null)?.zinc;
  if (!zinc || typeof zinc.monitorStale !== 'boolean' || typeof zinc.alertsLast30Days !== 'number') {
    throw new Error('Edge Function returned a malformed operations status.');
  }
  return zinc;
}
