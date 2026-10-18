// WEB-ONLY stand-in for expo-secure-store, swapped in by metro.config.js when
// bundling for web. The package's web build has no storage implementation, so
// the Supabase session adapter crashes the web dev server on startup. iOS and
// Android never resolve this file — they keep the encrypted Keychain/KeyStore.
//
// Web is a dev convenience only: values go to localStorage (not encrypted),
// or to memory during static rendering in Node where there is no window.
const memory = new Map<string, string>();
const storage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
};

export async function getItemAsync(key: string): Promise<string | null> {
  const store = storage();
  return store ? store.getItem(key) : memory.get(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  const store = storage();
  if (store) store.setItem(key, value);
  else memory.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  const store = storage();
  if (store) store.removeItem(key);
  else memory.delete(key);
}

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}
