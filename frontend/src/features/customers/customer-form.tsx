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
import type { Customer, CustomerDetail, CustomerStatus } from '@/types/crm';
import { useCreateCustomer, useUpdateCustomer } from './queries';
import { useTags } from '@/features/tags/queries';

interface CustomerFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: Customer | CustomerDetail | null;
}

const statusOptions: { value: CustomerStatus; label: string }[] = [
  { value: 'ACTIVE', label: 'Ativo' },
  { value: 'INACTIVE', label: 'Inativo' },
  { value: 'ARCHIVED', label: 'Arquivado' },
];

export function CustomerForm({ open, onOpenChange, customer }: CustomerFormProps) {
  const isEditing = Boolean(customer);
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const tagsQuery = useTags({ perPage: 100, sort: 'name', order: 'asc' });

  const [name, setName] = useState(customer?.name ?? '');
  const [document, setDocument] = useState(customer?.document ?? '');
  const [status, setStatus] = useState<CustomerStatus>(customer?.status ?? 'ACTIVE');
  const [tagIds, setTagIds] = useState<string[]>(customer?.tags.map((tag) => tag.id) ?? []);
  const [error, setError] = useState<string | null>(null);

  const pending = createCustomer.isPending || updateCustomer.isPending;

  const toggleTag = (tagId: string): void => {
    setTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    );
  };

  const handleSubmit = async (): Promise<void> => {
    setError(null);

    if (name.trim().length === 0) {
      setError('Informe o nome do cliente.');
      return;
    }

    const payload = {
      name: name.trim(),
      document: document.trim().length > 0 ? document.trim() : null,
      status,
      tagIds,
    };

    try {
      if (customer) {
        await updateCustomer.mutateAsync({ id: customer.id, input: payload });
      } else {
        await createCustomer.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'Não foi possível salvar o cliente.',
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar cliente' : 'Novo cliente'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <FormField id="customer-name" label="Nome" required>
            <Input
              id="customer-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nome do cliente"
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="customer-document" label="Documento" description="CPF ou CNPJ (opcional).">
              <Input
                id="customer-document"
                value={document}
                onChange={(event) => setDocument(event.target.value)}
                placeholder="Somente números"
              />
            </FormField>

            <FormField id="customer-status" label="Status">
              <Select value={status} onValueChange={(value) => setStatus(value as CustomerStatus)}>
                <SelectTrigger id="customer-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>

          <FormField id="customer-tags" label="Tags">
            {tagsQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Carregando tags…</p>
            ) : tagsQuery.data && tagsQuery.data.data.length > 0 ? (
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
                        'inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs transition-colors',
                        selected
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border bg-surface text-muted-foreground hover:text-foreground',
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
              <p className="text-xs text-muted-foreground">Nenhuma tag cadastrada ainda.</p>
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
