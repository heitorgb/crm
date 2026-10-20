import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { FormField } from '@/components/common/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ContactPicker } from '@/features/contacts/contact-picker';
import { TagPicker } from '@/features/tags/tag-picker';
import { useMembers } from '@/features/settings/queries';
import { ApiError } from '@/lib/api-client';
import type { LeadCard, LeadInput, LeadPipeline } from '@/types/crm';
import { useCreateLead, useUpdateLead } from './queries';

interface LeadFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: LeadPipeline;
  lead?: LeadCard | null;
  initialStageId?: string;
}

export function LeadForm({ open, onOpenChange, pipeline, lead, initialStageId }: LeadFormProps) {
  const members = useMembers();
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();
  const [contactId, setContactId] = useState(lead?.contactId ?? '');
  const [stageId, setStageId] = useState(lead?.stageId ?? initialStageId ?? pipeline.stages[0]?.id ?? '');
  const [ownerId, setOwnerId] = useState(lead?.ownerId ?? 'none');
  const [title, setTitle] = useState(lead?.title ?? '');
  const [source, setSource] = useState(lead?.source ?? '');
  const [value, setValue] = useState(lead ? (lead.valueCents / 100).toFixed(2) : '');
  const [notes, setNotes] = useState(lead?.notes ?? '');
  const [nextFollowUpAt, setNextFollowUpAt] = useState(toLocalDateTime(lead?.nextFollowUpAt));
  const [tagIds, setTagIds] = useState(lead?.tags.map((tag) => tag.id) ?? []);
  const [error, setError] = useState<string | null>(null);
  const pending = createLead.isPending || updateLead.isPending;

  const submit = async (): Promise<void> => {
    setError(null);
    if (!contactId || !stageId || !title.trim()) {
      setError('Informe contato, título e etapa.');
      return;
    }
    const parsedValue = Number(value.replace(',', '.'));
    if (value && (!Number.isFinite(parsedValue) || parsedValue < 0)) {
      setError('Informe um valor válido.');
      return;
    }
    const input: LeadInput = {
      pipelineId: pipeline.id,
      stageId,
      contactId,
      ownerId: ownerId === 'none' ? null : ownerId,
      title: title.trim(),
      source: source.trim() || null,
      valueCents: value ? Math.round(parsedValue * 100) : 0,
      notes: notes.trim() || null,
      nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt).toISOString() : null,
      tagIds,
    };
    try {
      if (lead) {
        const { pipelineId: _pipelineId, ...update } = input;
        await updateLead.mutateAsync({ id: lead.id, input: update });
      } else {
        await createLead.mutateAsync(input);
      }
      onOpenChange(false);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Não foi possível salvar o lead.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lead ? 'Editar lead' : 'Novo lead'}</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
          <FormField label="Contato" required>
            <ContactPicker
              value={contactId}
              onValueChange={setContactId}
              selectedContact={lead?.contact}
              placeholder="Selecione um contato"
            />
          </FormField>
          <FormField label="Etapa" required>
            <Select value={stageId} onValueChange={setStageId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {pipeline.stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="lead-title" label="Oportunidade" required className="sm:col-span-2">
            <Input id="lead-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Plano mensal, projeto de implantação" />
          </FormField>
          <FormField label="Responsável">
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem responsável</SelectItem>
                {members.data?.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="lead-source" label="Origem">
            <Input id="lead-source" value={source} onChange={(event) => setSource(event.target.value)} placeholder="WhatsApp, indicação, site..." />
          </FormField>
          <FormField label="Etiquetas" className="sm:col-span-2">
            <TagPicker value={tagIds} onValueChange={setTagIds} disabled={pending} />
          </FormField>
          <FormField id="lead-value" label="Valor estimado (R$)">
            <Input id="lead-value" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder="0,00" />
          </FormField>
          <FormField id="lead-follow-up" label="Próximo follow-up">
            <Input id="lead-follow-up" type="datetime-local" value={nextFollowUpAt} onChange={(event) => setNextFollowUpAt(event.target.value)} />
          </FormField>
          <FormField id="lead-notes" label="Observações" className="sm:col-span-2">
            <Textarea id="lead-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} />
          </FormField>
          {error ? <p className="text-sm font-medium text-danger sm:col-span-2">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
          <Button onClick={() => void submit()} disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : null}Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toLocalDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
