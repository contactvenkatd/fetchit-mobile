import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';

export default function OrderHistoryScreen() {
  return (
    <ScreenPlaceholder
      emoji="📦"
      title="Order History"
      description="Every order FetchIt has placed for you, newest first."
      bullets={[
        'Product photo, name, retailer, and price',
        'Order status and date',
        'Service fee per order',
        'Backed by the Supabase orders table',
      ]}
    />
  );
}
