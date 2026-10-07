// Scheduled Zinc wallet check (pg_cron → pg_net every 15 minutes; see
// supabase/cron/zinc-balance-monitor.sql). ALERT ONLY — Zinc has no top-up
// API, so this never moves money.
//
// Each run: GET https://api.zinc.com/wallet/me (free, read-only), log one row
// to balance_topup_events, and email ZINC_ALERT_EMAIL via Resend when
// spendable_balance is under the threshold or the balance can't be read.
// While the balance stays low, alerts repeat at most every
// ZINC_ALERT_REPEAT_HOURS; a recovery (an OK check after the last alert)
// re-arms an immediate alert on the next drop.
//
// Auth: no JWT (cron has no user). The caller must send x-monitor-secret
// matching the BALANCE_MONITOR_SECRET edge secret.
//
// Secrets: BALANCE_MONITOR_SECRET (≥32 chars), ZINC_API_KEY (existing),
// RESEND_API_KEY (existing, same as auth-gateway), ZINC_ALERT_EMAIL.
// Optional: ZINC_ALERT_THRESHOLD_CENTS (default 1000 = $10),
// ZINC_ALERT_REPEAT_HOURS (default 6), BALANCE_ALERT_FROM.
import { createClient } from 'npm:@supabase/supabase-js@2';

const ZINC_WALLET_URL = 'https://api.zinc.com/wallet/me';
const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'FetchIt Alerts <onboarding@resend.dev>';
const DEFAULT_THRESHOLD_CENTS = 1000;
const DEFAULT_REPEAT_HOURS = 6;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function envInt(name: string, fallback: number, max: number): number {
  const parsed = Number(Deno.env.get(name)?.trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : fallback;
}

function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

const usd = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

type WalletRead =
  | { ok: true; balanceCents: number; spendableCents: number }
  | { ok: false; error: string };

async function readZincWallet(apiKey: string): Promise<WalletRead> {
  let response: Response;
  try {
    response = await fetch(ZINC_WALLET_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, error: 'network_or_timeout' };
  }
  if (!response.ok) return { ok: false, error: `http_${response.status}` };
  try {
    const body = await response.json() as { balance?: unknown; spendable_balance?: unknown };
    if (!Number.isSafeInteger(body.balance) || !Number.isSafeInteger(body.spendable_balance)) {
      return { ok: false, error: 'malformed_response' };
    }
    return { ok: true, balanceCents: body.balance as number, spendableCents: body.spendable_balance as number };
  } catch {
    return { ok: false, error: 'malformed_response' };
  }
}

async function sendAlert(to: string, subject: string, html: string): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY')?.trim();
  if (!apiKey) throw new Error('resend_not_configured');
  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: Deno.env.get('BALANCE_ALERT_FROM')?.trim() || DEFAULT_FROM, to, subject, html }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`resend_http_${res.status}`);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const expected = Deno.env.get('BALANCE_MONITOR_SECRET')?.trim() ?? '';
  if (expected.length < 32) return json({ error: 'monitor_not_configured' }, 503);
  if (!secretMatches(req.headers.get('x-monitor-secret'), expected)) return json({ error: 'unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!url || !serviceKey) return json({ error: 'monitor_not_configured' }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const thresholdCents = envInt('ZINC_ALERT_THRESHOLD_CENTS', DEFAULT_THRESHOLD_CENTS, 100_000_000);
  const repeatHours = envInt('ZINC_ALERT_REPEAT_HOURS', DEFAULT_REPEAT_HOURS, 24 * 30);
  const apiKey = Deno.env.get('ZINC_API_KEY')?.trim() ?? '';
  // A zn_test_ key reads the sandbox wallet, not the live one — recorded so a
  // misconfigured key is visible in the log and the alert.
  const keyMode = apiKey.startsWith('zn_live_') ? 'live' : apiKey.startsWith('zn_test_') ? 'test' : null;
  const wallet: WalletRead = apiKey ? await readZincWallet(apiKey) : { ok: false, error: 'zinc_not_configured' };
  const belowThreshold = wallet.ok ? wallet.spendableCents < thresholdCents : null;
  const alertReason = !wallet.ok ? 'read_failed' : belowThreshold ? 'low_balance' : null;

  let alertSent = false;
  let alertError: string | null = null;
  if (alertReason) {
    let due = true;
    try {
      const { data: last, error } = await admin.from('balance_topup_events').select('checked_at')
        .eq('provider', 'zinc').eq('alert_sent', true)
        .order('checked_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (last) {
        const { data: recovered, error: recoveredError } = await admin.from('balance_topup_events').select('id')
          .eq('provider', 'zinc').eq('below_threshold', false).gt('checked_at', last.checked_at).limit(1);
        if (recoveredError) throw recoveredError;
        due = (recovered?.length ?? 0) > 0 ||
          Date.now() - Date.parse(last.checked_at) >= repeatHours * 3_600_000;
      }
    } catch {
      due = true; // if history can't be read, err toward alerting
    }

    const to = Deno.env.get('ZINC_ALERT_EMAIL')?.trim();
    if (due && !to) {
      alertError = 'recipient_not_configured';
    } else if (due && to) {
      const when = new Date().toUTCString();
      const mode = keyMode === 'test' ? ' (TEST key — sandbox wallet, not live)' : '';
      const subject = wallet.ok
        ? `FetchIt: Zinc wallet low — ${usd(wallet.spendableCents)} spendable`
        : 'FetchIt: Zinc wallet balance check failed';
      const html = wallet.ok
        ? `<p>The Zinc wallet's spendable balance is <b>${usd(wallet.spendableCents)}</b>` +
          ` (ledger ${usd(wallet.balanceCents)}), below the ${usd(thresholdCents)} alert threshold${mode}.</p>` +
          '<p>Product search fails closed and checkout needs spendable funds, so add funds from the ' +
          '<b>Wallet</b> button in the Zinc dashboard. Zinc has no top-up API, so this cannot be done automatically.</p>' +
          `<p>Checked ${when}. Repeats every ${repeatHours}h while the balance stays low.</p>`
        : `<p>The scheduled Zinc wallet check could not read the balance (<code>${wallet.error}</code>)${mode}.</p>` +
          `<p>Check ZINC_API_KEY and Zinc's status. Checked ${when}.</p>`;
      try {
        await sendAlert(to, subject, html);
        alertSent = true;
      } catch (error) {
        alertError = error instanceof Error ? error.message.slice(0, 200) : 'send_failed';
      }
    }
  }

  const row = {
    provider: 'zinc',
    key_mode: keyMode,
    balance_cents: wallet.ok ? wallet.balanceCents : null,
    spendable_cents: wallet.ok ? wallet.spendableCents : null,
    threshold_cents: thresholdCents,
    below_threshold: belowThreshold,
    read_error: wallet.ok ? null : wallet.error,
    alert_sent: alertSent,
    alert_reason: alertSent || alertError ? alertReason : null,
    alert_error: alertError,
  };
  const { error: insertError } = await admin.from('balance_topup_events').insert(row);
  if (insertError) {
    console.error('zinc-balance-monitor: could not log check');
    return json({ error: 'log_failed', alertSent }, 500);
  }
  return json({ ok: true, ...row });
});
