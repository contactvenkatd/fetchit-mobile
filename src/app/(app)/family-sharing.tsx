import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';

export default function FamilySharingScreen() {
  return (
    <ScreenPlaceholder
      emoji="👨‍👩‍👧"
      title="Family Sharing"
      description="Share your Max plan with up to 4 family members."
      bullets={[
        'Max owners only — others see an upgrade gate',
        'Invite members by email',
        'Remove members or disband the family',
        'Backed by the family_invites / family_members tables',
      ]}
    />
  );
}
