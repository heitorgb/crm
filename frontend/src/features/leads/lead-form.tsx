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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useCustomers } from '@/features/customers/queries';
import { useTags } from '@/features/tags/queries';
import type { Lead, LeadStatus } from '@/types/sales';
import { LEAD_STATUS_OPTIONS, useCreateLead, useUpdateLead } from './queries';

interface LeadFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead?: Lead | null;
}

const NONE = '__none__';

export function LeadForm({ open, onOpenChange, lead }: LeadFormProps) {
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();
  const customersQuery = useCustomers({ perPage: 100, sort: 'name', order: 'asc' });
  const tagsQuery = useTags({ perPage: 100, sort: 'name', order: 'asc' });

  const [name, setName] = useState(lead?.name ?? '');
  const [phone, setPhone] = useState(lead?.phone ?? '');
  const [email, setEmail] = useState(lead?.email ?? '');
  const [source, setSource] = useState(lead?.source ?? '');
  const [status, setStatus] = useState<LeadStatus>(lead?.status ?? 'NEW');
  const [customerId, setCustomerId] = useState(lead?.customerId ?? NONE);
  const [tagIds, setTagIds] = useState<string[]>(lead?.tags.map((tag) => tag.id) ?? []);
  const [error, setError] = useState<string | null>(null);

  const pending = createLead.isPending || updateLead.isPending;

  const toggleTag = (tagId: string): void => {
    setTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    );
  };

  const handleSubmit = async (): Promise<void> => {
    setError(null);
    if (name.trim().length === 0 && phone.trim().length === 0) {
      setError('Informe ao menos nome ou telefone.');
      return;
    }

    const payload = {
      name: name.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      source: source.trim() || null,
      status,
      customerId: customerId === NONE ? null : customerId,
      tagIds,
    };

    try {
      if (lead) {
        await updateLead.mutateAsync({ id: lead.id, input: payload });
      } else {
        await createLead.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'Não foi possível salvar o lead.',
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{lead ? 'Editar lead' : 'Novo lead'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="lead-name" label="Nome">
              <Input id="lead-name" value={name} onChange={(event) => setName(event.target.value)} />
            </FormField>
            <FormField id="lead-phone" label="Telefone">
              <Input id="lead-phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="lead-email" label="E-mail">
              <Input
                id="lead-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormField>
            <FormField id="lead-source" label="Origem">
              <Input
                id="lead-source"
                value={source}
                onChange={(event) => setSource(event.target.value)}
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="lead-status" label="Status">
              <Select value={status} onValueChange={(value) => setStatus(value as LeadStatus)}>
                <SelectTrigger id="lead-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField id="lead-customer" label="Cliente">
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger id="lead-customer">
                  <SelectValue placeholder="Sem cliente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem cliente</SelectItem>
                  {customersQuery.data?.data.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>

          <FormField id="lead-tags" label="Tags">
            {tagsQuery.data && tagsQuery.data.data.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {tagsQuery.data.data.map((tag) => {
                  const selected = tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      aria-pressed={selected}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs',
                        selected
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border bg-surface text-muted-foreground',
                      )}
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: tag.color ?? 'currentColor' }}
                        aria-hidden
                      />
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhuma tag cadastrada.</p>
            )}
          </FormField>

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
