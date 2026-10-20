import { useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ApiError } from '@/lib/api-client';
import type { LeadPipeline, LeadStage, LeadStageKind } from '@/types/crm';
import { useCreateLeadStage, useDeleteLeadStage, useUpdateLeadStage } from './queries';

interface PipelineSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: LeadPipeline;
}

export function PipelineSettingsDialog({ open, onOpenChange, pipeline }: PipelineSettingsDialogProps) {
  const createStage = useCreateLeadStage();
  const updateStage = useUpdateLeadStage();
  const deleteStage = useDeleteLeadStage();
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addStage = async () => {
    if (!newName.trim()) return;
    setError(null);
    try {
      await createStage.mutateAsync({ pipelineId: pipeline.id, input: { name: newName.trim(), color: '#64748b', kind: 'OPEN' } });
      setNewName('');
    } catch (requestError) {
      setError(messageOf(requestError));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Etapas de {pipeline.name}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Etapas abertas mantêm o lead em andamento. Etapas ganhas ou perdidas encerram a oportunidade automaticamente.</p>
        <div className="scrollbar-thin max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {pipeline.stages.map((stage) => (
            <StageRow
              key={`${stage.id}-${stage.name}-${stage.color}-${stage.kind}`}
              pipelineId={pipeline.id}
              stage={stage}
              onError={setError}
              onSave={updateStage.mutateAsync}
              onDelete={deleteStage.mutateAsync}
            />
          ))}
        </div>
        <div className="flex gap-2 border-t border-border pt-3">
          <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Nome da nova etapa" onKeyDown={(event) => { if (event.key === 'Enter') void addStage(); }} />
          <Button onClick={() => void addStage()} disabled={!newName.trim() || createStage.isPending}>{createStage.isPending ? <Loader2 className="animate-spin" /> : <Plus />}Adicionar</Button>
        </div>
        {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}

function StageRow({ pipelineId, stage, onError, onSave, onDelete }: {
  pipelineId: string;
  stage: LeadStage;
  onError: (message: string | null) => void;
  onSave: (variables: { pipelineId: string; stageId: string; input: { name?: string; color?: string; kind?: string } }) => Promise<unknown>;
  onDelete: (variables: { pipelineId: string; stageId: string }) => Promise<unknown>;
}) {
  const [name, setName] = useState(stage.name);
  const [color, setColor] = useState(stage.color ?? '#64748b');
  const [kind, setKind] = useState<LeadStageKind>(stage.kind);
  const [pending, setPending] = useState(false);

  const save = async () => {
    setPending(true);
    onError(null);
    try {
      await onSave({ pipelineId, stageId: stage.id, input: { name: name.trim(), color, kind } });
    } catch (error) {
      onError(messageOf(error));
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    setPending(true);
    onError(null);
    try {
      await onDelete({ pipelineId, stageId: stage.id });
    } catch (error) {
      onError(messageOf(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[2rem_1fr_9rem_auto] sm:items-center">
      <Input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-9 w-10 p-1" aria-label="Cor da etapa" />
      <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="Nome da etapa" />
      <Select value={kind} onValueChange={(value) => setKind(value as LeadStageKind)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="OPEN">Em andamento</SelectItem><SelectItem value="WON">Ganha</SelectItem><SelectItem value="LOST">Perdida</SelectItem></SelectContent>
      </Select>
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="icon" onClick={() => void save()} disabled={pending || !name.trim()} aria-label="Salvar etapa">{pending ? <Loader2 className="animate-spin" /> : <Save />}</Button>
        <Button variant="ghost" size="icon" className="text-danger" onClick={() => void remove()} disabled={pending} aria-label="Excluir etapa"><Trash2 /></Button>
      </div>
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Não foi possível atualizar o pipeline.';
}
