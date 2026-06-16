// Auth context + helpers — the mobile counterpart of the web app's
// AuthContext.js + the auth slice of utils.js.
//
// `AuthProvider` resolves the cached session once (getSession reads it from
// SecureStore), keeps it in sync via onAuthStateChange, and drives Supabase's
// token auto-refresh off React Native's AppState (refresh only while the app is
// foregrounded — the documented RN pattern). `useAuth()` exposes
// `{ session, loading }`; consumers must wait for `loading === false` before
// treating "no session" as logged-out.
import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/lib/supabase';
import type { Billing, PlanName } from '@/lib/stripe';

type AuthValue = { session: Session | null; loading: boolean };

const AuthContext = createContext<AuthValue>({ session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // Restore the cached session, then do a one-time background refresh so the
    // freshest server-side user_metadata (plan/billing/family) is pulled even
    // if it changed while the app was closed. Fails open — a transient error
    // never drops a valid cached session.
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
      if (data.session) supabase.auth.refreshSession().catch(() => {});
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (mounted) setSession(next);
    });

    // Supabase recommends gating autoRefreshToken on AppState in RN so it only
    // runs in the foreground (and resumes — with an immediate refresh — on
    // return). The client is created with autoRefreshToken:true, but we still
    // stop/start it explicitly to avoid background timers.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    supabase.auth.startAutoRefresh();

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      appStateSub.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, []);

  const value = useMemo(() => ({ session, loading }), [session, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}

// --- Thin async wrappers over Supabase auth (mirror utils.js) --------------

export async function signUp(email: string, password: string) {
  // Email verification is ON for this project, so no session is returned until
  // the user confirms. We pass no emailRedirectTo here; deep-link confirmation
  // is wired separately if/when needed.
  return supabase.auth.signUp({ email, password });
}

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

// --- Plan helpers (mirror utils.js getPlan/getName) ------------------------

type Metadata = {
  plan?: PlanName;
  plan_billing?: Billing;
  plan_cancels_at?: string | null;
  first_name?: string;
  last_name?: string;
};

function meta(session: Session | null): Metadata {
  return (session?.user?.user_metadata ?? {}) as Metadata;
}

/** Effective plan — returns Free once a scheduled cancellation has passed. */
export function getPlan(session: Session | null): PlanName {
  const m = meta(session);
  const plan = m.plan ?? 'Free';
  if (m.plan_cancels_at && Date.now() >= Date.parse(m.plan_cancels_at)) {
    return 'Free';
  }
  return plan;
}

export function getPlanBilling(session: Session | null): Billing {
  return meta(session).plan_billing ?? 'monthly';
}

export function getName(session: Session | null): {
  firstName: string;
  lastName: string;
} {
  const m = meta(session);
  return { firstName: m.first_name ?? '', lastName: m.last_name ?? '' };
}

/** "Hi, First 👋" greeting source — first name, else the email local part. */
export function greetingName(session: Session | null): string {
  const { firstName } = getName(session);
  if (firstName) return firstName;
  const email = session?.user?.email ?? '';
  return email ? email.split('@')[0] : 'there';
}
