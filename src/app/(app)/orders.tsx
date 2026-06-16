import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';

export default function OrdersAnalyticsScreen() {
  return (
    <ScreenPlaceholder
      emoji="📊"
      title="Orders & Analytics"
      description="Your spending at a glance, with a breakdown by category."
      bullets={[
        'Total spent and orders placed',
        'Spend by product category',
        'Service fees paid',
        'Order streak 🔥',
      ]}
    />
  );
}
