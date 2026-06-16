import { useRouter } from 'expo-router';
import { useState } from 'react';

import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { supabase } from '@/lib/supabase';

// Step 4 — display name (the web app's /onboarding). Saves first/last name to
// user_metadata, then lands on chat. "Skip for now" goes straight to chat.
export default function NameScreen() {
  const router = useRouter();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await supabase.auth.updateUser({
      data: { first_name: first.trim(), last_name: last.trim() },
    });
    setSaving(false);
    router.replace('/(app)/chat');
  }

  return (
    <AuthLayout title="One last thing! 🐕" subtitle="What should FetchIt call you?">
      <TextField label="First name" value={first} onChangeText={setFirst} placeholder="Jane" textContentType="givenName" />
      <TextField label="Last name" value={last} onChangeText={setLast} placeholder="Shopper" textContentType="familyName" />

      <Button label="Save" onPress={save} loading={saving} />
      <Button label="Skip for now" variant="ghost" onPress={() => router.replace('/(app)/chat')} />
    </AuthLayout>
  );
}
