import { useMemo, useState } from 'react';
import { RefreshCw, Users } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { SearchInput } from '@/components/common/search-input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useConversations } from '@/features/attendance/queries';
import { SenderAvatar } from '@/features/attendance/sender-avatar';
import { conversationLabel } from '@/features/attendance/attendance-utils';
import { useWhatsAppInstances } from '@/features/whatsapp/queries';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { Conversation } from '@/types/attendance';

interface RecipientPickerProps {
  selectedIds: Set<string>;
  onChange: (selected: Set<string>) => void;
}

export function RecipientPicker({ selectedIds, onChange }: RecipientPickerProps) {
  const [search, setSearch] = useState('');
  const [instanceId, setInstanceId] = useState('ALL');
  const debouncedSearch = useDebouncedValue(search, 300);
  const instancesQuery = useWhatsAppInstances({ perPage: 100 });
  const conversationsQuery = useConversations({
    perPage: 100,
    search: debouncedSearch || undefined,
    whatsappInstanceId: instanceId === 'ALL' ? undefined : instanceId,
    archived: false,
  });

  const conversations = useMemo(
    () => conversationsQuery.data?.data ?? [],
    [conversationsQuery.data?.data],
  );
  const allSelected = useMemo(
    () => conversations.length > 0 && conversations.every((item) => selectedIds.has(item.id)),
    [conversations, selectedIds],
  );

  const toggle = (id: string): void => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const toggleAll = (): void => {
    if (allSelected) {
      const next = new Set(selectedIds);
      conversations.forEach((item) => next.delete(item.id));
      onChange(next);
      return;
    }
    const next = new Set(selectedIds);
    conversations.forEach((item) => next.add(item.id));
    onChange(next);
  };

  return (
    <div className="space-y-2 rounded-md border border-border p-2.5">
      <div className="flex flex-col gap-2 sm:flex-row">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar contato ou conversa"
          className="flex-1"
        />
        <Select value={instanceId} onValueChange={setInstanceId}>
          <SelectTrigger className="sm:w-48" aria-label="Filtrar por WhatsApp">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos os WhatsApps</SelectItem>
            {(instancesQuery.data?.data ?? []).map((instance) => (
              <SelectItem key={instance.id} value={instance.id}>
                {instance.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{selectedIds.size} destinatário(s) selecionado(s)</span>
        <Button type="button" variant="ghost" size="sm" onClick={toggleAll}>
          {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
        </Button>
      </div>

      <div className="max-h-56 overflow-y-auto">
        {conversationsQuery.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : conversationsQuery.isError ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-sm font-medium text-danger">
              Não foi possível carregar os destinatários.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void conversationsQuery.refetch()}
            >
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        ) : conversations.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Nenhum destinatário encontrado"
            description="Ajuste a busca ou o filtro de WhatsApp."
          />
        ) : (
          conversations.map((conversation) => (
            <RecipientRow
              key={conversation.id}
              conversation={conversation}
              checked={selectedIds.has(conversation.id)}
              onToggle={() => toggle(conversation.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function RecipientRow({
  conversation,
  checked,
  onToggle,
}: {
  conversation: Conversation;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-hover">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="size-4 shrink-0 cursor-pointer rounded border-border accent-primary"
      />
      <SenderAvatar
        conversationId={conversation.id}
        jid={conversation.isGroup ? null : conversation.externalContactId}
        name={conversationLabel(conversation)}
        src={conversation.avatarUrl}
        className="size-8"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{conversationLabel(conversation)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {conversation.contactPhone ?? conversation.instanceName}
        </p>
      </div>
    </label>
  );
}
