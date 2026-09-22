import { useState } from 'react';
import { CheckCircle2, ListChecks, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Pagination } from '@/components/common/pagination';
import { SearchInput } from '@/components/common/search-input';
import { StatusBadge, type StatusTone } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { Task, TaskPriority, TaskStatus } from '@/types/sales';
import {
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
  useDeleteTask,
  useTasks,
  useUpdateTask,
} from './queries';
import { TaskForm } from './task-form';

const PAGE_SIZE = 20;

const statusTone: Record<TaskStatus, StatusTone> = {
  PENDING: 'warning',
  IN_PROGRESS: 'info',
  DONE: 'success',
  CANCELED: 'secondary',
};

const priorityTone: Record<TaskPriority, StatusTone> = {
  LOW: 'secondary',
  MEDIUM: 'info',
  HIGH: 'warning',
  URGENT: 'danger',
};

export function TasksPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TaskStatus | 'ALL'>('ALL');
  const [priority, setPriority] = useState<TaskPriority | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [formNonce, setFormNonce] = useState(0);
  const [editing, setEditing] = useState<Task | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);

  const debouncedSearch = useDebouncedValue(search, 350);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const query = useTasks({
    page,
    perPage: PAGE_SIZE,
    search: debouncedSearch || undefined,
    status: status === 'ALL' ? undefined : status,
    priority: priority === 'ALL' ? undefined : priority,
    sort: 'createdAt',
    order: 'desc',
  });

  const openCreate = (): void => {
    setEditing(null);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  const openEdit = (task: Task): void => {
    setEditing(task);
    setFormNonce((value) => value + 1);
    setFormOpen(true);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tarefas"
        description="Atividades do time."
        actions={
          <Button onClick={openCreate}>
            <Plus />
            Nova tarefa
          </Button>
        }
      />

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Buscar tarefa"
            className="sm:max-w-sm"
          />
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as TaskStatus | 'ALL');
              setPage(1);
            }}
          >
            <SelectTrigger className="sm:w-44" aria-label="Filtrar por status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os status</SelectItem>
              {TASK_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={priority}
            onValueChange={(value) => {
              setPriority(value as TaskPriority | 'ALL');
              setPage(1);
            }}
          >
            <SelectTrigger className="sm:w-44" aria-label="Filtrar por prioridade">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas as prioridades</SelectItem>
              {TASK_PRIORITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {query.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm font-medium text-danger">Não foi possível carregar as tarefas.</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        ) : query.data.data.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={ListChecks}
              title="Nenhuma tarefa encontrada"
              description="Crie uma tarefa para organizar o time."
              action={
                <Button onClick={openCreate}>
                  <Plus />
                  Nova tarefa
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarefa</TableHead>
                  <TableHead className="hidden md:table-cell">Vínculo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Prioridade</TableHead>
                  <TableHead className="hidden lg:table-cell">Prazo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{task.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {task.ownerName ?? 'Sem responsável'}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {task.leadName ?? task.customerName ?? task.dealTitle ?? '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={statusTone[task.status]}>
                        {TASK_STATUS_OPTIONS.find((option) => option.value === task.status)?.label}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <StatusBadge tone={priorityTone[task.priority]}>
                        {TASK_PRIORITY_OPTIONS.find((option) => option.value === task.priority)?.label}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                      {task.dueAt ? formatDate(task.dueAt) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {task.status !== 'DONE' ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-success"
                            onClick={() =>
                              void updateTask.mutateAsync({ id: task.id, input: { status: 'DONE' } })
                            }
                            aria-label="Concluir tarefa"
                          >
                            <CheckCircle2 />
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openEdit(task)}
                          aria-label="Editar tarefa"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-danger"
                          onClick={() => setPendingDelete(task)}
                          aria-label="Excluir tarefa"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="border-t border-border p-4">
              <Pagination
                page={query.data.meta.page}
                pageCount={query.data.meta.totalPages}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </Card>

      <TaskForm key={formNonce} open={formOpen} onOpenChange={setFormOpen} task={editing} />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Excluir tarefa"
        description={pendingDelete ? `A tarefa "${pendingDelete.title}" será removida.` : undefined}
        confirmLabel="Excluir"
        destructive
        loading={deleteTask.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          void deleteTask.mutateAsync(pendingDelete.id).then(() => setPendingDelete(null)).catch(() => setPendingDelete(null));
        }}
      />
    </div>
  );
}
