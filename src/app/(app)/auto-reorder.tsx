import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';

export default function AutoReorderScreen() {
  return (
    <ScreenPlaceholder
      emoji="🔁"
      title="Auto-Reorder"
      description="Recurring purchases on a schedule you control."
      bullets={[
        'Weekly, biweekly, or monthly cadence',
        'Pause or cancel any schedule',
        'Next-order date for each item',
        'Backed by the Supabase auto_reorders table',
      ]}
    />
  );
}
