import { useState, type DragEvent } from 'react';
import { Briefcase, Loader2, Plus } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { PageLoader } from '@/components/common/page-loader';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { usePipelines } from '@/features/pipelines/queries';
import type { Deal } from '@/types/sales';
import { useDealBoard, useMoveDeal, DEAL_STATUS_OPTIONS } from './queries';
import { DealForm } from './deal-form';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const statusTone: Record<string, string> = {
  OPEN: 'text-info',
  WON: 'text-success',
  LOST: 'text-danger',
};

export function KanbanPage() {
  const pipelinesQuery = usePipelines({ perPage: 100, sort: 'createdAt', order: 'asc' });
  const pipelines = pipelinesQuery.data?.data ?? [];

  const [explicitPipelineId, setExplicitPipelineId] = useState<string | undefined>(undefined);
  const selectedPipelineId = explicitPipelineId ?? pipelines[0]?.id;

  const boardQuery = useDealBoard(selectedPipelineId);
  const moveDeal = useMoveDeal();

  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formNonce, setFormNonce] = useState(0);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [createStageId, setCreateStageId] = useState<string | undefined>(undefined);

  const board = boardQuery.data;

  const openCreate = (stageId: string): void => {
    setEditingDeal(null);
    setCreateStageId(stageId);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  const openEdit = (deal: Deal): void => {
    setEditingDeal(deal);
    setCreateStageId(deal.stageId);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, stageId: string): void => {
    event.preventDefault();
    setDragOverStage(null);
    const dealId = event.dataTransfer.getData('text/deal-id');
    if (!dealId || !board) {
      return;
    }
    const deal = board.stages.flatMap((stage) => stage.deals).find((item) => item.id === dealId);
    if (!deal || deal.stageId === stageId) {
      return;
    }
    moveDeal.mutate({ id: deal.id, stageId });
  };

  if (pipelinesQuery.isPending) {
    return <PageLoader label="Carregando funil…" />;
  }

  if (pipelines.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title="Funil" description="Etapas do pipeline comercial." />
        <EmptyState
          icon={Briefcase}
          title="Nenhum pipeline configurado"
          description="Crie um pipeline em Configurações → Pipelines para começar a usar o quadro."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Funil"
        description="Arraste os negócios entre as etapas. Toda movimentação é salva no servidor."
        actions={
          <>
            <Select
              value={selectedPipelineId}
              onValueChange={(value) => setExplicitPipelineId(value)}
            >
              <SelectTrigger className="w-56" aria-label="Selecionar pipeline">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((pipeline) => (
                  <SelectItem key={pipeline.id} value={pipeline.id}>
                    {pipeline.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {board && board.stages.length > 0 ? (
              <Button onClick={() => openCreate(board.stages[0].id)}>
                <Plus />
                Novo negócio
              </Button>
            ) : null}
          </>
        }
      />

      {moveDeal.isPending ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Movendo negócio…
        </p>
      ) : null}

      {boardQuery.isPending ? (
        <PageLoader label="Carregando negócios…" />
      ) : boardQuery.isError || !board ? (
        <EmptyState
          icon={Briefcase}
          title="Não foi possível carregar o funil"
          description="Tente novamente em instantes."
          action={
            <Button variant="outline" onClick={() => void boardQuery.refetch()}>
              Tentar novamente
            </Button>
          }
        />
      ) : board.stages.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="Pipeline sem etapas"
          description="Adicione etapas em Configurações → Pipelines para montar o quadro."
        />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {board.stages.map((stage) => (
            <div
              key={stage.id}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOverStage(stage.id);
              }}
              onDragLeave={() => setDragOverStage((current) => (current === stage.id ? null : current))}
              onDrop={(event) => handleDrop(event, stage.id)}
              className={cn(
                'flex w-72 shrink-0 flex-col rounded-lg border bg-surface/60 p-3',
                dragOverStage === stage.id ? 'border-primary/60 bg-primary/5' : 'border-border',
              )}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{stage.name}</span>
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {stage.dealCount}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => openCreate(stage.id)}
                  aria-label={`Adicionar negócio em ${stage.name}`}
                >
                  <Plus />
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                {stage.deals.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                    Arraste um negócio para cá
                  </p>
                ) : (
                  stage.deals.map((deal) => (
                    <button
                      key={deal.id}
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/deal-id', deal.id);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onClick={() => openEdit(deal)}
                      className="cursor-grab rounded-md border border-border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/40 active:cursor-grabbing"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{deal.title}</span>
                        <span className={cn('text-xs font-semibold', statusTone[deal.status])}>
                          {DEAL_STATUS_OPTIONS.find((option) => option.value === deal.status)?.label}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {currency.format(Number(deal.value))}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {deal.customerName ?? deal.leadName ?? deal.ownerName ?? 'Sem vínculo'}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedPipelineId ? (
        <DealForm
          key={formNonce}
          open={formOpen}
          onOpenChange={setFormOpen}
          deal={editingDeal}
          pipelineId={selectedPipelineId}
          stageId={createStageId}
        />
      ) : null}
    </div>
  );
}
