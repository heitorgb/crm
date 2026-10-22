import {
  CalendarDays,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  RefreshCw,
  UserRound,
} from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { StatusBadge } from '@/components/common/status-badge';
import { UserAvatar } from '@/components/common/user-avatar';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import { formatDateOnly } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Contact } from '@/types/crm';
import { useContact } from './queries';

interface ContactDetailSheetProps {
  contactId: string;
  onOpenChange: (open: boolean) => void;
  onEdit: (contact: Contact) => void;
  onStartConversation: (contact: Contact) => void;
}

export function ContactDetailSheet({
  contactId,
  onOpenChange,
  onEdit,
  onStartConversation,
}: ContactDetailSheetProps) {
  const query = useContact(contactId);
  const contact = query.data;
  const notFound = query.error instanceof ApiError && query.error.status === 404;

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <SheetTitle className="sr-only">Detalhes do contato</SheetTitle>

        {query.isPending ? (
          <div className="space-y-5 p-5 pt-14">
            <div className="flex items-center gap-3">
              <Skeleton className="size-14 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : query.isError || !contact ? (
          <div className="p-5 pt-14">
            <EmptyState
              icon={UserRound}
              title={notFound ? 'Contato não encontrado' : 'Não foi possível carregar o contato'}
              description={
                notFound
                  ? 'O contato pode ter sido removido ou pertence a outra organização.'
                  : 'Tente novamente em alguns instantes.'
              }
              action={
                notFound ? (
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Fechar
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => void query.refetch()}>
                    <RefreshCw />
                    Tentar novamente
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <>
            <header className="border-b border-border bg-surface/40 px-5 py-5 pr-12">
              <div className="flex items-start gap-3">
                <UserAvatar
                  name={contact.name}
                  src={contact.avatarUrl ?? undefined}
                  className="size-14 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-base">{contact.name}</SheetTitle>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {contact.position ?? 'Cargo não informado'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {contact.isPrimary ? <StatusBadge tone="info">Principal</StatusBadge> : null}
                    {contact.isBlocked ? (
                      <StatusBadge tone="danger">Bloqueado</StatusBadge>
                    ) : (
                      <StatusBadge tone="success">Recebendo mensagens</StatusBadge>
                    )}
                  </div>
                </div>
              </div>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto p-5 scrollbar-thin">
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Contato
                </h3>
                <dl className="mt-2 divide-y divide-border rounded-md border border-border">
                  <DetailRow icon={Phone} label="Telefone" value={contact.phone} mono />
                  <DetailRow icon={Mail} label="E-mail" value={contact.email} />
                  <DetailRow icon={UserRound} label="Cliente" value={contact.customerName} />
                </dl>
              </section>

              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Informações pessoais
                </h3>
                <dl className="mt-2 divide-y divide-border rounded-md border border-border">
                  <DetailRow
                    icon={CalendarDays}
                    label="Data de nascimento"
                    value={contact.birthDate ? formatDateOnly(contact.birthDate) : null}
                  />
                  <DetailRow icon={MapPin} label="Endereço" value={contact.address} multiline />
                </dl>
              </section>

              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Cargo / observação
                </h3>
                <dl className="mt-2 divide-y divide-border rounded-md border border-border">
                  <DetailRow icon={UserRound} label="Cargo / observação" value={contact.position} />
                </dl>
              </section>
            </div>

            <footer className="border-t border-border bg-card p-4">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => onEdit(contact)}>
                  <Pencil />
                  Editar
                </Button>
                <Button
                  onClick={() => onStartConversation(contact)}
                  disabled={!contact.phone}
                  title={contact.phone ? undefined : 'Cadastre um telefone para iniciar'}
                >
                  <MessageSquare />
                  Conversar
                </Button>
              </div>
            </footer>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

interface DetailRowProps {
  icon: typeof Phone;
  label: string;
  value: string | null;
  mono?: boolean;
  multiline?: boolean;
}

function DetailRow({ icon: Icon, label, value, mono, multiline }: DetailRowProps) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </dt>
        <dd
          className={cn(
            'mt-0.5 break-words text-sm text-foreground',
            mono && 'font-mono text-xs',
            multiline && 'whitespace-pre-wrap',
            !value && 'text-muted-foreground',
          )}
        >
          {value ?? 'Não informado'}
        </dd>
      </div>
    </div>
  );
}
