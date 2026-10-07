import { supabase } from '@/lib/supabase';

export type QuotaBucket = 'ai' | 'zinc';

/** Monthly dollar budget for one paid feature, in (possibly fractional) cents. */
export interface BucketUsage {
  usedCents: number;
  limitCents: number;
  remainingCents: number;
}

export interface UsageStatus {
  plan: string;
  periodKey: string;
  resetsAt: string;
  ai: BucketUsage;
  zinc: BucketUsage;
}

const BUCKET_NOUN: Record<QuotaBucket, string> = {
  ai: 'AI chat',
  zinc: 'product search',
};

/** Whole dollars and cents, rounded down so "left" never overstates a budget. */
export function formatUsd(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.max(0, Math.floor(cents)) : 0;
  return (safe / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** "November 1, 2026" — the reset instant is midnight UTC, so format in UTC. */
export function formatResetDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'the start of next month';
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The monthly dollar budget for a paid feature (AI chat or product search) is
 * spent. Distinct from a generic service failure so the UI can explain the
 * reset date and offer an upgrade. The two budgets are separate, so the
 * message names the one that ran out.
 */
export class QuotaExceededError extends Error {
  readonly bucket: QuotaBucket;
  readonly limitCents: number;
  readonly resetsAt: string;
  readonly userMessage: string;

  constructor(bucket: QuotaBucket, limitCents: number, resetsAt: string) {
    super(`${bucket} quota exceeded`);
    this.name = 'QuotaExceededError';
    this.bucket = bucket;
    this.limitCents = limitCents;
    this.resetsAt = resetsAt;
    this.userMessage =
      `You've used this month's ${formatUsd(limitCents)} ${BUCKET_NOUN[bucket]} budget. ` +
      `It resets on ${formatResetDate(resetsAt)}. Upgrade your plan for a bigger budget.`;
  }
}

/**
 * If an Edge Function error is a 429 `quota_exceeded`, return the typed error;
 * otherwise null. Supabase's FunctionsHttpError carries the Response on
 * `.context`.
 */
export async function readQuotaError(error: unknown): Promise<QuotaExceededError | null> {
  const context = (error as { context?: Response } | null)?.context;
  if (!context || typeof context.status !== 'number' || context.status !== 429) return null;
  try {
    const body = (await context.clone().json()) as {
      error?: { code?: unknown; bucket?: unknown; limitCents?: unknown; resetsAt?: unknown };
    };
    const details = body?.error;
    if (
      details?.code !== 'quota_exceeded' ||
      (details.bucket !== 'ai' && details.bucket !== 'zinc') ||
      typeof details.limitCents !== 'number' ||
      typeof details.resetsAt !== 'string'
    ) {
      return null;
    }
    return new QuotaExceededError(details.bucket, details.limitCents, details.resetsAt);
  } catch {
    return null;
  }
}

function isBucketUsage(value: unknown): value is BucketUsage {
  if (!value || typeof value !== 'object') return false;
  const usage = value as Record<string, unknown>;
  return (
    Number.isFinite(usage.usedCents) &&
    Number.isFinite(usage.limitCents) &&
    Number.isFinite(usage.remainingCents)
  );
}

/** Current-period usage for the signed-in user (read-only; spends nothing). */
export async function fetchUsageStatus(): Promise<UsageStatus> {
  const { data, error } = await supabase.functions.invoke('usage-status', { method: 'GET' });
  if (error) throw error;
  const status = data as Partial<UsageStatus> | null;
  if (
    !status ||
    typeof status.plan !== 'string' ||
    typeof status.periodKey !== 'string' ||
    typeof status.resetsAt !== 'string' ||
    !isBucketUsage(status.ai) ||
    !isBucketUsage(status.zinc)
  ) {
    throw new Error('Edge Function returned a malformed usage status.');
  }
  return status as UsageStatus;
}
