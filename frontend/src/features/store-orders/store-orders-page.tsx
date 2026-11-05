import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Clock3, MapPin, Plus, Search, Store as StoreIcon } from 'lucide-react';
import { ContactPicker } from '@/features/contacts/contact-picker';
import { apiRequest } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useRealtime } from '@/providers/use-realtime';

type Status = 'PENDENTE_SEPARACAO' | 'SEPARANDO' | 'SEPARADO' | 'EM_ROTA' | 'OBSERVACAO' | 'ENTREGUE';
type Store = { id: string; name: string; externalCode: string };
type Order = {
  id: string; externalOrderId: string; customerName: string | null; orderText: string | null;
  status: Status; approvedAt: string; enteredRouteAt: string | null;
  store: { id: string; name: string }; contact: { id: string; name: string; address: string | null } | null;
};
type OrdersResult = { data: Order[]; counts: Partial<Record<Status, number>> };

const labels: Record<Status, string> = {
  PENDENTE_SEPARACAO: 'Pendente separação', SEPARANDO: 'Separando', SEPARADO: 'Separado',
  EM_ROTA: 'Em rota', OBSERVACAO: 'Observação', ENTREGUE: 'Entregue',
};
const next: Record<Status, Status[]> = {
  PENDENTE_SEPARACAO: ['SEPARANDO', 'OBSERVACAO'], SEPARANDO: ['SEPARADO', 'OBSERVACAO'],
  SEPARADO: ['EM_ROTA', 'OBSERVACAO'], EM_ROTA: ['ENTREGUE', 'OBSERVACAO'],
  OBSERVACAO: ['PENDENTE_SEPARACAO', 'SEPARANDO', 'SEPARADO', 'EM_ROTA'], ENTREGUE: [],
};
const groups = [
  { key: 'pending', label: 'Pendentes', statuses: ['PENDENTE_SEPARACAO', 'SEPARANDO'], color: 'bg-amber-700' },
  { key: 'separated', label: 'Separados', statuses: ['SEPARADO'], color: 'bg-blue-800' },
  { key: 'route', label: 'Em rota', statuses: ['EM_ROTA'], color: 'bg-emerald-800' },
  { key: 'observation', label: 'Observação', statuses: ['OBSERVACAO'], color: 'bg-rose-900' },
] as const;

export function StoreOrdersPage() {
  const queryClient = useQueryClient();
  const { socket } = useRealtime();
  const [storeId, setStoreId] = useState('all');
  const [group, setGroup] = useState('all');
  const [search, setSearch] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [formStoreId, setFormStoreId] = useState('');
  const [contactId, setContactId] = useState('');
  const [orderText, setOrderText] = useState('');
  const [error, setError] = useState('');
  const stores = useQuery({ queryKey: ['store-orders', 'stores'], queryFn: () => apiRequest<Store[]>('/store-orders/stores') });
  const orders = useQuery({
    queryKey: ['store-orders', 'list', storeId, search],
    queryFn: () => apiRequest<OrdersResult>(`/store-orders?${new URLSearchParams({
      ...(storeId !== 'all' ? { storeId } : {}), ...(search ? { search } : {}),
    })}`),
    refetchInterval: 30_000,
  });
  useEffect(() => {
    if (!socket) return;
    const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['store-orders', 'list'] }); };
    socket.on('store-order.updated', refresh);
    socket.on('connect', refresh);
    return () => {
      socket.off('store-order.updated', refresh);
      socket.off('connect', refresh);
    };
  }, [socket, queryClient]);
  const create = useMutation({
    mutationFn: () => apiRequest('/store-orders/manual', { method: 'POST', body: { storeId: formStoreId, contactId, orderText } }),
    onSuccess: async () => {
      setManualOpen(false); setFormStoreId(''); setContactId(''); setOrderText(''); setError('');
      await queryClient.invalidateQueries({ queryKey: ['store-orders', 'list'] });
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const move = useMutation({
    mutationFn: (status: Status) => apiRequest(`/store-orders/${selected?.id}/status`, { method: 'PATCH', body: { status } }),
    onSuccess: async () => {
      setSelected(null); setError('');
      await queryClient.invalidateQueries({ queryKey: ['store-orders', 'list'] });
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const visible = (orders.data?.data ?? []).filter((order) =>
    group === 'all' || groups.find((item) => item.key === group)?.statuses.some((status) => status === order.status));

  return <div className="mx-auto max-w-5xl space-y-5 p-4 pb-24 sm:p-6">
    <div className="flex items-center justify-between gap-4">
      <div><p className="text-sm text-muted-foreground">Operação das lojas</p><h1 className="text-3xl font-semibold">Entregas</h1></div>
      <Button onClick={() => { setError(''); setManualOpen(true); }} aria-label="Criar pedido manual"><Plus className="mr-2 size-4"/> Novo pedido</Button>
    </div>
    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-foreground">Os status alterados nesta tela ficam no CRM. A sincronização dessas alterações com as lojas será adicionada na próxima etapa.</p>
    <div className="flex gap-2 overflow-x-auto pb-1">
      <Button variant={storeId === 'all' ? 'default' : 'outline'} onClick={() => setStoreId('all')}>Todas as lojas</Button>
      {(stores.data ?? []).map((store) => <Button key={store.id} variant={storeId === store.id ? 'default' : 'outline'} onClick={() => setStoreId(store.id)} className="shrink-0"><StoreIcon className="mr-2 size-4"/>{store.name}</Button>)}
    </div>
    <label className="relative block"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input className="pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar pedido ou cliente"/></label>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {groups.map((item) => <button key={item.key} type="button" onClick={() => setGroup(group === item.key ? 'all' : item.key)} className={`${item.color} rounded-xl border-2 p-4 text-left text-white shadow-sm transition hover:brightness-110 ${group === item.key ? 'border-white ring-2 ring-primary' : 'border-transparent'}`}>
        <span className="block text-sm font-semibold uppercase sm:text-base">{item.label}</span><strong className="text-2xl">{item.statuses.reduce((sum, status) => sum + (orders.data?.counts[status] ?? 0), 0)}</strong><span className="ml-2 text-xs">pedidos</span>
      </button>)}
    </div>
    {group !== 'all' && <Button variant="ghost" onClick={() => setGroup('all')}>Mostrar todos</Button>}
    {orders.isPending ? <p className="text-sm text-muted-foreground">Carregando pedidos…</p> : orders.isError ? <p role="alert" className="text-sm text-danger">Não foi possível carregar os pedidos.</p> : visible.length === 0 ? <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">Nenhum pedido encontrado.</div> :
      <div className="space-y-2">{visible.map((order) => <button key={order.id} type="button" onClick={() => { setError(''); setSelected(order); }} className="flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:bg-surface-hover">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-bold text-primary">{order.store.name.slice(0, 2).toUpperCase()}</span>
        <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong className="truncate text-base">{order.contact?.name ?? order.customerName ?? `Pedido ${order.externalOrderId}`}</strong><span className="rounded bg-muted px-2 py-0.5 text-xs">{labels[order.status]}</span></span>
          <span className="block text-xs text-muted-foreground">{order.store.name} · {order.externalOrderId.startsWith('manual:') ? 'Manual' : `#${order.externalOrderId}`}</span>
          {order.contact?.address && <span className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="size-3"/>{order.contact.address}</span>}</span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground"/>
      </button>)}</div>}
    {orders.data?.data.length === 200 && <p className="text-center text-xs text-muted-foreground">Exibindo os 200 pedidos mais recentes.</p>}

    <Dialog open={manualOpen} onOpenChange={setManualOpen}><DialogContent><DialogHeader><DialogTitle>Novo pedido manual</DialogTitle></DialogHeader>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); setError(''); create.mutate(); }}>
        <div className="space-y-2"><Label htmlFor="manual-store">Loja</Label><select id="manual-store" required value={formStoreId} onChange={(event) => setFormStoreId(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Selecione a loja</option>{(stores.data ?? []).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></div>
        <div className="space-y-2"><Label>Contato</Label><ContactPicker value={contactId} onValueChange={setContactId}/></div>
        <div className="space-y-2"><Label htmlFor="manual-text">Texto do pedido</Label><Textarea id="manual-text" required maxLength={10000} value={orderText} onChange={(event) => setOrderText(event.target.value)} placeholder="Cole ou digite o pedido recebido" rows={6}/></div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={!formStoreId || !contactId || !orderText.trim() || create.isPending}>Criar pedido</Button>
      </form>
    </DialogContent></Dialog>

    <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent><DialogHeader><DialogTitle>Detalhe do pedido</DialogTitle></DialogHeader>
      {selected && <div className="space-y-4 text-sm"><p className="font-medium">{selected.contact?.name ?? selected.customerName ?? 'Cliente não informado'} · {selected.store.name}</p>
        <p className="text-muted-foreground">Status: {labels[selected.status]}</p>
        {selected.contact?.address && <p className="flex gap-2"><MapPin className="size-4"/>{selected.contact.address}</p>}
        <p className="flex gap-2 text-muted-foreground"><Clock3 className="size-4"/>Aprovado em {new Date(selected.approvedAt).toLocaleString('pt-BR')}</p>
        {selected.orderText && <div className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3">{selected.orderText}</div>}
        {error && <p role="alert" className="text-danger">{error}</p>}
        <div className="flex flex-wrap gap-2">{next[selected.status].map((status) => <Button key={status} variant={status === 'OBSERVACAO' ? 'outline' : 'default'} disabled={move.isPending} onClick={() => move.mutate(status)}>{labels[status]}</Button>)}</div>
      </div>}
    </DialogContent></Dialog>
  </div>;
}
