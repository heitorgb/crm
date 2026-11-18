import { useState } from 'react';
import { Check, Search, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Conversation } from '@/types/attendance';
import { conversationLabel, conversationSubtitle } from './attendance-utils';
import { useConversations, useForwardConversationMessage } from './queries';
import { SenderAvatar } from './sender-avatar';

const MAX_TARGETS = 20;

interface Props {
  sourceConversationId: string;
  messageId: string;
  onClose: () => void;
}

export function ForwardMessageDialog({ sourceConversationId, messageId, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Conversation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const conversations = useConversations({ perPage: 100, search });
  const forward = useForwardConversationMessage();
  const selectedIds = new Set(selected.map((conversation) => conversation.id));

  const toggle = (conversation: Conversation) => {
    setSelected((current) => {
      if (current.some((item) => item.id === conversation.id)) {
        return current.filter((item) => item.id !== conversation.id);
      }
      return current.length >= MAX_TARGETS ? current : [...current, conversation];
    });
  };

  const send = async () => {
    setError(null);
    try {
      await forward.mutateAsync({
        id: sourceConversationId,
        messageId,
        conversationIds: selected.map((conversation) => conversation.id),
      });
      onClose();
    } catch {
      setError('Não foi possível encaminhar a mensagem.');
    }
  };

  const items = conversations.data?.data ?? [];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[min(640px,calc(var(--app-viewport-height,100dvh)-2rem))] max-w-md flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3 pr-12">
          <DialogTitle>Encaminhar mensagem para</DialogTitle>
        </DialogHeader>
        <div className="px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Pesquisar nome ou número"
              aria-label="Buscar conversa"
              className="rounded-full pl-9"
            />
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto pb-2" aria-label="Conversas">
          {items.map((conversation) => {
            const checked = selectedIds.has(conversation.id);
            const label = conversationLabel(conversation);
            const disabled = !checked && selected.length >= MAX_TARGETS;
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={label}
                  disabled={disabled}
                  onClick={() => toggle(conversation)}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-hover disabled:opacity-50',
                    checked && 'bg-primary/5',
                  )}
                >
                  <SenderAvatar
                    conversationId={conversation.id}
                    jid={conversation.isGroup ? null : conversation.externalContactId}
                    name={label}
                    src={conversation.avatarUrl}
                    className="size-11 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {conversationSubtitle(conversation)}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                      checked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50',
                    )}
                  >
                    {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
                  </span>
                </button>
              </li>
            );
          })}
          {conversations.isLoading ? (
            <li className="py-6 text-center text-sm text-muted-foreground">Carregando conversas…</li>
          ) : null}
          {!conversations.isLoading && items.length === 0 ? (
            <li className="py-6 text-center text-sm text-muted-foreground">Nenhuma conversa encontrada</li>
          ) : null}
        </ul>
        {error ? <p role="alert" className="px-4 pb-2 text-sm text-danger">{error}</p> : null}
        {selected.length > 0 ? (
          <div className="flex items-center gap-3 border-t border-border bg-wa-header px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <p className="min-w-0 flex-1 truncate text-sm text-foreground" aria-live="polite">
              {selected.map(conversationLabel).join(', ')}
            </p>
            <Button
              size="icon"
              className="size-11 shrink-0 rounded-full"
              disabled={forward.isPending}
              onClick={() => void send()}
              aria-label={`Encaminhar para ${selected.length} ${selected.length === 1 ? 'conversa' : 'conversas'}`}
            >
              <Send className="size-5" />
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
