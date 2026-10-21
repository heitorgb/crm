import { useState } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { StatusBadge } from '@/components/common/status-badge';
import { UserAvatar } from '@/components/common/user-avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api-client';
import type { Role } from '@/types/auth';
import type { Member } from '@/types/settings';
import { MemberForm } from './member-form';
import { useMembers, useRemoveMember, useUpdateMember } from './queries';

const roleLabel: Record<Role, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  USER: 'Usuário',
};

export function TeamTab({ canManage }: { canManage: boolean }) {
  const query = useMembers();
  const updateMember = useUpdateMember();
  const removeMember = useRemoveMember();
  const [formOpen, setFormOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Member | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleError = (caught: unknown, fallback: string): void => {
    setError(caught instanceof ApiError ? caught.message : fallback);
  };

  const handleRoleChange = async (member: Member, role: Role): Promise<void> => {
    setError(null);
    try {
      await updateMember.mutateAsync({ id: member.id, input: { role } });
    } catch (caught) {
      handleError(caught, 'Não foi possível alterar o papel.');
    }
  };

  const handleActiveChange = async (member: Member, active: boolean): Promise<void> => {
    setError(null);
    try {
      await updateMember.mutateAsync({ id: member.id, input: { active } });
    } catch (caught) {
      handleError(caught, 'Não foi possível alterar o status.');
    }
  };

  const confirmRemove = async (): Promise<void> => {
    if (!pendingRemove) {
      return;
    }
    setError(null);
    try {
      await removeMember.mutateAsync(pendingRemove.id);
      setPendingRemove(null);
    } catch (caught) {
      handleError(caught, 'Não foi possível remover o usuário.');
      setPendingRemove(null);
    }
  };

  const members = query.data ?? [];

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-3 space-y-0 sm:flex-row sm:justify-between">
        <div>
          <CardTitle>Equipe</CardTitle>
          <CardDescription>Usuários com acesso a esta organização.</CardDescription>
        </div>
        {canManage ? (
          <Button onClick={() => setFormOpen(true)}>
            <Plus />
            Adicionar usuário
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}

        {query.isPending ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <p className="text-sm text-danger">Não foi possível carregar a equipe.</p>
        ) : members.length === 0 ? (
          <EmptyState icon={Users} title="Nenhum usuário" description="Adicione o primeiro usuário." />
        ) : (
          <>
            <div className="space-y-2 sm:hidden">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="min-w-0 space-y-3 rounded-md border border-border p-3"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <UserAvatar name={member.name} className="size-9 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium text-foreground">
                        {member.name}
                      </p>
                      <p className="break-all text-xs text-muted-foreground">{member.email}</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {canManage ? (
                      <Select
                        value={member.role}
                        onValueChange={(value) => void handleRoleChange(member, value as Role)}
                        disabled={updateMember.isPending}
                      >
                        <SelectTrigger className="h-9 w-full" aria-label="Alterar papel">
                          <SelectValue>{roleLabel[member.role]}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="OWNER">Proprietário</SelectItem>
                          <SelectItem value="ADMIN">Administrador</SelectItem>
                          <SelectItem value="USER">Usuário</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <StatusBadge tone="secondary">{roleLabel[member.role]}</StatusBadge>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {canManage ? (
                          <Switch
                            checked={member.active}
                            onCheckedChange={(checked) => void handleActiveChange(member, checked)}
                            disabled={updateMember.isPending}
                            aria-label="Ativar ou desativar usuário"
                          />
                        ) : (
                          <StatusBadge tone={member.active ? 'success' : 'secondary'}>
                            {member.active ? 'Ativo' : 'Inativo'}
                          </StatusBadge>
                        )}
                        {canManage ? (
                          <span className="text-xs text-muted-foreground">
                            {member.active ? 'Ativo' : 'Inativo'}
                          </span>
                        ) : null}
                      </div>
                      {canManage ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 text-danger"
                          onClick={() => setPendingRemove(member)}
                          disabled={removeMember.isPending}
                          aria-label="Remover usuário"
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden overflow-hidden rounded-md border border-border sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead className="hidden sm:table-cell">Ativo</TableHead>
                    {canManage ? <TableHead className="text-right">Ações</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <UserAvatar name={member.name} className="size-8" />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">
                              {member.name}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {member.email}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {canManage ? (
                          <Select
                            value={member.role}
                            onValueChange={(value) => void handleRoleChange(member, value as Role)}
                            disabled={updateMember.isPending}
                          >
                            <SelectTrigger className="h-8 w-[9.5rem]" aria-label="Alterar papel">
                              <SelectValue>{roleLabel[member.role]}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="OWNER">Proprietário</SelectItem>
                              <SelectItem value="ADMIN">Administrador</SelectItem>
                              <SelectItem value="USER">Usuário</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <StatusBadge tone="secondary">{roleLabel[member.role]}</StatusBadge>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {canManage ? (
                          <Switch
                            checked={member.active}
                            onCheckedChange={(checked) => void handleActiveChange(member, checked)}
                            disabled={updateMember.isPending}
                            aria-label="Ativar ou desativar usuário"
                          />
                        ) : (
                          <StatusBadge tone={member.active ? 'success' : 'secondary'}>
                            {member.active ? 'Ativo' : 'Inativo'}
                          </StatusBadge>
                        )}
                      </TableCell>
                      {canManage ? (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-danger"
                            onClick={() => setPendingRemove(member)}
                            disabled={removeMember.isPending}
                            aria-label="Remover usuário"
                          >
                            <Trash2 />
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>

      {canManage ? <MemberForm open={formOpen} onOpenChange={setFormOpen} /> : null}

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
        title="Remover usuário"
        description={
          pendingRemove
            ? `${pendingRemove.name} perderá acesso a esta organização.`
            : undefined
        }
        confirmLabel="Remover"
        destructive
        loading={removeMember.isPending}
        onConfirm={() => void confirmRemove()}
      />
    </Card>
  );
}
