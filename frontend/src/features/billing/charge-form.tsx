import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { DatePicker } from '@/components/common/date-picker';
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
import { Switch } from '@/components/ui/switch';
import { ContactPicker } from '@/features/contacts/contact-picker';
import type { BillingCharge } from '@/types/billing';
import {
  centsToInput,
  formatCurrency,
  parseCurrencyToCents,
  resolveBillingError,
} from './billing-utils';
import { useCreateCharge, useUpdateCharge } from './queries';

interface ChargeFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  charge?: BillingCharge | null;
}

export function ChargeForm({ open, onOpenChange, charge }: ChargeFormProps) {
  const isEditing = Boolean(charge);
  const createCharge = useCreateCharge();
  const updateCharge = useUpdateCharge();

  const [contactId, setContactId] = useState(charge?.contactId ?? '');
  const [description, setDescription] = useState(charge?.description ?? '');
  const [amount, setAmount] = useState(charge ? centsToInput(charge.amountCents) : '');
  const [dueDate, setDueDate] = useState<Date | undefined>(
    charge ? new Date(`${charge.dueDate}T00:00:00`) : undefined,
  );
  const [repeatMonthly, setRepeatMonthly] = useState(false);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const pending = createCharge.isPending || updateCharge.isPending;
  const canRepeat = !isEditing;
  const legacyPartyName = charge?.contactName ?? charge?.customerName ?? null;
  const needsContact = !isEditing || (!charge?.contactId && !charge?.customerId);

  const handleSubmit = async (): Promise<void> => {
    setError(null);

    if (needsContact && !contactId) {
      setError('Selecione um cliente.');
      return;
    }
    if (description.trim().length === 0) {
      setError('Informe a descrição da cobrança.');
      return;
    }
    const amountCents = parseCurrencyToCents(amount);
    if (!amountCents || amountCents < 1) {
      setError('Informe um valor válido maior que zero.');
      return;
    }
    if (!dueDate) {
      setError('Informe a data de vencimento.');
      return;
    }
    if (repeatMonthly && endDate && endDate.getTime() < dueDate.getTime()) {
      setError('A data final não pode ser anterior ao vencimento.');
      return;
    }

    const payload = {
      ...(contactId ? { contactId } : {}),
      description: description.trim(),
      amountCents,
      dueDate: toDateOnly(dueDate),
    };

    try {
      if (charge) {
        await updateCharge.mutateAsync({ id: charge.id, input: payload });
      } else {
        await createCharge.mutateAsync({
          ...payload,
          ...(repeatMonthly
            ? {
                recurrence: {
                  frequency: 'MONTHLY' as const,
                  ...(endDate ? { endDate: toDateOnly(endDate) } : {}),
                },
              }
            : {}),
        });
      }
      onOpenChange(false);
    } catch (requestError) {
      setError(resolveBillingError(requestError, 'Não foi possível salvar a cobrança.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar cobrança' : 'Nova cobrança'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <FormField
            id="charge-contact"
            label="Cliente"
            required={needsContact}
            description="Selecione um contato cadastrado. Nenhum cliente é criado automaticamente."
          >
            <ContactPicker
              id="charge-contact"
              value={contactId}
              onValueChange={setContactId}
              selectedContact={
                charge?.contactId && charge.contactName
                  ? { id: charge.contactId, name: charge.contactName, phone: charge.contactPhone }
                  : null
              }
              placeholder="Selecione um cliente"
              searchPlaceholder="Buscar cliente por nome ou telefone"
            />
          </FormField>

          {isEditing && !charge?.contactId && legacyPartyName ? (
            <p className="text-xs text-muted-foreground">
              Cobrança vinculada a {legacyPartyName}. Selecione um contato apenas para trocar o
              cliente.
            </p>
          ) : null}

          <FormField id="charge-description" label="Descrição" required>
            <Input
              id="charge-description"
              value={description}
              maxLength={200}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="charge-amount" label="Valor (R$)" required>
              <Input
                id="charge-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0,00"
              />
            </FormField>
            <FormField id="charge-due" label="Vencimento" required>
              <DatePicker id="charge-due" value={dueDate} onChange={setDueDate} />
            </FormField>
          </div>

          {amountCentsPreview(amount) ? (
            <p className="text-xs text-muted-foreground">
              Valor: {amountCentsPreview(amount)}
            </p>
          ) : null}

          {canRepeat ? (
            <>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Repetir mensalmente</p>
                  <p className="text-xs text-muted-foreground">
                    Gera automaticamente uma cobrança por mês, sem duplicar vencimentos.
                  </p>
                </div>
                <Switch checked={repeatMonthly} onCheckedChange={setRepeatMonthly} />
              </div>

              {repeatMonthly ? (
                <FormField id="charge-end" label="Repetir até (opcional)">
                  <DatePicker id="charge-end" value={endDate} onChange={setEndDate} />
                </FormField>
              ) : null}
            </>
          ) : null}

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

function toDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function amountCentsPreview(amount: string): string | null {
  const cents = parseCurrencyToCents(amount);
  if (!cents || cents < 1) {
    return null;
  }
  return formatCurrency(cents);
}
