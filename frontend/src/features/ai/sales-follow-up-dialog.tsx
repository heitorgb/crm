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
import { Textarea } from '@/components/ui/textarea';
import type { Member } from '@/types/settings';
import type { SalesRecommendation } from '@/types/ai';

interface SalesFollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recommendation: SalesRecommendation | null;
  members: Member[];
  defaultOwnerId: string | null;
  pending: boolean;
  error: string | null;
  onSubmit: (input: {
    action: string;
    reason?: string;
    dueAt?: string;
    ownerId?: string | null;
    suggestedMessage?: string;
  }) => void;
}

export function SalesFollowUpDialog({
  open,
  onOpenChange,
  recommendation,
  members,
  defaultOwnerId,
  pending,
  error,
  onSubmit,
}: SalesFollowUpDialogProps) {
  const [action, setAction] = useState(recommendation?.action ?? '');
  const [dueAt, setDueAt] = useState(toLocalDateTime(recommendation?.suggestedDueAt));
  const [ownerId, setOwnerId] = useState(defaultOwnerId ?? 'none');
  const [reason, setReason] = useState(recommendation?.reason ?? '');
  const [suggestedMessage, setSuggestedMessage] = useState(
    recommendation?.suggestedMessage ?? '',
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (): void => {
    setValidationError(null);
    if (action.trim().length === 0) {
      setValidationError('Descreva a ação do acompanhamento.');
      return;
    }
    onSubmit({
      action: action.trim(),
      reason: reason.trim() || undefined,
      dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      ownerId: ownerId === 'none' ? null : ownerId,
      suggestedMessage: suggestedMessage.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo acompanhamento</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1">
          <FormField id="follow-up-action" label="Ação" required>
            <Input
              id="follow-up-action"
              value={action}
              onChange={(event) => setAction(event.target.value)}
              placeholder="Ex.: Ligar para confirmar a proposta"
            />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="follow-up-due" label="Data e hora">
              <Input
                id="follow-up-due"
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </FormField>
            <FormField label="Responsável">
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem responsável</SelectItem>
                  {members
                    .filter((member) => member.active)
                    .map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <FormField id="follow-up-reason" label="Motivo">
            <Textarea
              id="follow-up-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="Por que este acompanhamento é necessário?"
            />
          </FormField>
          <FormField id="follow-up-message" label="Mensagem sugerida">
            <Textarea
              id="follow-up-message"
              value={suggestedMessage}
              onChange={(event) => setSuggestedMessage(event.target.value)}
              rows={4}
              placeholder="Mensagem para revisar antes de enviar"
            />
          </FormField>
          {error || validationError ? (
            <p role="alert" className="text-xs font-medium text-danger">
              {validationError ?? error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            {pending ? 'Criando...' : 'Criar acompanhamento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toLocalDateTime(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
