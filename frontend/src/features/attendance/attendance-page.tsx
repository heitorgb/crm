import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MessageSquare, RefreshCw } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useAttendanceViewStore } from '@/stores/attendance-view-store';
import { cn } from '@/lib/utils';
import type { Conversation } from '@/types/attendance';
import { useWhatsAppInstances } from '@/features/whatsapp/queries';
import { ChatPanel } from './chat-panel';
import { ContactPanel } from './contact-panel';
import { ConversationList } from './conversation-list';
import { ConversationTagsDialog } from './conversation-tags-dialog';
import { HistorySyncBanner } from './history-sync-banner';
import { PhotoSendFlow } from './photo-send-flow';
import { buildTimeline, conversationLabel } from './attendance-utils';
import { isMediaPending } from './media-message-utils';
import {
  useCloseConversation,
  useConversation,
  useConversationHistoryMessages,
  useConversationMessages,
  useConversations,
  useDeleteConversation,
  useMarkConversationRead,
  useRefreshGroup,
  useSetConversationArchived,
  useSetConversationPinned,
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
  const [searchParams, setSearchParams] = useSearchParams();
  const isDesktop = useMinWidth('(min-width: 1280px)');

  const search = useAttendanceViewStore((state) => state.search);
  const status = useAttendanceViewStore((state) => state.status);
  const instanceId = useAttendanceViewStore((state) => state.instanceId);
  const archivedView = useAttendanceViewStore((state) => state.archivedView);
  const setSearch = useAttendanceViewStore((state) => state.setSearch);
  const setStatus = useAttendanceViewStore((state) => state.setStatus);
  const setInstanceId = useAttendanceViewStore((state) => state.setInstanceId);
  const setArchivedView = useAttendanceViewStore((state) => state.setArchivedView);
  const photoComposerOpen = useAttendanceViewStore((state) => state.photoComposerOpen);
  const closePhotoComposer = useAttendanceViewStore((state) => state.closePhotoComposer);
  const [panelOpen, setPanelOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [historyRequestedId, setHistoryRequestedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [tagConversation, setTagConversation] = useState<Conversation | null>(null);

  const selectedId = searchParams.get('conversation');
  const { connected } = useAttendanceRealtime(selectedId);

  // Socket events are the primary update path; this fallback catches a missed
  // completion event without making the attendance screen depend on polling.
  const instancesQuery = useWhatsAppInstances({ perPage: 100 }, { refetchInterval: 60_000 });
  const conversationsQuery = useConversations({
    perPage: 50,
    search: search || undefined,
    status: status === 'ALL' ? undefined : status,
    whatsappInstanceId: instanceId === 'ALL' ? undefined : instanceId,
    archived: archivedView,
  });
  const conversations = conversationsQuery.data?.data ?? [];
  const activeId = selectedId;

  const conversationQuery = useConversation(activeId ?? undefined);
  const messagesQuery = useConversationMessages(activeId ?? undefined);
  const historyEnabled = activeId !== null && historyRequestedId === activeId;
  const historyQuery = useConversationHistoryMessages(activeId ?? undefined, historyEnabled);
  const closeConversation = useCloseConversation();
  const reopenConversation = useTakeoverConversation();
  const refreshGroup = useRefreshGroup();
  const setPinned = useSetConversationPinned();
  const setArchived = useSetConversationArchived();
  const deleteConversation = useDeleteConversation();
  const markConversationRead = useMarkConversationRead();
  const { mutate: markRead } = markConversationRead;
  const lastMarkedRef = useRef<{ id: string; count: number } | null>(null);

  const conversation = conversationQuery.data ?? null;
  const unreadCount = conversationQuery.data?.unreadCount ?? 0;
  const visibleMessages = buildTimeline(
    historyQuery.data?.pages,
    messagesQuery.data?.data ?? [],
  ).filter((message) => !isMediaPending(message));
  const totalPages = messagesQuery.data?.meta.totalPages ?? 1;
  const hasOlderMessages = historyQuery.data ? historyQuery.hasNextPage === true : totalPages > 1;
  const loadingOlderMessages =
    historyQuery.isFetchingNextPage || (historyEnabled && historyQuery.isPending);
  const mobileChatView = selectedId !== null;

  const handleLoadOlderMessages = (): void => {
    if (!activeId) {
      return;
    }
    if (!historyEnabled) {
      setHistoryRequestedId(activeId);
      return;
    }
    if (historyQuery.hasNextPage && !historyQuery.isFetchingNextPage) {
      void historyQuery.fetchNextPage();
    }
  };

  const handleSelect = (id: string): void => {
    setSearchParams({ conversation: id }, { replace: true });
  };
  const handleDeselect = (): void => {
    setSearchParams({}, { replace: true });
  };

  const filterSignature = `${status}|${instanceId}|${archivedView}`;
  const previousFiltersRef = useRef(filterSignature);

  useEffect(() => {
    if (previousFiltersRef.current === filterSignature) {
      return;
    }
    previousFiltersRef.current = filterSignature;
    setSearchParams({}, { replace: true });
  }, [filterSignature, setSearchParams]);

  const handleArchivedChange = (value: boolean): void => {
    setArchivedView(value);
    handleDeselect();
  };

  const handleTogglePin = (conversation: Conversation): void => {
    setPinned.mutate({ id: conversation.id, pinned: !conversation.isPinned });
  };

  const handleToggleArchive = (conversation: Conversation): void => {
    setArchived.mutate(
      { id: conversation.id, archived: !conversation.isArchived },
      {
        onSuccess: () => {
          if (activeId === conversation.id) {
            handleDeselect();
          }
        },
      },
    );
  };

  const handleDeleteRequest = (conversation: Conversation): void => {
    setDeleteError(null);
    setPendingDelete(conversation);
  };

  const handleDeleteCancel = (): void => {
    setPendingDelete(null);
    setDeleteError(null);
  };

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!pendingDelete) {
      return;
    }
    setDeleteError(null);
    try {
      await deleteConversation.mutateAsync(pendingDelete.id);
      if (activeId === pendingDelete.id) {
        handleDeselect();
      }
      setPendingDelete(null);
    } catch {
      setDeleteError('Não foi possível excluir a conversa. Tente novamente.');
    }
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
    if (!activeId || unreadCount <= 0) {
      return;
    }
    const last = lastMarkedRef.current;
    if (last && last.id === activeId && last.count === unreadCount) {
      return;
    }
    lastMarkedRef.current = { id: activeId, count: unreadCount };
    markRead(activeId, {
      onError: () => {
        lastMarkedRef.current = null;
      },
    });
  }, [activeId, unreadCount, markRead]);

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

      <HistorySyncBanner
        instances={instancesQuery.data?.data ?? []}
        selectedInstanceId={instanceId}
      />

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
            onTogglePin={handleTogglePin}
            pinPendingId={setPinned.isPending ? (setPinned.variables?.id ?? null) : null}
            archived={archivedView}
            onArchivedChange={handleArchivedChange}
            onToggleArchive={handleToggleArchive}
            archivePendingId={setArchived.isPending ? (setArchived.variables?.id ?? null) : null}
            onDelete={handleDeleteRequest}
            deletePendingId={
              deleteConversation.isPending ? (deleteConversation.variables ?? null) : null
            }
            onEditTags={setTagConversation}
          />
        </div>

        <div className={cn('min-h-0 min-w-0 flex-1', mobileChatView ? 'flex' : 'hidden md:flex')}>
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
              hasOlderMessages={hasOlderMessages}
              loadingOlderMessages={loadingOlderMessages}
              onLoadOlderMessages={handleLoadOlderMessages}
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

      <PhotoSendFlow
        open={photoComposerOpen}
        onOpenChange={(next) => {
          if (!next) {
            closePhotoComposer();
          }
        }}
      />

      {tagConversation ? (
        <ConversationTagsDialog
          key={tagConversation.id}
          conversation={tagConversation}
          open
          onOpenChange={(open) => {
            if (!open) setTagConversation(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open && deleteConversation.isPending) {
            return;
          }
          if (!open) {
            handleDeleteCancel();
          }
        }}
        title="Excluir conversa"
        description={
          deleteError ? (
            <span className="text-danger">{deleteError}</span>
          ) : pendingDelete ? (
            `A conversa "${conversationLabel(pendingDelete)}" será removida da listagem do CRM. O histórico é preservado e nada é excluído no WhatsApp.`
          ) : undefined
        }
        confirmLabel="Excluir"
        destructive
        loading={deleteConversation.isPending}
        onConfirm={() => void handleDeleteConfirm()}
      />
    </div>
  );
}
