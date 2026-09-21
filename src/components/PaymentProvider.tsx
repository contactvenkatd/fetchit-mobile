import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { ensureStripeReady } from '@/lib/payment-runtime';

export function PaymentProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    ensureStripeReady().then(() => { if (active) setReady(true); })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  if (!ready) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
    {error ? <Text>{error}</Text> : <ActivityIndicator />}
  </View>;
  return children;
}
