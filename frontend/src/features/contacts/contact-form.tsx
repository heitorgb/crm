import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { FormField } from '@/components/common/form-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api-client';
import type { Contact, ContactInput } from '@/types/crm';
import { useCreateContact, useUpdateContact } from './queries';

interface EditableContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  isPrimary: boolean;
  customerId?: string | null;
}

interface ContactFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: EditableContact | Contact | null;
  customerId?: string;
}

export function ContactForm({ open, onOpenChange, contact, customerId }: ContactFormProps) {
  const isEditing = Boolean(contact);
  const fixedCustomerId = customerId ?? contact?.customerId ?? undefined;
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();

  const [name, setName] = useState(contact?.name ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [position, setPosition] = useState(contact?.position ?? '');
  const [isPrimary, setIsPrimary] = useState(contact?.isPrimary ?? false);
  const [error, setError] = useState<string | null>(null);

  const pending = createContact.isPending || updateContact.isPending;

  const handleSubmit = async (): Promise<void> => {
    setError(null);

    if (name.trim().length === 0) {
      setError('Informe o nome do contato.');
      return;
    }
    if (phone.trim().length === 0) {
      setError('Informe o telefone do contato.');
      return;
    }

    const payload: ContactInput = {
      name: name.trim(),
      email: email.trim().length > 0 ? email.trim() : null,
      phone: phone.trim(),
      position: position.trim().length > 0 ? position.trim() : null,
      isPrimary,
      ...(fixedCustomerId ? { customerId: fixedCustomerId } : {}),
    };

    try {
      if (contact) {
        await updateContact.mutateAsync({ id: contact.id, input: payload });
      } else {
        await createContact.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'Não foi possível salvar o contato.',
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar contato' : 'Novo contato'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <FormField id="contact-name" label="Nome" required>
            <Input id="contact-name" value={name} onChange={(event) => setName(event.target.value)} />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="contact-phone" label="Telefone" required>
              <Input
                id="contact-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+55 11 99999-0000"
              />
            </FormField>
            <FormField id="contact-email" label="E-mail">
              <Input
                id="contact-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormField>
          </div>

          <FormField id="contact-position" label="Cargo / observação">
            <Input
              id="contact-position"
              value={position}
              onChange={(event) => setPosition(event.target.value)}
            />
          </FormField>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <Label htmlFor="contact-primary" className="text-sm">
              Contato principal
            </Label>
            <Switch id="contact-primary" checked={isPrimary} onCheckedChange={setIsPrimary} />
          </div>

          {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
