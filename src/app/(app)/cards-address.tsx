import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';

export default function CardsAddressScreen() {
  return (
    <ScreenPlaceholder
      emoji="💳"
      title="Cards & Address"
      description="Manage your shipping address and saved payment method."
      bullets={[
        'Identity reauth wall before editing',
        'Shipping address fields',
        'Saved card via Stripe (brand + last4)',
        'Backed by the Supabase profiles table',
      ]}
    />
  );
}
