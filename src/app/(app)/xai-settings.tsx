import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { hasStoredGrokApiKey, setGrokApiKey } from '@/services/grokService';
import { Colors, FontSize, Radius, Spacing } from '@/theme/colors';

export default function XaiSettingsScreen() {
  const [apiKey, setApiKey] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;

    hasStoredGrokApiKey()
      .then((hasKey) => {
        if (active) setConfigured(hasKey);
      })
      .catch(() => {
        if (active) setConfigured(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleSave() {
    setError('');
    setSaved(false);
    setSaving(true);

    try {
      await setGrokApiKey(apiKey);
      setApiKey('');
      setConfigured(true);
      setSaved(true);
    } catch {
      setError(apiKey.trim() ? 'Unable to save the API key. Please try again.' : 'Enter an API key.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>Grok connection</Text>
          <Text style={styles.description}>
            Your xAI API key is encrypted in this device&apos;s secure storage and is used for
            shopping-intent requests.
          </Text>
          {configured === true ? (
            <Text style={styles.configured}>Key configured ✓</Text>
          ) : configured === false ? (
            <Text style={styles.notConfigured}>No key configured</Text>
          ) : null}
        </View>

        <TextField
          label={configured ? 'Replace API key' : 'API key'}
          value={apiKey}
          onChangeText={(value) => {
            setApiKey(value);
            setError('');
            setSaved(false);
          }}
          placeholder="Enter your xAI API key"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          error={error}
          onSubmitEditing={handleSave}
          returnKeyType="done"
        />

        {saved ? (
          <Text accessibilityRole="alert" style={styles.success}>
            API key saved securely.
          </Text>
        ) : null}

        <Button
          label="Save API Key"
          onPress={handleSave}
          loading={saving}
          disabled={!apiKey.trim()}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, padding: Spacing.md, gap: Spacing.lg },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  title: { color: Colors.text, fontSize: FontSize.lg, fontWeight: '700' },
  description: { color: Colors.textMuted, fontSize: FontSize.sm, lineHeight: 20 },
  configured: { color: Colors.success, fontSize: FontSize.sm, fontWeight: '700' },
  notConfigured: { color: Colors.textFaint, fontSize: FontSize.sm },
  success: { color: Colors.success, fontSize: FontSize.sm, textAlign: 'center' },
});
