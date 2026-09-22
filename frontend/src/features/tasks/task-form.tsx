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
import { ApiError } from '@/lib/api-client';
import { useCustomers } from '@/features/customers/queries';
import { useLeads } from '@/features/leads/queries';
import { useMembers } from '@/features/members/queries';
import type { Task, TaskPriority, TaskStatus } from '@/types/sales';
import {
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
  useCreateTask,
  useUpdateTask,
} from './queries';

interface TaskFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
}

const NONE = '__none__';

export function TaskForm({ open, onOpenChange, task }: TaskFormProps) {
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const membersQuery = useMembers();
  const leadsQuery = useLeads({ perPage: 100, sort: 'createdAt', order: 'desc' });
  const customersQuery = useCustomers({ perPage: 100, sort: 'name', order: 'asc' });

  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'PENDING');
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'MEDIUM');
  const [dueAt, setDueAt] = useState(task?.dueAt ? task.dueAt.slice(0, 10) : '');
  const [ownerId, setOwnerId] = useState(task?.ownerId ?? NONE);
  const [leadId, setLeadId] = useState(task?.leadId ?? NONE);
  const [customerId, setCustomerId] = useState(task?.customerId ?? NONE);
  const [error, setError] = useState<string | null>(null);

  const pending = createTask.isPending || updateTask.isPending;

  const handleSubmit = async (): Promise<void> => {
    setError(null);
    if (title.trim().length === 0) {
      setError('Informe o título da tarefa.');
      return;
    }

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      status,
      priority,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      ownerId: ownerId === NONE ? null : ownerId,
      leadId: leadId === NONE ? null : leadId,
      customerId: customerId === NONE ? null : customerId,
    };

    try {
      if (task) {
        await updateTask.mutateAsync({ id: task.id, input: payload });
      } else {
        await createTask.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'Não foi possível salvar a tarefa.',
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? 'Editar tarefa' : 'Nova tarefa'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <FormField id="task-title" label="Título" required>
            <Input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </FormField>

          <FormField id="task-description" label="Descrição">
            <Textarea
              id="task-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="task-status" label="Status">
              <Select value={status} onValueChange={(value) => setStatus(value as TaskStatus)}>
                <SelectTrigger id="task-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField id="task-priority" label="Prioridade">
              <Select value={priority} onValueChange={(value) => setPriority(value as TaskPriority)}>
                <SelectTrigger id="task-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="task-due" label="Prazo">
              <Input
                id="task-due"
                type="date"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </FormField>
            <FormField id="task-owner" label="Responsável">
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger id="task-owner">
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
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="task-lead" label="Lead">
              <Select value={leadId} onValueChange={setLeadId}>
                <SelectTrigger id="task-lead">
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
            <FormField id="task-customer" label="Cliente">
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger id="task-customer">
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
