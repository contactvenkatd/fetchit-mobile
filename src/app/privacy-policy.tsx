import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';

export default function PrivacyPolicyScreen() {
  return (
    <ScreenPlaceholder
      emoji="🔒"
      title="Privacy Policy"
      description="How FetchIt collects, uses, and protects your data. Public — no login required."
      bullets={[
        'What we collect and why',
        'How shopping data is used',
        'Third-party processors (Supabase, Stripe, retailers)',
        'Your rights and account deletion',
      ]}
    />
  );
}
