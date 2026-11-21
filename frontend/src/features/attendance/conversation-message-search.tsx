import { useEffect, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ConversationMessageSearchResult } from '@/types/attendance';
import { useConversationMessageSearch } from './queries';

const SEARCH_DEBOUNCE_MS = 300;

interface ConversationMessageSearchProps {
  conversationId: string;
  onClose: () => void;
  onSelect: (result: ConversationMessageSearchResult) => void;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function HighlightedText({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(term)})`, 'gi'));
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === term.toLowerCase() ? (
          <mark key={index} className="rounded-sm bg-primary/20 px-0.5 text-foreground">{part}</mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
});

export function ConversationMessageSearch({ conversationId, onClose, onSelect }: ConversationMessageSearchProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const search = useConversationMessageSearch(conversationId, debounced);
  const results = search.data ?? [];
  const searching = debounced.length >= 2;

  return (
    <div className="relative shrink-0 border-b border-border bg-background px-2 py-2 sm:px-4">
      <div className="flex items-center gap-2">
        <label className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            autoFocus
            aria-label="Pesquisar mensagens"
            placeholder="Pesquisar nesta conversa"
            className="pl-9"
            value={query}
            maxLength={120}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
          />
        </label>
        <Button variant="ghost" size="icon" type="button" onClick={onClose} aria-label="Fechar pesquisa">
          <X />
        </Button>
      </div>
      {searching ? (
        <div className="absolute inset-x-2 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border bg-popover shadow-lg scrollbar-thin sm:inset-x-4">
          {search.isPending ? (
            <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Pesquisando…
            </p>
          ) : search.isError ? (
            <p role="alert" className="p-3 text-sm text-danger">Não foi possível pesquisar as mensagens.</p>
          ) : results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Nenhuma mensagem encontrada.</p>
          ) : (
            <ul aria-label="Resultados da pesquisa">
              {results.map((result) => (
                <li key={result.id} className="border-b last:border-b-0">
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left hover:bg-surface-hover"
                    onClick={() => onSelect(result)}
                  >
                    <span className="flex justify-between gap-2 text-xs text-muted-foreground">
                      <span className="truncate font-medium">
                        {result.direction === 'OUTBOUND' ? 'Você' : (result.senderName ?? 'Contato')}
                      </span>
                      <span className="shrink-0">{dateFormatter.format(new Date(result.occurredAt))}</span>
                    </span>
                    <span className="line-clamp-2 text-sm">
                      <HighlightedText text={result.text} term={debounced} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {results.length === 50 ? (
            <p className="p-2 text-center text-xs text-muted-foreground">Mostrando as 50 mensagens mais recentes.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
