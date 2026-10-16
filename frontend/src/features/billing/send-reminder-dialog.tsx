import { useState } from 'react';
import { AlertTriangle, BadgeCheck, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { BillingCharge, BillingReminder } from '@/types/billing';
import { formatCurrency, reminderOutcomeMessage, resolveBillingError } from './billing-utils';
import { useSendManualReminder } from './queries';

interface SendReminderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  charge: BillingCharge | null;
}

function newIdempotencyKey(): string {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function SendReminderDialog({ open, onOpenChange, charge }: SendReminderDialogProps) {
  const send = useSendManualReminder();
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [result, setResult] = useState<BillingReminder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async (): Promise<void> => {
    if (!charge) {
      return;
    }
    setError(null);
    try {
      const reminder = await send.mutateAsync({ chargeId: charge.id, idempotencyKey });
      setResult(reminder);
    } catch (requestError) {
      setError(resolveBillingError(requestError, 'Não foi possível enviar o lembrete.'));
    }
  };

  const outcome = result ? reminderOutcomeMessage(result) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar lembrete</DialogTitle>
        </DialogHeader>

        {charge ? (
          <div className="grid gap-4">
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium text-foreground">{charge.contactName ?? charge.customerName ?? '—'}</p>
              <p className="text-muted-foreground">{charge.description}</p>
              <p className="mt-1 font-semibold">{formatCurrency(charge.amountCents)}</p>
            </div>

            {outcome ? (
              <div
                className={
                  outcome.tone === 'success'
                    ? 'flex gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-sm'
                    : outcome.tone === 'warning'
                      ? 'flex gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm'
                      : 'flex gap-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm'
                }
              >
                {outcome.tone === 'success' ? (
                  <BadgeCheck className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <AlertTriangle
                    className={
                      outcome.tone === 'warning'
                        ? 'mt-0.5 size-4 shrink-0 text-warning'
                        : 'mt-0.5 size-4 shrink-0 text-danger'
                    }
                  />
                )}
                <div className="space-y-0.5">
                  <p className="font-medium">{outcome.title}</p>
                  <p className="text-muted-foreground">{outcome.description}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                O lembrete será enviado imediatamente pelo WhatsApp ao cliente, ignorando os dias e
                horários da automação.
              </p>
            )}

            {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
          </div>
        ) : null}

        <DialogFooter>
          {outcome || error ? (
            <Button onClick={() => onOpenChange(false)}>Fechar</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={send.isPending}>
                Cancelar
              </Button>
              <Button onClick={() => void handleSend()} disabled={send.isPending || !charge}>
                {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
                Enviar lembrete
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
