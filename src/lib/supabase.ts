// Supabase client — single shared instance for the whole mobile app.
//
// Differences from the web client (fetchit-app/src/supabaseClient.js):
//  - React Native has no `localStorage`, so we supply a custom `storage`
//    adapter backed by expo-secure-store (encrypted keychain / KeyStore).
//  - `detectSessionInUrl` is OFF — there's no browser URL to parse; deep-link
//    auth (OAuth/magic links) is handled explicitly via expo-linking instead.
//  - `react-native-url-polyfill/auto` is imported first so supabase-js's use of
//    the WHATWG `URL` works on Hermes.
//
// Credentials are the SAME Supabase project as the web app, so accounts, plans,
// chats, and orders are shared across web and mobile.
import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const SUPABASE_URL = 'https://fpphpncruohjlppqhfep.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_j_SnlL8-OiV_ha4pWL1lHw_AQCmalXg';

// ---------------------------------------------------------------------------
// SecureStore adapter (chunked).
//
// SecureStore values can be rejected by iOS when they exceed ~2KB, and a
// Supabase session blob (access + refresh token + user metadata) routinely
// exceeds that. So we transparently split large values into <=1.8KB chunks
// across `<key>.0`, `<key>.1`, … and store a small manifest at `<key>` holding
// the chunk count. Small values are stored inline with a count of 1.
//
// SecureStore keys must match /^[A-Za-z0-9._-]+$/; Supabase's keys (e.g.
// `sb-fpphpncruohjlppqhfep-auth-token`) already satisfy this.
// ---------------------------------------------------------------------------
const CHUNK_SIZE = 1800;

type Manifest = { chunks: number };

const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const head = await SecureStore.getItemAsync(key);
    if (head == null) return null;

    // Back-compat / small value: a plain (non-manifest) string is the value.
    let manifest: Manifest | null = null;
    try {
      const parsed = JSON.parse(head);
      if (parsed && typeof parsed.chunks === 'number') manifest = parsed;
    } catch {
      /* not a manifest — treat as a raw inline value */
    }
    if (!manifest) return head;

    const parts: string[] = [];
    for (let i = 0; i < manifest.chunks; i += 1) {
      const part = await SecureStore.getItemAsync(`${key}.${i}`);
      if (part == null) return null; // corrupt/partial — treat as missing
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    // Clear any prior chunks before rewriting so a shrink doesn't leave orphans.
    await secureStorage.removeItem(key, /* keepHead */ true);

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }

    const chunks = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < chunks; i += 1) {
      const slice = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      await SecureStore.setItemAsync(`${key}.${i}`, slice);
    }
    const manifest: Manifest = { chunks };
    await SecureStore.setItemAsync(key, JSON.stringify(manifest));
  },

  async removeItem(key: string, keepHead = false): Promise<void> {
    const head = await SecureStore.getItemAsync(key);
    if (head != null) {
      try {
        const parsed = JSON.parse(head) as Manifest;
        if (parsed && typeof parsed.chunks === 'number') {
          for (let i = 0; i < parsed.chunks; i += 1) {
            await SecureStore.deleteItemAsync(`${key}.${i}`);
          }
        }
      } catch {
        /* inline value — nothing extra to clean up */
      }
    }
    if (!keepHead) await SecureStore.deleteItemAsync(key);
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: secureStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // no browser URL in React Native
  },
});
