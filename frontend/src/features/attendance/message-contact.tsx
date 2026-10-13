import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, MessageSquare, UserRound } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { useResolveContact } from '@/features/contacts/queries';
import type { ContactEntry } from '@/types/attendance';
import { useStartConversation } from './queries';

interface MessageContactProps {
  contacts: ContactEntry[];
  whatsappInstanceId: string;
}

export function MessageContact({ contacts, whatsappInstanceId }: MessageContactProps) {
  return (
    <div className="flex flex-col gap-2">
      {contacts.map((contact, index) => (
        <ContactCard
          key={`${contact.phone ?? contact.name ?? 'contact'}-${index}`}
          contact={contact}
          whatsappInstanceId={whatsappInstanceId}
        />
      ))}
    </div>
  );
}

function ContactCard({
  contact,
  whatsappInstanceId,
}: {
  contact: ContactEntry;
  whatsappInstanceId: string;
}) {
  const navigate = useNavigate();
  const resolveContact = useResolveContact();
  const startConversation = useStartConversation();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = resolveContact.isPending || startConversation.isPending;

  const ensureContact = () => {
    if (!contact.phone) {
      throw new Error('missing-phone');
    }
    return resolveContact.mutateAsync({
      phone: contact.phone,
      name: contact.name ?? undefined,
    });
  };

  const handleSave = async (): Promise<void> => {
    setError(null);
    try {
      await ensureContact();
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível salvar o contato.');
    }
  };

  const handleChat = async (): Promise<void> => {
    setError(null);
    try {
      const record = await ensureContact();
      const conversation = await startConversation.mutateAsync({
        contactId: record.id,
        whatsappInstanceId,
      });
      navigate(`/atendimento/conversas?conversation=${conversation.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Não foi possível iniciar a conversa.',
      );
    }
  };

  const canAct = Boolean(contact.phone);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface text-left">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <UserRound className="size-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">
            {contact.name ?? contact.phone ?? 'Contato'}
          </span>
          {contact.phone ? (
            <span className="block truncate text-xs text-muted-foreground">{contact.phone}</span>
          ) : null}
        </span>
      </div>

      {canAct ? (
        <div className="flex border-t border-border text-sm font-medium">
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-1.5 py-2 text-primary transition-colors hover:bg-surface-hover disabled:opacity-60"
            onClick={() => void handleChat()}
            disabled={busy}
          >
            {startConversation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MessageSquare className="size-4" />
            )}
            Conversar
          </button>
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-1.5 border-l border-border py-2 text-primary transition-colors hover:bg-surface-hover disabled:opacity-60"
            onClick={() => void handleSave()}
            disabled={busy || saved}
          >
            {saved ? <Check className="size-4" /> : <UserRound className="size-4" />}
            {saved ? 'Contato salvo' : 'Salvar contato'}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="border-t border-border px-3 py-1.5 text-xs font-medium text-danger">{error}</p>
      ) : null}
    </div>
  );
}
