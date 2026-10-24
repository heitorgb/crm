import { presenceLabel, useConversationPresence } from './use-conversation-presence';

interface ConversationPresenceIndicatorProps {
  conversationId: string;
  isGroup: boolean;
}

export function ConversationPresenceIndicator({
  conversationId,
  isGroup,
}: ConversationPresenceIndicatorProps) {
  const presence = useConversationPresence(conversationId);
  const label = presenceLabel(presence, isGroup);
  const active = presence.state === 'composing' || presence.state === 'recording';

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" data-testid="conversation-presence">
      <span
        aria-hidden
        className={
          presence.state === 'online'
            ? 'size-2 shrink-0 rounded-full bg-success'
            : active
              ? 'size-2 shrink-0 animate-pulse rounded-full bg-warning'
              : 'size-2 shrink-0 rounded-full bg-muted-foreground/40'
        }
      />
      <span className="truncate">{label}</span>
    </span>
  );
}
