import { useState } from 'react';
import { ArrowDown, ArrowUp, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { FormField } from '@/components/common/form-field';
import { PageHeader } from '@/components/common/page-header';
import { PageLoader } from '@/components/common/page-loader';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api-client';
import type { Pipeline, PipelineStage } from '@/types/sales';
import {
  useCreatePipeline,
  useCreatePipelineStage,
  useDeletePipeline,
  useDeletePipelineStage,
  usePipelines,
  usePipeline,
  useUpdatePipeline,
  useUpdatePipelineStage,
} from './queries';

export function PipelineSettingsPage() {
  const query = usePipelines({ perPage: 100, sort: 'createdAt', order: 'asc' });
  const createPipeline = useCreatePipeline();
  const updatePipeline = useUpdatePipeline();
  const deletePipeline = useDeletePipeline();
  const createStage = useCreatePipelineStage();
  const updateStage = useUpdatePipelineStage();
  const deleteStage = useDeletePipelineStage();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pipelineFormOpen, setPipelineFormOpen] = useState(false);
  const [pipelineNonce, setPipelineNonce] = useState(0);
  const [editingPipeline, setEditingPipeline] = useState<Pipeline | null>(null);
  const [pipelineName, setPipelineName] = useState('');
  const [pipelineActive, setPipelineActive] = useState(true);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  const [stageName, setStageName] = useState('');
  const [stageError, setStageError] = useState<string | null>(null);
  const [pendingDeletePipeline, setPendingDeletePipeline] = useState<Pipeline | null>(null);
  const [pendingDeleteStage, setPendingDeleteStage] = useState<PipelineStage | null>(null);

  const pipelines = query.data?.data ?? [];
  const detailQuery = usePipeline(selectedId ?? undefined);
  const selected = pipelines.find((pipeline) => pipeline.id === selectedId) ?? null;
  const stages = detailQuery.data?.stages ?? [];

  function openCreatePipeline(): void {
    setEditingPipeline(null);
    setPipelineName('');
    setPipelineActive(true);
    setPipelineError(null);
    setPipelineNonce((value) => value + 1);
    setPipelineFormOpen(true);
  }

  function openEditPipeline(pipeline: Pipeline): void {
    setEditingPipeline(pipeline);
    setPipelineName(pipeline.name);
    setPipelineActive(pipeline.active);
    setPipelineError(null);
    setPipelineNonce((value) => value + 1);
    setPipelineFormOpen(true);
  }

  async function savePipeline(): Promise<void> {
    setPipelineError(null);
    if (pipelineName.trim().length === 0) {
      setPipelineError('Informe o nome do pipeline.');
      return;
    }
    try {
      if (editingPipeline) {
        await updatePipeline.mutateAsync({
          id: editingPipeline.id,
          input: { name: pipelineName.trim(), active: pipelineActive },
        });
      } else {
        const created = await createPipeline.mutateAsync({
          name: pipelineName.trim(),
          active: pipelineActive,
        });
        setSelectedId(created.id);
      }
      setPipelineFormOpen(false);
    } catch (error) {
      setPipelineError(
        error instanceof ApiError ? error.message : 'Não foi possível salvar o pipeline.',
      );
    }
  }

  async function addStage(): Promise<void> {
    if (!selected) {
      return;
    }
    setStageError(null);
    if (stageName.trim().length === 0) {
      setStageError('Informe o nome da etapa.');
      return;
    }
    try {
      await createStage.mutateAsync({
        pipelineId: selected.id,
        input: { name: stageName.trim() },
      });
      setStageName('');
    } catch (error) {
      setStageError(error instanceof ApiError ? error.message : 'Não foi possível criar a etapa.');
    }
  }

  async function changePosition(stage: PipelineStage, direction: -1 | 1): Promise<void> {
    if (!selected) {
      return;
    }
    const target = stage.position + direction;
    try {
      await updateStage.mutateAsync({
        pipelineId: selected.id,
        stageId: stage.id,
        input: { position: target },
      });
    } catch {
      setStageError('Não foi possível reordenar as etapas.');
    }
  }

  if (query.isPending) {
    return <PageLoader label="Carregando pipelines…" />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pipelines"
        description="Configure os funis de venda e suas etapas ordenadas."
        actions={
          <Button onClick={openCreatePipeline}>
            <Plus />
            Novo pipeline
          </Button>
        }
      />

      {pipelines.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="Nenhum pipeline configurado"
          description="Crie um pipeline com etapas para usar o quadro Kanban de negócios."
          action={
            <Button onClick={openCreatePipeline}>
              <Plus />
              Criar pipeline
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Funis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {pipelines.map((pipeline) => (
                <button
                  key={pipeline.id}
                  type="button"
                  onClick={() => setSelectedId(pipeline.id)}
                  className={
                    pipeline.id === selectedId
                      ? 'w-full rounded-md border border-primary/40 bg-primary/5 p-3 text-left'
                      : 'w-full rounded-md border border-border p-3 text-left hover:bg-surface-hover'
                  }
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{pipeline.name}</span>
                    <StatusBadge tone={pipeline.active ? 'success' : 'secondary'}>
                      {pipeline.active ? 'Ativo' : 'Inativo'}
                    </StatusBadge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {pipeline.stageCount} etapa(s)
                  </span>
                  <div className="mt-2 flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditPipeline(pipeline);
                      }}
                    >
                      <Pencil />
                      Editar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      onClick={(event) => {
                        event.stopPropagation();
                        setPendingDeletePipeline(pipeline);
                      }}
                    >
                      <Trash2 />
                      Excluir
                    </Button>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{selected ? `Etapas de ${selected.name}` : 'Etapas'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selected ? (
                <p className="text-sm text-muted-foreground">Selecione um pipeline para editar as etapas.</p>
              ) : (
                <>
                  {stages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma etapa cadastrada.</p>
                  ) : (
                    stages.map((stage: PipelineStage) => (
                      <div
                        key={stage.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border p-3"
                      >
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {stage.position + 1}. {stage.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {stage.dealCount} negócio(s)
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => void changePosition(stage, -1)}
                            disabled={stage.position === 0}
                            aria-label="Mover para cima"
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => void changePosition(stage, 1)}
                            aria-label="Mover para baixo"
                          >
                            <ArrowDown />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-danger"
                            onClick={() => setPendingDeleteStage(stage)}
                            aria-label="Excluir etapa"
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}

                  <div className="flex gap-2 pt-2">
                    <Input
                      value={stageName}
                      onChange={(event) => setStageName(event.target.value)}
                      placeholder="Nome da nova etapa"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void addStage();
                        }
                      }}
                    />
                    <Button variant="outline" onClick={() => void addStage()}>
                      <Plus />
                      Adicionar
                    </Button>
                  </div>
                  {stageError ? <p className="text-xs font-medium text-danger">{stageError}</p> : null}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={pipelineFormOpen} onOpenChange={setPipelineFormOpen}>
        <DialogContent className="max-w-md" key={pipelineNonce}>
          <DialogHeader>
            <DialogTitle>{editingPipeline ? 'Editar pipeline' : 'Novo pipeline'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <FormField id="pipeline-name" label="Nome" required>
              <Input
                id="pipeline-name"
                value={pipelineName}
                onChange={(event) => setPipelineName(event.target.value)}
              />
            </FormField>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <span className="text-sm">Pipeline ativo</span>
              <Switch checked={pipelineActive} onCheckedChange={setPipelineActive} />
            </div>
            {pipelineError ? <p className="text-xs font-medium text-danger">{pipelineError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPipelineFormOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void savePipeline()} disabled={createPipeline.isPending || updatePipeline.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(pendingDeletePipeline)}
        onOpenChange={(open) => {
          if (!open) setPendingDeletePipeline(null);
        }}
        title="Excluir pipeline"
        description="Pipelines com negócios vinculados não podem ser removidos."
        confirmLabel="Excluir"
        destructive
        loading={deletePipeline.isPending}
        onConfirm={() => {
          if (!pendingDeletePipeline) return;
          void deletePipeline.mutateAsync(pendingDeletePipeline.id).then(() => {
            setPendingDeletePipeline(null);
            if (selectedId === pendingDeletePipeline.id) setSelectedId(null);
          }).catch(() => setPendingDeletePipeline(null));
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDeleteStage)}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteStage(null);
        }}
        title="Excluir etapa"
        description="Etapas com negócios vinculados não podem ser removidas."
        confirmLabel="Excluir"
        destructive
        loading={deleteStage.isPending}
        onConfirm={() => {
          if (!pendingDeleteStage || !selected) return;
          void deleteStage
            .mutateAsync({ pipelineId: selected.id, stageId: pendingDeleteStage.id })
            .then(() => setPendingDeleteStage(null))
            .catch(() => setPendingDeleteStage(null));
        }}
      />
    </div>
  );
}
