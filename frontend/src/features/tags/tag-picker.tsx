import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, Search, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useTags } from './queries';

interface TagPickerProps {
  value: string[];
  onValueChange: (value: string[]) => void;
  disabled?: boolean;
}

export function TagPicker({ value, onValueChange, disabled }: TagPickerProps) {
  const [search, setSearch] = useState('');
  const query = useTags({ perPage: 100, sort: 'name', order: 'asc' });
  const tags = useMemo(() => query.data?.data ?? [], [query.data?.data]);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return term ? tags.filter((tag) => tag.name.toLocaleLowerCase('pt-BR').includes(term)) : tags;
  }, [search, tags]);

  const toggle = (id: string): void => {
    onValueChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  };

  return (
    <div className="space-y-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-between font-normal" disabled={disabled}>
            <span className="flex min-w-0 items-center gap-2">
              <Tags className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{value.length ? `${value.length} etiqueta(s)` : 'Selecionar etiquetas'}</span>
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar etiqueta" className="pl-8" />
          </div>
          <div className="max-h-56 overflow-y-auto scrollbar-thin">
            {query.isPending ? (
              <div className="flex items-center justify-center p-4"><Loader2 className="size-4 animate-spin" /></div>
            ) : filtered.length === 0 ? (
              <p className="p-3 text-center text-xs text-muted-foreground">Nenhuma etiqueta encontrada.</p>
            ) : filtered.map((tag) => {
              const selected = value.includes(tag.id);
              return (
                <button key={tag.id} type="button" onClick={() => toggle(tag.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted">
                  <span className={cn('flex size-4 items-center justify-center rounded border border-border', selected && 'bg-primary text-primary-foreground')}>
                    {selected ? <Check className="size-3" /> : null}
                  </span>
                  <span className="size-2.5 rounded-full border border-border" style={{ backgroundColor: tag.color ?? 'transparent' }} />
                  <span className="truncate">{tag.name}</span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {tags.filter((tag) => value.includes(tag.id)).map((tag) => (
            <span key={tag.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px]" style={{ backgroundColor: tag.color ? `${tag.color}18` : undefined }}>
              <span className="size-2 rounded-full" style={{ backgroundColor: tag.color ?? '#94a3b8' }} />{tag.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
