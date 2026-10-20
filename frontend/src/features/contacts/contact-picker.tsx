import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';
import type { Contact } from '@/types/crm';
import { useContacts } from './queries';

export type ContactPickerOption = Pick<Contact, 'id' | 'name' | 'phone'>;

interface ContactPickerProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  selectedContact?: ContactPickerOption | null;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
}

export function ContactPicker({
  id,
  value,
  onValueChange,
  selectedContact,
  placeholder = 'Selecione um contato',
  searchPlaceholder = 'Buscar por nome ou telefone',
  disabled = false,
}: ContactPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [localSelection, setLocalSelection] = useState<ContactPickerOption | null>(
    selectedContact?.id === value ? selectedContact : null,
  );
  const normalizedSearch = normalizeSearch(search);
  const debouncedSearch = useDebouncedValue(normalizedSearch, 250);
  const contacts = useContacts({
    page: 1,
    perPage: 50,
    search: debouncedSearch || undefined,
    sort: 'name',
    order: 'asc',
  });
  const options = useMemo(() => contacts.data?.data ?? [], [contacts.data?.data]);
  const visibleOptions = useMemo(
    () => options.filter((contact) => matchesSearch(contact, normalizedSearch)),
    [normalizedSearch, options],
  );
  const current =
    (localSelection?.id === value ? localSelection : null) ??
    (selectedContact?.id === value ? selectedContact : null) ??
    options.find((contact) => contact.id === value) ??
    null;

  const selectContact = (contact: ContactPickerOption): void => {
    setLocalSelection(contact);
    onValueChange(contact.id);
    setSearch('');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setSearch(''); }}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={disabled}
        >
          <span className={cn('truncate', !current && 'text-muted-foreground')}>
            {current ? contactLabel(current) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0">
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="pl-8 pr-8"
            />
            {contacts.isFetching ? (
              <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground"
                aria-label="Limpar busca de contatos"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        </div>

        <div role="listbox" className="max-h-64 overflow-y-auto p-1 scrollbar-thin">
          {contacts.isPending ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Carregando contatos…</p>
          ) : contacts.isError ? (
            <div className="flex flex-col items-center gap-2 px-3 py-5 text-center">
              <p className="text-sm font-medium text-danger">Não foi possível carregar os contatos.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void contacts.refetch()}>
                <RefreshCw />Tentar novamente
              </Button>
            </div>
          ) : visibleOptions.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {normalizedSearch ? 'Nenhum contato encontrado.' : 'Nenhum contato cadastrado.'}
            </p>
          ) : (
            visibleOptions.map((contact) => (
              <button
                key={contact.id}
                type="button"
                role="option"
                aria-selected={contact.id === value}
                onClick={() => selectContact(contact)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm transition-colors hover:bg-surface-hover focus:bg-surface-hover focus:outline-none',
                  contact.id === value && 'bg-primary/10',
                )}
              >
                <Check className={cn('size-4 shrink-0 text-primary', contact.id !== value && 'invisible')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{contact.name}</span>
                  {contact.phone ? <span className="block truncate text-xs text-muted-foreground">{contact.phone}</span> : null}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function normalizeSearch(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[a-zA-ZÀ-ÿ]/.test(trimmed)) return trimmed;
  return trimmed.replace(/\D/g, '');
}

function matchesSearch(contact: ContactPickerOption, search: string): boolean {
  if (!search) return true;
  const normalized = search.toLocaleLowerCase('pt-BR');
  return contact.name.toLocaleLowerCase('pt-BR').includes(normalized) || (contact.phone?.includes(normalized) ?? false);
}

function contactLabel(contact: ContactPickerOption): string {
  return contact.phone ? `${contact.name} · ${contact.phone}` : contact.name;
}
