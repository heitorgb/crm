import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { PageHeader } from '@/components/common/page-header';
import { StatusBadge } from '@/components/common/status-badge';
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
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import type { Role } from '@/types/auth';
import type { AdminTenantMember } from '@/types/admin';
import { MemberForm } from './member-form';
import { useAdminTenant, useRemoveMember, useUpdateMember } from './queries';

const roleLabel: Record<Role, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  USER: 'Usuário',
};

export function AdminTenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useAdminTenant(id);
  const updateMember = useUpdateMember(id ?? '');
  const removeMember = useRemoveMember(id ?? '');

  const [formOpen, setFormOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<AdminTenantMember | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tenant = query.data;

  const handleError = (caught: unknown, fallback: string): void => {
    setError(caught instanceof ApiError ? caught.message : fallback);
  };

  const handleRoleChange = async (member: AdminTenantMember, role: Role): Promise<void> => {
    setError(null);
    try {
      await updateMember.mutateAsync({ membershipId: member.id, input: { role } });
    } catch (caught) {
      handleError(caught, 'Não foi possível alterar o papel.');
    }
  };

  const handleActiveChange = async (member: AdminTenantMember, active: boolean): Promise<void> => {
    setError(null);
    try {
      await updateMember.mutateAsync({ membershipId: member.id, input: { active } });
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

  return (
    <div className="space-y-5">
      <PageHeader
        title={tenant?.name ?? 'Organização'}
        description={tenant ? `Criada em ${formatDate(tenant.createdAt)}` : undefined}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link to="/admin/tenants">
                <ArrowLeft />
                Voltar
              </Link>
            </Button>
            <Button onClick={() => setFormOpen(true)} disabled={!tenant}>
              <Plus />
              Adicionar usuário
            </Button>
          </div>
        }
      />

      {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}

      <Card className="overflow-hidden">
        {query.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : query.isError || !tenant ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm font-medium text-danger">
              Não foi possível carregar a organização.
            </p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              <RefreshCw />
              Tentar novamente
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead className="hidden sm:table-cell">Ativo</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenant.members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="font-medium text-foreground">{member.name}</div>
                    <div className="text-xs text-muted-foreground">{member.email}</div>
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={member.active}
                        onCheckedChange={(checked) => void handleActiveChange(member, checked)}
                        disabled={updateMember.isPending}
                        aria-label="Ativar ou desativar usuário"
                      />
                      <StatusBadge tone={member.active ? 'success' : 'secondary'}>
                        {member.active ? 'Ativo' : 'Inativo'}
                      </StatusBadge>
                    </div>
                  </TableCell>
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {id ? <MemberForm open={formOpen} onOpenChange={setFormOpen} tenantId={id} /> : null}

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
        title="Remover usuário"
        description={
          pendingRemove
            ? `${pendingRemove.name} perderá acesso a esta organização. O usuário global não é apagado.`
            : undefined
        }
        confirmLabel="Remover"
        destructive
        loading={removeMember.isPending}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  );
}
