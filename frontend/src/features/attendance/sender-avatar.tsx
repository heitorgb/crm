import { UserAvatar } from '@/components/common/user-avatar';
import { useParticipantAvatar } from './queries';

interface SenderAvatarProps {
  conversationId: string;
  jid: string | null;
  name: string | null;
}

export function SenderAvatar({ conversationId, jid, name }: SenderAvatarProps) {
  const query = useParticipantAvatar(conversationId, jid);

  return (
    <UserAvatar
      name={name ?? jid ?? '?'}
      src={query.data?.url ?? undefined}
      className="mt-0.5 size-7 shrink-0"
    />
  );
}
