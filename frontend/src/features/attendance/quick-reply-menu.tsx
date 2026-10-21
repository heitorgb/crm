import { Loader2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { QuickReply } from '@/types/quick-replies';

interface QuickReplyMenuProps {
  items: QuickReply[];
  activeIndex: number;
  loading: boolean;
  error: boolean;
  onSelect: (quickReply: QuickReply) => void;
  onActiveIndexChange: (index: number) => void;
}

export function QuickReplyMenu({
  items,
  activeIndex,
  loading,
  error,
  onSelect,
  onActiveIndexChange,
}: QuickReplyMenuProps) {
  return (
    <div className="absolute inset-x-2 bottom-full z-30 mb-2 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Zap className="size-4 text-primary" aria-hidden />
        <p className="text-xs font-semibold">Respostas rápidas</p>
        <span className="ml-auto text-[11px] text-muted-foreground">Digite / e filtre</span>
      </div>

      <div
        role="listbox"
        aria-label="Respostas rápidas"
        className="max-h-64 overflow-y-auto p-1 scrollbar-thin"
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Carregando respostas rápidas…
          </div>
        ) : error ? (
          <p className="px-3 py-6 text-center text-xs font-medium text-danger">
            Não foi possível carregar as respostas rápidas.
          </p>
        ) : items.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            Nenhuma resposta rápida encontrada.
          </p>
        ) : (
          items.map((quickReply, index) => (
            <button
              key={quickReply.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onActiveIndexChange(index)}
              onClick={() => onSelect(quickReply)}
              className={cn(
                'flex w-full flex-col items-start rounded-md px-2.5 py-2 text-left transition-colors',
                index === activeIndex
                  ? 'bg-surface-hover text-foreground'
                  : 'text-foreground/90 hover:bg-surface-hover',
              )}
            >
              <span className="w-full truncate text-sm font-medium">{quickReply.title}</span>
              <span className="mt-0.5 line-clamp-1 w-full text-xs text-muted-foreground">
                {quickReply.content}
              </span>
            </button>
          ))
        )}
      </div>

      <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        ↑ ↓ navegar · Enter inserir · Esc fechar
      </div>
    </div>
  );
}
