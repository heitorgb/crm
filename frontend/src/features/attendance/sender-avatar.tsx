import { UserAvatar } from '@/components/common/user-avatar';
import { useParticipantAvatar } from './queries';

interface SenderAvatarProps {
  conversationId: string;
  jid: string | null;
  name: string | null;
  src?: string | null;
  className?: string;
}

export function SenderAvatar({ conversationId, jid, name, src, className }: SenderAvatarProps) {
  const query = useParticipantAvatar(conversationId, src ? null : jid);

  return (
    <UserAvatar
      name={name ?? jid ?? '?'}
      src={src ?? query.data?.url ?? undefined}
      className={className ?? 'mt-0.5 size-7 shrink-0'}
    />
  );
}
