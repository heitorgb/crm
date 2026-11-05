import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, Store as StoreIcon } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Mode = 'AUTOMATIC' | 'MANUAL';
type Store = { id: string; name: string; externalCode: string; deliveryConfirmationMode: Mode; active: boolean };
type CreatedStore = Store & { secret: string };

export function StoresSettingsTab({ canManage }: { canManage: boolean }) {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [externalCode, setExternalCode] = useState('');
  const [mode, setMode] = useState<Mode>('AUTOMATIC');
  const [secret, setSecret] = useState<{ storeId: string; value: string } | null>(null);
  const [error, setError] = useState('');
  const [rotating, setRotating] = useState<string | null>(null);
  const [editing, setEditing] = useState<Store | null>(null);
  const [editName, setEditName] = useState('');
  const stores = useQuery({
    queryKey: ['store-orders', 'manage-stores'],
    queryFn: () => apiRequest<Store[]>('/store-orders/stores/manage'),
    enabled: canManage,
  });
  const invalidate = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['store-orders', 'manage-stores'] }),
      client.invalidateQueries({ queryKey: ['store-orders', 'stores'] }),
    ]);
  };
  const create = useMutation({
    mutationFn: () => apiRequest<CreatedStore>('/store-orders/stores', {
      method: 'POST', body: { name, externalCode, deliveryConfirmationMode: mode },
    }),
    onSuccess: async (store) => {
      setName(''); setExternalCode(''); setMode('AUTOMATIC'); setError('');
      setSecret({ storeId: store.id, value: store.secret });
      await invalidate();
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Store> }) =>
      apiRequest<Store>(`/store-orders/stores/${id}`, { method: 'PATCH', body: data }),
    onSuccess: async () => { setError(''); setEditing(null); await invalidate(); },
    onError: (cause: Error) => setError(cause.message),
  });
  const rotate = useMutation({
    mutationFn: (id: string) => apiRequest<{ id: string; secret: string }>(`/store-orders/stores/${id}/rotate-secret`, { method: 'POST' }),
    onSuccess: (result) => { setSecret({ storeId: result.id, value: result.secret }); setRotating(null); setError(''); },
    onError: (cause: Error) => setError(cause.message),
  });

  if (!canManage) return <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">Somente administradores da organização podem gerenciar lojas.</p>;

  return <div className="space-y-6">
    <div><h2 className="text-lg font-semibold">Lojas integradas</h2><p className="text-sm text-muted-foreground">Cadastre cada instalação do sistema de pedidos separadamente. A credencial aparece apenas na criação ou renovação.</p></div>
    {error && <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    <form className="space-y-4 rounded-xl border bg-card p-5" onSubmit={(event) => { event.preventDefault(); setError(''); create.mutate(); }}>
      <div className="flex items-center gap-2 font-medium"><Plus className="size-4"/> Nova loja</div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="store-name">Nome da loja</Label><Input id="store-name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: JP Peças"/></div>
        <div className="space-y-2"><Label htmlFor="store-code">Código da loja</Label><Input id="store-code" required maxLength={120} value={externalCode} onChange={(event) => setExternalCode(event.target.value)} placeholder="Ex.: jp-pecas"/><p className="text-xs text-muted-foreground">Identificador único dentro da organização. Não poderá ser alterado depois.</p></div>
        <div className="space-y-2"><Label htmlFor="store-mode">Confirmação de entrega</Label><select id="store-mode" value={mode} onChange={(event) => setMode(event.target.value as Mode)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="AUTOMATIC">Automática, 2 horas (em implantação)</option><option value="MANUAL">Manual no CRM</option></select><p className="text-xs text-muted-foreground">O prazo automático é registrado, mas sua execução será ativada em uma próxima etapa.</p></div>
      </div>
      <Button disabled={create.isPending || !name.trim() || !externalCode.trim()} type="submit">Cadastrar loja</Button>
    </form>

    <div className="space-y-3">
      {stores.isPending ? <p className="text-sm text-muted-foreground">Carregando lojas…</p> : stores.isError ? <p role="alert" className="text-sm text-danger">Não foi possível carregar as lojas.</p> : stores.data?.length === 0 ? <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">Nenhuma loja cadastrada.</p> : stores.data?.map((store) =>
        <div key={store.id} className="rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-lg bg-primary/10 p-2 text-primary"><StoreIcon className="size-5"/></div><div><h3 className="font-semibold">{store.name}</h3><p className="text-xs text-muted-foreground">Código: {store.externalCode}</p></div></div><span className={`rounded-full px-2 py-1 text-xs ${store.active ? 'bg-emerald-500/10 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>{store.active ? 'Ativa' : 'Inativa'}</span></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">ID para configurar na loja</p><code className="break-all text-xs">{store.id}</code></div><div><Label htmlFor={`mode-${store.id}`}>Confirmação de entrega</Label><select id={`mode-${store.id}`} value={store.deliveryConfirmationMode} disabled={update.isPending} onChange={(event) => update.mutate({ id: store.id, data: { deliveryConfirmationMode: event.target.value as Mode } })} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"><option value="AUTOMATIC">Automática, 2 horas (em implantação)</option><option value="MANUAL">Manual</option></select></div></div>
          <div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => { setEditing(store); setEditName(store.name); }}>Editar nome</Button><Button variant="outline" size="sm" onClick={() => update.mutate({ id: store.id, data: { active: !store.active } })}>{store.active ? 'Desativar' : 'Ativar'}</Button><Button variant="outline" size="sm" onClick={() => setRotating(store.id)}><KeyRound className="mr-2 size-4"/>Renovar credencial</Button></div>
        </div>) }
    </div>

    <Dialog open={secret !== null} onOpenChange={(open) => { if (!open) setSecret(null); }}><DialogContent><DialogHeader><DialogTitle>Credencial da loja</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">Copie agora. Este valor não poderá ser consultado novamente.</p><p className="text-xs">ID da loja: <code className="break-all">{secret?.storeId}</code></p><code className="break-all rounded-md border bg-muted p-3 text-xs">{secret?.value}</code><Button type="button" onClick={() => { if (secret) void navigator.clipboard.writeText(secret.value); }}><Copy className="mr-2 size-4"/>Copiar credencial</Button></DialogContent></Dialog>
    <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}><DialogContent><DialogHeader><DialogTitle>Editar nome da loja</DialogTitle></DialogHeader><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (editing && editName.trim()) update.mutate({ id: editing.id, data: { name: editName.trim() } }); }}><div className="space-y-2"><Label htmlFor="edit-store-name">Nome</Label><Input id="edit-store-name" required maxLength={120} value={editName} onChange={(event) => setEditName(event.target.value)}/></div><Button disabled={update.isPending || !editName.trim()} type="submit">Salvar</Button></form></DialogContent></Dialog>
    <Dialog open={rotating !== null} onOpenChange={(open) => { if (!open) setRotating(null); }}><DialogContent><DialogHeader><DialogTitle>Renovar credencial?</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">A credencial atual deixará de funcionar imediatamente. Atualize a configuração no sistema desta loja para retomar o envio de pedidos.</p><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setRotating(null)}>Cancelar</Button><Button disabled={rotate.isPending} onClick={() => { if (rotating) rotate.mutate(rotating); }}>Renovar</Button></div></DialogContent></Dialog>
  </div>;
}
