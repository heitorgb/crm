import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, MessageSquare, Pencil, Smartphone } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { PageLoader } from '@/components/common/page-loader';
import { StatusBadge, type StatusTone } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import { useConversations } from '@/features/attendance/queries';
import type { ConversationStatus } from '@/types/attendance';
import { ContactForm } from './contact-form';
import { useContact } from './queries';

const statusTone: Record<ConversationStatus, StatusTone> = {
  OPEN: 'success',
  CLOSED: 'secondary',
};

const statusLabel: Record<ConversationStatus, string> = {
  OPEN: 'Aberta',
  CLOSED: 'Encerrada',
};

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useContact(id);
  const conversationsQuery = useConversations({ contactId: id, perPage: 50 });
  const [editOpen, setEditOpen] = useState(false);

  if (query.isPending) {
    return <PageLoader label="Carregando contato…" />;
  }

  if (query.isError || !query.data) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Contato"
          actions={
            <Button variant="outline" asChild>
              <Link to="/contatos">
                <ArrowLeft />
                Voltar
              </Link>
            </Button>
          }
        />
        <EmptyState
          icon={MessageSquare}
          title="Contato não encontrado"
          description="O contato pode ter sido removido ou pertence a outra organização."
          action={
            <Button asChild>
              <Link to="/contatos">Ver lista de contatos</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const contact = query.data;
  const conversations = conversationsQuery.data?.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={contact.name}
        description={contact.phone ? `Telefone: ${contact.phone}` : 'Sem telefone cadastrado'}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/contatos">
                <ArrowLeft />
                Voltar
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil />
              Editar
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Dados do contato</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Telefone</span>
              <span className="font-mono text-xs">{contact.phone ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">E-mail</span>
              <span className="truncate">{contact.email ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Cargo</span>
              <span>{contact.position ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Criado em</span>
              <span>{formatDateTime(contact.createdAt)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Histórico de conversas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {conversationsQuery.isPending ? (
              <p className="text-sm text-muted-foreground">Carregando conversas…</p>
            ) : conversations.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="Nenhuma conversa"
                description="As conversas deste contato aparecem aqui."
              />
            ) : (
              conversations.map((conversation) => (
                <Link
                  key={conversation.id}
                  to={`/atendimento/conversas?conversation=${conversation.id}`}
                  className="flex items-start justify-between gap-3 rounded-md border border-border p-3 transition-colors hover:bg-surface-hover"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <Smartphone className="size-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">
                        {conversation.instanceName}
                      </span>
                      <StatusBadge tone={statusTone[conversation.status]}>
                        {statusLabel[conversation.status]}
                      </StatusBadge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {conversation.lastMessage?.content ?? 'Sem mensagens'}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {conversation.lastMessageAt ? formatDateTime(conversation.lastMessageAt) : ''}
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <ContactForm open={editOpen} onOpenChange={setEditOpen} contact={contact} />
    </div>
  );
}
