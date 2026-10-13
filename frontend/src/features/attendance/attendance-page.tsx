import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MessageSquare, RefreshCw } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useNotificationStore } from '@/stores/notification-store';
import type { ConversationStatus } from '@/types/attendance';
import { useWhatsAppInstances } from '@/features/whatsapp/queries';
import { ChatPanel } from './chat-panel';
import { ContactPanel } from './contact-panel';
import { ConversationList } from './conversation-list';
import { isMediaPending } from './media-message-utils';
import {
  useCloseConversation,
  useConversation,
  useConversationMessages,
  useConversations,
  useRefreshGroup,
  useTakeoverConversation,
} from './queries';
import { useAttendanceRealtime } from './use-realtime';

function useMinWidth(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const handler = (): void => setMatches(media.matches);
    handler();
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

export function AttendancePage() {
  const { connected } = useAttendanceRealtime();
  const [searchParams, setSearchParams] = useSearchParams();
  const isDesktop = useMinWidth('(min-width: 1280px)');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ConversationStatus | 'ALL'>('ALL');
  const [instanceId, setInstanceId] = useState<string>('ALL');
  const [panelOpen, setPanelOpen] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);

  const selectedId = searchParams.get('conversation');

  const instancesQuery = useWhatsAppInstances({ perPage: 100 });
  const conversationsQuery = useConversations({
    perPage: 50,
    search: search || undefined,
    status: status === 'ALL' ? undefined : status,
    whatsappInstanceId: instanceId === 'ALL' ? undefined : instanceId,
  });
  const conversations = conversationsQuery.data?.data ?? [];
  const activeId = selectedId;

  const conversationQuery = useConversation(activeId ?? undefined);
  const messagesQuery = useConversationMessages(activeId ?? undefined);
  const closeConversation = useCloseConversation();
  const reopenConversation = useTakeoverConversation();
  const refreshGroup = useRefreshGroup();
  const markRead = useNotificationStore((state) => state.markRead);

  const conversation = conversationQuery.data ?? null;
  const visibleMessages = (messagesQuery.data?.data ?? []).filter(
    (message) => !isMediaPending(message),
  );
  const mobileChatView = selectedId !== null;

  const handleSelect = (id: string): void => {
    setSearchParams({ conversation: id }, { replace: true });
  };
  const handleDeselect = (): void => {
    setSearchParams({}, { replace: true });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented && searchParams.get('conversation')) {
        setSearchParams({}, { replace: true });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (activeId) {
      markRead(activeId);
    }
  }, [activeId, messagesQuery.data, markRead]);

  const handleToggleInfo = (): void => {
    if (isDesktop) {
      setPanelOpen((value) => !value);
    } else {
      setInfoOpen(true);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-card">
      {!connected ? (
        <div className="flex items-center justify-center gap-2 bg-warning/15 px-3 py-1.5 text-xs font-medium text-warning">
          Reconectando ao servidor…
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            'min-h-0 w-full md:w-[320px] lg:w-[360px] xl:w-[380px]',
            mobileChatView ? 'hidden md:flex' : 'flex',
          )}
        >
          <ConversationList
            conversations={conversations}
            activeId={activeId}
            onSelect={handleSelect}
            isPending={conversationsQuery.isPending}
            isError={conversationsQuery.isError}
            onRetry={() => void conversationsQuery.refetch()}
            search={search}
            onSearchChange={setSearch}
            status={status}
            onStatusChange={(value) => {
              setStatus(value);
              handleDeselect();
            }}
            instanceId={instanceId}
            onInstanceChange={(value) => {
              setInstanceId(value);
              handleDeselect();
            }}
            instances={instancesQuery.data?.data ?? []}
          />
        </div>

        <div
          className={cn(
            'min-h-0 min-w-0 flex-1',
            mobileChatView ? 'flex' : 'hidden md:flex',
          )}
        >
          {!activeId ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                icon={MessageSquare}
                title="Selecione uma conversa"
                description="Escolha uma conversa à esquerda para ver as mensagens e responder."
              />
            </div>
          ) : conversation ? (
            <ChatPanel
              key={conversation.id}
              conversation={conversation}
              messages={visibleMessages}
              messagesPending={messagesQuery.isPending}
              messagesError={messagesQuery.isError}
              onRetryMessages={() => void messagesQuery.refetch()}
              onBack={handleDeselect}
              onToggleInfo={handleToggleInfo}
              closePending={closeConversation.isPending}
              onClose={() => {
                if (activeId) void closeConversation.mutateAsync(activeId);
              }}
              reopenPending={reopenConversation.isPending}
              onReopen={() => {
                if (activeId) void reopenConversation.mutateAsync(activeId);
              }}
              refreshPending={refreshGroup.isPending}
              onRefreshGroup={() => {
                if (activeId) void refreshGroup.mutateAsync(activeId);
              }}
            />
          ) : conversationQuery.isError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm font-medium text-danger">
                Não foi possível carregar a conversa.
              </p>
              <Button variant="outline" size="sm" onClick={() => void conversationQuery.refetch()}>
                <RefreshCw />
                Tentar novamente
              </Button>
            </div>
          ) : (
            <div className="flex flex-1 flex-col">
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <Skeleton className="size-10 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <div className="chat-wallpaper flex flex-1 flex-col gap-3 p-4">
                <Skeleton className="h-12 w-2/5" />
                <Skeleton className="ml-auto h-12 w-1/3" />
                <Skeleton className="h-12 w-2/5" />
              </div>
            </div>
          )}
        </div>

        {panelOpen && isDesktop ? (
          <div className="hidden w-[300px] border-l border-border xl:flex">
            <ContactPanel
              conversation={conversation}
              onRefreshGroup={() => {
                if (activeId) void refreshGroup.mutateAsync(activeId);
              }}
              refreshingGroup={refreshGroup.isPending}
            />
          </div>
        ) : null}
      </div>

      <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
        <SheetContent side="right" className="w-[320px] p-0 xl:hidden">
          <SheetTitle className="sr-only">Informações da conversa</SheetTitle>
          <ContactPanel
            conversation={conversation}
            onRefreshGroup={() => {
              if (activeId) void refreshGroup.mutateAsync(activeId);
            }}
            refreshingGroup={refreshGroup.isPending}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
