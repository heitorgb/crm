import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import type { Conversation } from '@/types/attendance';
import {
  conversationLabel,
  conversationStatusLabel,
  conversationStatusTone,
} from './attendance-utils';
import { SenderAvatar } from './sender-avatar';

interface ContactPanelProps {
  conversation: Conversation | null;
  onRefreshGroup: () => void;
  refreshingGroup: boolean;
}

export function ContactPanel({
  conversation,
  onRefreshGroup,
  refreshingGroup,
}: ContactPanelProps) {
  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Nenhuma conversa selecionada.
      </div>
    );
  }

  const isGroup = conversation.isGroup;
  const phone = conversation.contactPhone ?? conversation.externalContactId;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center border-b border-border px-4">
        <p className="text-sm font-semibold text-foreground">
          {isGroup ? 'Dados do grupo' : 'Dados do contato'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="flex flex-col items-center gap-3 border-b border-border px-4 py-7 text-center">
          <SenderAvatar
            conversationId={conversation.id}
            jid={isGroup ? null : conversation.externalContactId}
            name={conversationLabel(conversation)}
            src={conversation.avatarUrl}
            className="size-24 text-lg"
          />
          <div className="min-w-0 space-y-1">
            <p className="truncate text-base font-semibold text-foreground">
              {conversationLabel(conversation)}
            </p>
            {phone ? (
              <p className="truncate font-mono text-xs text-muted-foreground">{phone}</p>
            ) : null}
          </div>
          <StatusBadge tone={conversationStatusTone[conversation.status]}>
            {conversationStatusLabel[conversation.status]}
          </StatusBadge>
        </div>

        <div className="divide-y divide-border">
          <InfoRow label="WhatsApp">{conversation.instanceName}</InfoRow>
          <InfoRow label="Tipo">{isGroup ? 'Grupo' : 'Contato individual'}</InfoRow>
          {conversation.customerName ? (
            <InfoRow label="Cliente">{conversation.customerName}</InfoRow>
          ) : null}
          {conversation.subject ? (
            <InfoRow label="Assunto">{conversation.subject}</InfoRow>
          ) : null}
        </div>

        <div className="space-y-2 border-t border-border p-4">
          {conversation.contactId ? (
            <Button variant="outline" size="sm" className="w-full justify-start" asChild>
              <Link to={`/contatos/${conversation.contactId}`}>Ver contato</Link>
            </Button>
          ) : null}
          {isGroup ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={onRefreshGroup}
              disabled={refreshingGroup}
            >
              <RefreshCw />
              {refreshingGroup ? 'Atualizando…' : 'Atualizar dados do grupo'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-sm text-foreground">{children}</span>
    </div>
  );
}
