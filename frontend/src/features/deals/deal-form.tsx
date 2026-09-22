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
import { useCustomers } from '@/features/customers/queries';
import { useLeads } from '@/features/leads/queries';
import { useMembers } from '@/features/members/queries';
import type { Deal, DealStatus } from '@/types/sales';
import { useCreateDeal, useUpdateDeal } from './queries';

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stageId?: string;
}

const statusOptions: { value: DealStatus; label: string }[] = [
  { value: 'OPEN', label: 'Aberto' },
  { value: 'WON', label: 'Ganho' },
  { value: 'LOST', label: 'Perdido' },
];

const NONE = '__none__';

export function DealForm({ open, onOpenChange, deal, pipelineId, stageId }: DealFormProps) {
  const createDeal = useCreateDeal();
  const updateDeal = useUpdateDeal();
  const customersQuery = useCustomers({ perPage: 100, sort: 'name', order: 'asc' });
  const leadsQuery = useLeads({ perPage: 100, sort: 'createdAt', order: 'desc' });
  const membersQuery = useMembers();

  const [title, setTitle] = useState(deal?.title ?? '');
  const [value, setValue] = useState(deal ? String(Number(deal.value)) : '');
  const [status, setStatus] = useState<DealStatus>(deal?.status ?? 'OPEN');
  const [ownerId, setOwnerId] = useState(deal?.ownerId ?? NONE);
  const [customerId, setCustomerId] = useState(deal?.customerId ?? NONE);
  const [leadId, setLeadId] = useState(deal?.leadId ?? NONE);
  const [expectedCloseAt, setExpectedCloseAt] = useState(
    deal?.expectedCloseAt ? deal.expectedCloseAt.slice(0, 10) : '',
  );
  const [error, setError] = useState<string | null>(null);

  const pending = createDeal.isPending || updateDeal.isPending;

  const handleSubmit = async (): Promise<void> => {
    setError(null);
    if (title.trim().length === 0) {
      setError('Informe o título do negócio.');
      return;
    }

    const payload = {
      title: title.trim(),
      pipelineId,
      status,
      value: value.trim().length > 0 ? Number(value) : 0,
      ownerId: ownerId === NONE ? null : ownerId,
      customerId: customerId === NONE ? null : customerId,
      leadId: leadId === NONE ? null : leadId,
      expectedCloseAt: expectedCloseAt ? new Date(expectedCloseAt).toISOString() : null,
    };

    try {
      if (deal) {
        await updateDeal.mutateAsync({ id: deal.id, input: payload });
      } else {
        await createDeal.mutateAsync({ ...payload, stageId });
      }
      onOpenChange(false);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'Não foi possível salvar o negócio.',
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{deal ? 'Editar negócio' : 'Novo negócio'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <FormField id="deal-title" label="Título" required>
            <Input id="deal-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="deal-value" label="Valor (R$)">
              <Input
                id="deal-value"
                type="number"
                min={0}
                step="0.01"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </FormField>
            <FormField id="deal-status" label="Status">
              <Select value={status} onValueChange={(item) => setStatus(item as DealStatus)}>
                <SelectTrigger id="deal-status">
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

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="deal-owner" label="Responsável">
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger id="deal-owner">
                  <SelectValue placeholder="Sem responsável" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem responsável</SelectItem>
                  {membersQuery.data?.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField id="deal-expected" label="Previsão de fechamento">
              <Input
                id="deal-expected"
                type="date"
                value={expectedCloseAt}
                onChange={(event) => setExpectedCloseAt(event.target.value)}
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="deal-customer" label="Cliente">
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger id="deal-customer">
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
            <FormField id="deal-lead" label="Lead">
              <Select value={leadId} onValueChange={setLeadId}>
                <SelectTrigger id="deal-lead">
                  <SelectValue placeholder="Sem lead" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem lead</SelectItem>
                  {leadsQuery.data?.data.map((lead) => (
                    <SelectItem key={lead.id} value={lead.id}>
                      {lead.name ?? lead.phone ?? 'Lead'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
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
