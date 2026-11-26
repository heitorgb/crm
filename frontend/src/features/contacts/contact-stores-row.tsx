import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/api-client';
import { MemberAccessDialog, type MemberAccessOption } from '@/features/settings/member-access-dialog';
import type { Contact } from '@/types/crm';
import { useSetContactStores } from './queries';

/** Explicit store links of a contact; admins can edit them. Orders and store WhatsApp conversations link stores automatically. */
export function ContactStoresRow({ contact, canManage }: { contact: Contact; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const setStores = useSetContactStores();
  const stores = useQuery({
    queryKey: ['store-orders', 'stores'],
    queryFn: () => apiRequest<MemberAccessOption[]>('/store-orders/stores'),
    retry: false,
  });
  const options = stores.data ?? [];
  if (options.length === 0) return null;

  const linked = contact.storeIds ?? [];
  const names = linked.map((id) => options.find((store) => store.id === id)?.name).filter(Boolean);

  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-3">
        <span className="shrink-0 text-muted-foreground">Lojas</span>
        <span className="text-right">{names.length > 0 ? names.join(', ') : 'Pelo histórico'}</span>
      </div>
      {canManage ? (
        <Button variant="outline" size="sm" className="w-full" onClick={() => { setError(''); setEditing(true); }}>
          <Store />
          Vincular lojas
        </Button>
      ) : null}
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
      {editing ? (
        <MemberAccessDialog
          title={`Lojas de ${contact.name}`}
          description="Usuários restritos a essas lojas passam a ver este contato. Ele também aparece automaticamente para as lojas em que tem pedido ou conversa pelo WhatsApp da loja."
          options={options}
          initialSelected={linked}
          saving={setStores.isPending}
          onCancel={() => setEditing(false)}
          onSave={(storeIds) => {
            setStores.mutate({ id: contact.id, storeIds }, {
              onSuccess: () => setEditing(false),
              onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível salvar as lojas.'),
            });
          }}
        />
      ) : null}
    </div>
  );
}
