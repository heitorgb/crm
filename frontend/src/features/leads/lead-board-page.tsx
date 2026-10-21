import { useMemo, useState } from 'react';
import {
  CalendarClock,
  CircleDollarSign,
  GripVertical,
  KanbanSquare,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  UserRound,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { SearchInput } from '@/components/common/search-input';
import { UserAvatar } from '@/components/common/user-avatar';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useMembers } from '@/features/settings/queries';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import type { LeadCard, LeadPipeline } from '@/types/crm';
import { LeadDetailSheet } from './lead-detail-sheet';
import { LeadForm } from './lead-form';
import { PipelineSettingsDialog } from './pipeline-settings-dialog';
import { useDeleteLead, useLeadBoard, useLeadPipelines, useMoveLead } from './queries';

export function LeadBoardPage() {
  const pipelines = useLeadPipelines();
  const members = useMembers();
  const canDelete = useAuthStore((state) => state.hasRole('OWNER', 'ADMIN'));
  const [pipelineId, setPipelineId] = useState('');
  const [search, setSearch] = useState('');
  const [ownerId, setOwnerId] = useState('all');
  const [formLead, setFormLead] = useState<LeadCard | null | undefined>(undefined);
  const [detailLead, setDetailLead] = useState<LeadCard | null>(null);
  const [initialStageId, setInitialStageId] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState<LeadCard | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);
  const activePipelineId = pipelineId || pipelines.data?.find((item) => item.active)?.id || pipelines.data?.[0]?.id || '';
  const board = useLeadBoard({
    pipelineId: activePipelineId,
    search: debouncedSearch || undefined,
    ownerId: ownerId === 'all' ? undefined : ownerId,
    limitPerStage: 100,
  });
  const moveLead = useMoveLead();
  const deleteLead = useDeleteLead();

  const selectedPipeline = useMemo<LeadPipeline | undefined>(
    () => pipelines.data?.find((item) => item.id === activePipelineId),
    [activePipelineId, pipelines.data],
  );
  const liveDetailLead = useMemo<LeadCard | null>(() => {
    if (!detailLead) {
      return null;
    }
    return (
      board.data?.stages.flatMap((stage) => stage.leads).find((item) => item.id === detailLead.id) ??
      detailLead
    );
  }, [board.data, detailLead]);

  const totals = useMemo(() => {
    const stages = board.data?.stages ?? [];
    return {
      leads: stages.reduce((sum, stage) => sum + stage.leadCount, 0),
      value: stages.reduce((sum, stage) => sum + stage.valueCents, 0),
      won: stages.filter((stage) => stage.kind === 'WON').reduce((sum, stage) => sum + stage.leadCount, 0),
    };
  }, [board.data]);

  const openCreate = (stageId?: string) => {
    setInitialStageId(stageId);
    setFormLead(null);
  };

  const dropLead = async (event: React.DragEvent, stageId: string) => {
    event.preventDefault();
    const leadId = event.dataTransfer.getData('application/x-orderup-lead');
    if (!leadId) return;
    setActionError(null);
    try {
      await moveLead.mutateAsync({ id: leadId, stageId });
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : 'Não foi possível mover o lead.');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteLead.mutateAsync(pendingDelete.id);
      setPendingDelete(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : 'Não foi possível excluir o lead.');
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Painel de leads"
        description="Acompanhe cada oportunidade do primeiro contato ao fechamento."
        actions={<><Button variant="outline" onClick={() => setSettingsOpen(true)} disabled={!selectedPipeline || !canDelete}><Settings2 />Gerenciar etapas</Button><Button onClick={() => openCreate()} disabled={!selectedPipeline}><Plus />Novo lead</Button></>}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Leads no funil" value={String(totals.leads)} icon={KanbanSquare} />
        <Metric label="Valor do pipeline" value={formatCurrency(totals.value)} icon={CircleDollarSign} />
        <Metric label="Vendas ganhas" value={String(totals.won)} icon={UserRound} />
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 lg:flex-row lg:items-center">
        <Select value={activePipelineId} onValueChange={setPipelineId}>
          <SelectTrigger className="lg:w-64"><SelectValue placeholder="Selecione o pipeline" /></SelectTrigger>
          <SelectContent>{pipelines.data?.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}</SelectContent>
        </Select>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar lead, contato ou telefone..." className="flex-1" />
        <Select value={ownerId} onValueChange={setOwnerId}>
          <SelectTrigger className="lg:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os responsáveis</SelectItem>
            {members.data?.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {actionError ? <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{actionError}</p> : null}

      {pipelines.isLoading || board.isLoading ? (
        <div className="flex gap-4 overflow-hidden">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[32rem] min-w-72 flex-1" />)}</div>
      ) : pipelines.isError || board.isError ? (
        <EmptyState icon={KanbanSquare} title="Não foi possível carregar o funil" description="Tente novamente em alguns instantes." action={<Button variant="outline" onClick={() => void board.refetch()}>Tentar novamente</Button>} />
      ) : !selectedPipeline ? (
        <EmptyState icon={KanbanSquare} title="Nenhum pipeline configurado" description="Peça a um administrador para configurar o primeiro pipeline." />
      ) : (
        <div className="scrollbar-thin flex min-h-[34rem] gap-4 overflow-x-auto pb-3">
          {board.data?.stages.map((stage) => (
            <section
              key={stage.id}
              className="flex w-80 min-w-80 flex-col rounded-xl border border-border bg-muted/45"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void dropLead(event, stage.id)}
            >
              <header className="flex items-center justify-between border-b border-border px-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color ?? '#94a3b8' }} />
                    <h2 className="truncate text-sm font-semibold">{stage.name}</h2>
                    <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted-foreground">{stage.leadCount}</span>
                  </div>
                  <p className="mt-1 pl-[18px] text-xs text-muted-foreground">{formatCurrency(stage.valueCents)}</p>
                </div>
                <Button variant="ghost" size="icon" className="size-8" onClick={() => openCreate(stage.id)} aria-label={`Novo lead em ${stage.name}`}><Plus /></Button>
              </header>
              <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto p-2">
                {stage.leads.map((lead) => (
                  <article
                    key={lead.id}
                    draggable
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetailLead(lead)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setDetailLead(lead);
                      }
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('application/x-orderup-lead', lead.id);
                    }}
                    className="group cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm transition hover:border-primary/40 hover:shadow-md active:cursor-grabbing"
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="mt-0.5 size-4 shrink-0 text-muted-foreground/50" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{lead.title}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <UserAvatar name={lead.contact.name} src={lead.contact.avatarUrl ?? undefined} className="size-7" />
                          <div className="min-w-0"><p className="truncate text-xs font-medium">{lead.contact.name}</p><p className="truncate text-[11px] text-muted-foreground">{lead.contact.phone ?? lead.contact.email ?? 'Sem contato'}</p></div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          {lead.valueCents > 0 ? <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">{formatCurrency(lead.valueCents)}</span> : null}
                          {lead.source ? <span className="rounded bg-muted px-1.5 py-0.5">{lead.source}</span> : null}
                        </div>
                        {lead.tags.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {lead.tags.slice(0, 3).map((tag) => (
                              <span key={tag.id} className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: tag.color ? `${tag.color}18` : undefined }}>
                                <span className="size-1.5 rounded-full" style={{ backgroundColor: tag.color ?? '#94a3b8' }} />{tag.name}
                              </span>
                            ))}
                            {lead.tags.length > 3 ? <span className="text-[10px] text-muted-foreground">+{lead.tags.length - 3}</span> : null}
                          </div>
                        ) : null}
                        {lead.nextFollowUpAt ? <p className={cn('mt-2 flex items-center gap-1 text-[11px]', new Date(lead.nextFollowUpAt) < new Date() && lead.status === 'OPEN' ? 'font-medium text-danger' : 'text-muted-foreground')}><CalendarClock className="size-3" />{formatDateTime(lead.nextFollowUpAt)}</p> : null}
                        <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                          <span className="truncate text-[11px] text-muted-foreground">{lead.ownerName ?? 'Sem responsável'}</span>
                          <div className="flex opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                            <Button variant="ghost" size="icon" className="size-7" onClick={(event) => { event.stopPropagation(); setFormLead(lead); }} aria-label="Editar lead"><Pencil className="size-3.5" /></Button>
                            {canDelete ? <Button variant="ghost" size="icon" className="size-7 text-danger" onClick={(event) => { event.stopPropagation(); setPendingDelete(lead); }} aria-label="Excluir lead"><Trash2 className="size-3.5" /></Button> : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
                {stage.leads.length === 0 ? <button type="button" className="w-full rounded-lg border border-dashed border-border px-3 py-8 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary" onClick={() => openCreate(stage.id)}>+ Adicionar lead</button> : null}
              </div>
            </section>
          ))}
        </div>
      )}

      {selectedPipeline && formLead !== undefined ? (
        <LeadForm key={`${formLead?.id ?? 'new'}-${initialStageId ?? ''}`} open onOpenChange={(open) => { if (!open) setFormLead(undefined); }} pipeline={selectedPipeline} lead={formLead} initialStageId={initialStageId} />
      ) : null}
      {selectedPipeline && liveDetailLead ? (
        <LeadDetailSheet
          key={liveDetailLead.id}
          open
          onOpenChange={(open) => { if (!open) setDetailLead(null); }}
          lead={liveDetailLead}
          pipeline={selectedPipeline}
          onEdit={() => { setDetailLead(null); setFormLead(liveDetailLead); }}
        />
      ) : null}
      {selectedPipeline ? <PipelineSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} pipeline={selectedPipeline} /> : null}
      <ConfirmDialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open) setPendingDelete(null); }} title="Excluir lead" description={pendingDelete ? `A oportunidade "${pendingDelete.title}" será removida do funil.` : undefined} confirmLabel="Excluir" destructive loading={deleteLead.isPending} onConfirm={() => void confirmDelete()} />
    </div>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof KanbanSquare }) {
  return <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4"><span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></span><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-lg font-semibold">{value}</p></div></div>;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}
