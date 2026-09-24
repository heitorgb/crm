import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Contact as ContactIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { PageLoader } from '@/components/common/page-loader';
import { StatusBadge, type StatusTone } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CustomerStatus } from '@/types/crm';
import { useCustomer, useDeleteCustomer, useUpdateCustomer } from '@/features/customers/queries';
import { CustomerForm } from '@/features/customers/customer-form';
import { ContactForm } from '@/features/contacts/contact-form';
import { useDeleteContact } from '@/features/contacts/queries';

const statusTone: Record<CustomerStatus, StatusTone> = {
  ACTIVE: 'success',
  INACTIVE: 'secondary',
  ARCHIVED: 'outline',
};

const statusLabel: Record<CustomerStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  ARCHIVED: 'Arquivado',
};

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const query = useCustomer(id);
  const deleteCustomer = useDeleteCustomer();
  const updateCustomer = useUpdateCustomer();
  const deleteContact = useDeleteContact();

  const [editOpen, setEditOpen] = useState(false);
  const [editNonce, setEditNonce] = useState(0);
  const [contactFormOpen, setContactFormOpen] = useState(false);
  const [contactNonce, setContactNonce] = useState(0);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [confirmDeleteCustomer, setConfirmDeleteCustomer] = useState(false);
  const [pendingContactDelete, setPendingContactDelete] = useState<string | null>(null);

  if (query.isPending) {
    return <PageLoader label="Carregando cliente…" />;
  }

  if (query.isError || !query.data) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Cliente"
          actions={
            <Button variant="outline" asChild>
              <Link to="/clientes/clientes">
                <ArrowLeft />
                Voltar
              </Link>
            </Button>
          }
        />
        <EmptyState
          icon={ContactIcon}
          title="Cliente não encontrado"
          description="O cliente pode ter sido removido ou pertence a outra organização."
          action={
            <Button asChild>
              <Link to="/clientes/clientes">Ver lista de clientes</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const customer = query.data;
  const editingContact = customer.contacts.find((contact) => contact.id === editingContactId) ?? null;

  const handleDeleteCustomer = async (): Promise<void> => {
    await deleteCustomer.mutateAsync(customer.id);
    navigate('/clientes/clientes', { replace: true });
  };

  const handleDeleteContact = async (): Promise<void> => {
    if (!pendingContactDelete) {
      return;
    }
    await deleteContact.mutateAsync(pendingContactDelete);
    setPendingContactDelete(null);
  };

  const toggleStatus = async (): Promise<void> => {
    await updateCustomer.mutateAsync({
      id: customer.id,
      input: { status: customer.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={customer.name}
        description={customer.document ? `Documento: ${customer.document}` : 'Sem documento cadastrado'}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/clientes/clientes">
                <ArrowLeft />
                Voltar
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => void toggleStatus()} disabled={updateCustomer.isPending}>
              {customer.status === 'ACTIVE' ? 'Desativar' : 'Ativar'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditNonce((value) => value + 1);
                setEditOpen(true);
              }}
            >
              <Pencil />
              Editar
            </Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmDeleteCustomer(true)}>
              <Trash2 />
              Excluir
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Dados cadastrais</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <StatusBadge tone={statusTone[customer.status]}>{statusLabel[customer.status]}</StatusBadge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Documento</span>
              <span className="font-mono text-xs">{customer.document ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Criado em</span>
              <span>{formatDateTime(customer.createdAt)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Atualizado em</span>
              <span>{formatDateTime(customer.updatedAt)}</span>
            </div>
            <div className="space-y-1.5 pt-1">
              <span className="text-muted-foreground">Tags</span>
              <div className="flex flex-wrap gap-1">
                {customer.tags.length === 0 ? (
                  <span className="text-xs text-muted-foreground">Nenhuma tag</span>
                ) : (
                  customer.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center gap-1 rounded-sm border border-border bg-muted px-1.5 py-0.5 text-xs"
                    >
                      <span
                        className={cn('size-1.5 rounded-full')}
                        style={{ backgroundColor: tag.color ?? 'currentColor' }}
                        aria-hidden
                      />
                      {tag.name}
                    </span>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Contatos</CardTitle>
            <Button
              size="sm"
              onClick={() => {
                setEditingContactId(null);
                setContactNonce((value) => value + 1);
                setContactFormOpen(true);
              }}
            >
              <Plus />
              Adicionar
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {customer.contacts.length === 0 ? (
              <EmptyState
                icon={ContactIcon}
                title="Nenhum contato cadastrado"
                description="Adicione pessoas de contato deste cliente."
              />
            ) : (
              customer.contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{contact.name}</span>
                      {contact.isPrimary ? <StatusBadge tone="info">Principal</StatusBadge> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[contact.position, contact.email, contact.phone].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => {
                        setEditingContactId(contact.id);
                        setContactNonce((value) => value + 1);
                        setContactFormOpen(true);
                      }}
                      aria-label="Editar contato"
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-danger"
                      onClick={() => setPendingContactDelete(contact.id)}
                      aria-label="Excluir contato"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <CustomerForm
        key={editNonce}
        open={editOpen}
        onOpenChange={setEditOpen}
        customer={customer}
      />

      <ContactForm
        key={contactNonce}
        open={contactFormOpen}
        onOpenChange={(open) => {
          setContactFormOpen(open);
          if (!open) setEditingContactId(null);
        }}
        contact={editingContact}
        customerId={customer.id}
      />

      <ConfirmDialog
        open={confirmDeleteCustomer}
        onOpenChange={setConfirmDeleteCustomer}
        title="Excluir cliente"
        description={`O cliente "${customer.name}" e seus contatos serão removidos.`}
        confirmLabel="Excluir"
        destructive
        loading={deleteCustomer.isPending}
        onConfirm={() => void handleDeleteCustomer()}
      />

      <ConfirmDialog
        open={Boolean(pendingContactDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingContactDelete(null);
        }}
        title="Excluir contato"
        description="O contato será removido deste cliente."
        confirmLabel="Excluir"
        destructive
        loading={deleteContact.isPending}
        onConfirm={() => void handleDeleteContact()}
      />
    </div>
  );
}
