import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';

export default function WishlistScreen() {
  return (
    <ScreenPlaceholder
      emoji="♡"
      title="Wishlist"
      description="Products you've saved to buy later."
      bullets={[
        'Saved from the chat with "Save to Wishlist"',
        'Tap to buy or remove',
        'Backed by the Supabase wishlists table',
      ]}
    />
  );
}
