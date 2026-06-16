import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';

export default function TosScreen() {
  return (
    <ScreenPlaceholder
      emoji="📜"
      title="Terms of Service"
      description="The full FetchIt Terms of Service. Public — no login required."
      bullets={[
        'Service fee applies to every order',
        'Shopping data may train AI models',
        '18+ only',
        'Orders are placed via third-party retailers',
      ]}
    />
  );
}
