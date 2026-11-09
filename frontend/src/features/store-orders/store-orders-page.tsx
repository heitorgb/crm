import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Clock3, MapPin, Plus, Search } from 'lucide-react';
import { ContactPicker } from '@/features/contacts/contact-picker';
import { apiRequest } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useRealtime } from '@/providers/use-realtime';
import { useWhatsAppInstances } from '@/features/whatsapp/queries';
import { attendanceService } from '@/features/attendance/services/attendance-service';
import { useAuthStore } from '@/stores/auth-store';
import { StoreLogo } from './store-logo';

type Status = 'PENDENTE_SEPARACAO' | 'SEPARANDO' | 'SEPARADO' | 'EM_ROTA' | 'OBSERVACAO' | 'ENTREGUE';
type Store = { id: string; name: string; externalCode: string; logoUpdatedAt: string | null };
type Order = {
  id: string; externalOrderId: string; customerName: string | null; orderText: string | null;
  status: Status; approvedAt: string; enteredRouteAt: string | null;
  deliveryDueAt: string | null; deliveryConfirmationMode: 'AUTOMATIC' | 'MANUAL' | null;
  deliveryConfirmationSource: 'AUTOMATIC' | 'MANUAL' | null;
  store: { id: string; name: string; logoUpdatedAt: string | null }; contact: { id: string; name: string; address: string | null } | null;
};
type OrderItem = { productCode: string; description: string; quantity: string; unitPrice: string; lineTotal: string };
type OrderDetail = Order & { items: OrderItem[] | null; totalAmount: string | null };
type OrdersResult = { data: Order[]; counts: Partial<Record<Status, number>> };
const moneyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const quantityFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
const money = (value: string | number) => moneyFormatter.format(Number(value));
const quantity = (value: string) => quantityFormatter.format(Number(value));

function OrderItems({ items, totalAmount }: { items: OrderItem[]; totalAmount: string | null }) {
  return <div className="space-y-3">
    <h3 className="font-semibold">Itens para separação</h3>
    <div role="list" aria-label="Itens para separação" className="space-y-2 sm:hidden">
      {items.map((item, index) => <div role="listitem" key={`${item.productCode}-${index}`} className="space-y-3 rounded-lg border p-3">
        <div className="min-w-0">
          <p className="break-words font-medium">{item.description}</p>
          <p className="text-xs text-muted-foreground">Código {item.productCode}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t pt-3">
          <div><p className="text-xs text-muted-foreground">Quantidade</p><p className="text-2xl font-bold leading-tight text-primary">{quantity(item.quantity)}</p></div>
          <div><p className="text-xs text-muted-foreground">Valor unitário</p><p className="text-base font-bold tabular-nums">{money(item.unitPrice)}</p></div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <span className="text-xs text-muted-foreground">Total do item</span>
          <span className="text-lg font-bold tabular-nums text-primary">{money(item.lineTotal)}</span>
        </div>
      </div>)}
    </div>
    <div className="hidden overflow-x-auto rounded-md border sm:block">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="bg-muted/50"><tr>
          <th className="p-2">Item</th><th className="p-2 text-right">Qtde</th>
          <th className="p-2 text-right">Unitário</th><th className="p-2 text-right">Total</th>
        </tr></thead>
        <tbody>{items.map((item, index) => <tr key={`${item.productCode}-${index}`} className="border-t">
          <td className="p-2"><span className="font-medium">{item.description}</span><span className="block text-xs text-muted-foreground">Código {item.productCode}</span></td>
          <td className="p-2 text-right font-bold tabular-nums">{quantity(item.quantity)}</td>
          <td className="p-2 text-right font-semibold tabular-nums">{money(item.unitPrice)}</td>
          <td className="p-2 text-right font-bold tabular-nums">{money(item.lineTotal)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-3 font-semibold sm:justify-end">
      <span>Total do pedido:</span>
      <span className="text-lg tabular-nums text-primary">{money(totalAmount ?? items.reduce((sum, item) => sum + Number(item.lineTotal), 0))}</span>
    </p>
  </div>;
}

const labels: Record<Status, string> = {
  PENDENTE_SEPARACAO: 'Pendente separação', SEPARANDO: 'Separando', SEPARADO: 'Separado',
  EM_ROTA: 'Em rota', OBSERVACAO: 'Observação', ENTREGUE: 'Entregue',
};
const statusBackground: Record<Status, string> = {
  PENDENTE_SEPARACAO: 'bg-amber-700', SEPARANDO: 'bg-orange-700', SEPARADO: 'bg-blue-800',
  EM_ROTA: 'bg-emerald-800', OBSERVACAO: 'bg-rose-900', ENTREGUE: 'bg-slate-700',
};
const next: Record<Status, Status[]> = {
  PENDENTE_SEPARACAO: ['SEPARANDO', 'OBSERVACAO'], SEPARANDO: ['SEPARADO', 'OBSERVACAO'],
  SEPARADO: ['EM_ROTA', 'OBSERVACAO'], EM_ROTA: ['ENTREGUE', 'OBSERVACAO'],
  OBSERVACAO: ['PENDENTE_SEPARACAO', 'SEPARANDO', 'SEPARADO', 'EM_ROTA'], ENTREGUE: [],
};
const groups = [
  { key: 'pending', label: 'Pendente separação', statuses: ['PENDENTE_SEPARACAO'], color: statusBackground.PENDENTE_SEPARACAO },
  { key: 'separating', label: 'Separando', statuses: ['SEPARANDO'], color: statusBackground.SEPARANDO },
  { key: 'separated', label: 'Separados', statuses: ['SEPARADO'], color: statusBackground.SEPARADO },
  { key: 'route', label: 'Em rota', statuses: ['EM_ROTA'], color: statusBackground.EM_ROTA },
  { key: 'observation', label: 'Observação', statuses: ['OBSERVACAO'], color: statusBackground.OBSERVACAO },
  { key: 'delivered', label: 'Entregues', statuses: ['ENTREGUE'], color: statusBackground.ENTREGUE },
] as const;

export function StoreOrdersPage() {
  const queryClient = useQueryClient();
  const { socket } = useRealtime();
  const tenantId = useAuthStore((state) => state.session?.tenant.id);
  const [storeId, setStoreId] = useState('all');
  const [group, setGroup] = useState('all');
  const [search, setSearch] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [formStoreId, setFormStoreId] = useState('');
  const [contactId, setContactId] = useState('');
  const [orderText, setOrderText] = useState('');
  const [whatsappInstanceId, setWhatsappInstanceId] = useState('');
  const [messageSent, setMessageSent] = useState(false);
  const messageSentRef = useRef(false);
  const manualRequestId = useRef(crypto.randomUUID());
  const [error, setError] = useState('');
  const stores = useQuery({ queryKey: ['store-orders', 'stores'], queryFn: () => apiRequest<Store[]>('/store-orders/stores') });
  const cards = useQuery({
    queryKey: ['store-orders', 'cards', tenantId],
    queryFn: () => apiRequest<{ statuses: Status[] }>('/store-orders/cards'),
    refetchInterval: 30_000,
  });
  const instances = useWhatsAppInstances({ perPage: 100 });
  const connectedInstances = (instances.data?.data ?? []).filter((instance) => instance.status === 'CONNECTED');
  const selectedInstanceId = connectedInstances.find((instance) => instance.id === whatsappInstanceId)?.id
    ?? connectedInstances[0]?.id ?? '';
  const orders = useQuery({
    queryKey: ['store-orders', 'list', storeId, search],
    queryFn: () => apiRequest<OrdersResult>(`/store-orders?${new URLSearchParams({
      ...(storeId !== 'all' ? { storeId } : {}), ...(search ? { search } : {}),
    })}`),
    refetchInterval: 30_000,
  });
  const detail = useQuery({
    queryKey: ['store-orders', 'detail', selected?.id],
    queryFn: () => apiRequest<OrderDetail>(`/store-orders/${selected!.id}`),
    enabled: selected !== null,
  });
  useEffect(() => {
    if (!socket) return;
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['store-orders', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['store-orders', 'detail'] });
    };
    socket.on('store-order.updated', refresh);
    socket.on('connect', refresh);
    const refreshCards = () => { void queryClient.invalidateQueries({ queryKey: ['store-orders', 'cards'] }); };
    socket.on('store-order.cards-updated', refreshCards);
    return () => {
      socket.off('store-order.updated', refresh);
      socket.off('connect', refresh);
      socket.off('store-order.cards-updated', refreshCards);
    };
  }, [socket, queryClient]);
  const create = useMutation({
    mutationFn: async () => {
      const text = orderText.trim();
      if (!messageSentRef.current) {
        const conversation = await attendanceService.startConversation({ contactId, whatsappInstanceId: selectedInstanceId });
        await attendanceService.sendMessage(conversation.id, text, false);
        messageSentRef.current = true;
        setMessageSent(true);
        void queryClient.invalidateQueries({ queryKey: ['attendance'] });
      }
      return apiRequest('/store-orders/manual', { method: 'POST', body: { requestId: manualRequestId.current, storeId: formStoreId, contactId, orderText: text } });
    },
    onSuccess: async () => {
      setManualOpen(false); setFormStoreId(''); setContactId(''); setOrderText(''); setWhatsappInstanceId(''); setError('');
      messageSentRef.current = false; setMessageSent(false);
      manualRequestId.current = crypto.randomUUID();
      await queryClient.invalidateQueries({ queryKey: ['store-orders', 'list'] });
    },
    onError: (cause: Error) => setError(messageSentRef.current
      ? `Mensagem enviada, mas o pedido não foi salvo: ${cause.message}. Tente salvar novamente; a mensagem não será reenviada.`
      : cause.message),
  });
  const move = useMutation({
    mutationFn: (status: Status) => apiRequest(`/store-orders/${selected?.id}/status`, { method: 'PATCH', body: { status } }),
    onSuccess: async () => {
      setSelected(null); setError('');
      await queryClient.invalidateQueries({ queryKey: ['store-orders', 'list'] });
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const visibleGroups = cards.data ? groups.filter((item) => cards.data.statuses.includes(item.statuses[0])) : groups;
  const activeGroup = group !== 'all' && !visibleGroups.some((item) => item.key === group) ? 'all' : group;
  const visible = (orders.data?.data ?? []).filter((order) =>
    activeGroup === 'all' || groups.find((item) => item.key === activeGroup)?.statuses.some((status) => status === order.status));

  return <div className="mx-auto max-w-5xl space-y-5 p-4 pb-24 sm:p-6">
    <div className="flex items-center justify-between gap-4">
      <div><p className="text-sm text-muted-foreground">Operação das lojas</p><h1 className="text-3xl font-semibold">Entregas</h1></div>
      <Button onClick={() => { setError(''); setManualOpen(true); }} aria-label="Criar pedido manual"><Plus className="mr-2 size-4"/> Novo pedido</Button>
    </div>
    <div className="flex gap-2 overflow-x-auto pb-1">
      <Button variant={storeId === 'all' ? 'default' : 'outline'} onClick={() => setStoreId('all')}>Todas as lojas</Button>
      {(stores.data ?? []).map((store) => <Button key={store.id} variant={storeId === store.id ? 'default' : 'outline'} onClick={() => setStoreId(store.id)} className="shrink-0"><StoreLogo key={store.logoUpdatedAt ?? 'empty'} store={store} className="mr-2 size-7 text-[10px]"/>{store.name}</Button>)}
    </div>
    <label className="relative block"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input className="pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar pedido ou cliente"/></label>
    <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3">
      {visibleGroups.map((item) => {
        const count = item.statuses.reduce((sum, status) => sum + (orders.data?.counts[status] ?? 0), 0);
        return <button key={item.key} type="button" aria-label={`${item.label}: ${count} pedido${count === 1 ? '' : 's'}`} onClick={() => setGroup(activeGroup === item.key ? 'all' : item.key)} className={`${item.color} rounded-xl border-2 p-4 text-left text-white shadow-sm transition hover:brightness-110 ${activeGroup === item.key ? 'border-white ring-2 ring-primary' : 'border-transparent'}`}>
          <span className="block text-sm font-semibold uppercase sm:text-base">{item.label}</span><strong className="text-2xl">{count}</strong><span className="ml-2 text-xs">pedido{count === 1 ? '' : 's'}</span>
        </button>;
      })}
    </div>
    {activeGroup !== 'all' && <Button variant="ghost" onClick={() => setGroup('all')}>Mostrar todos</Button>}
    {orders.isPending ? <p className="text-sm text-muted-foreground">Carregando pedidos…</p> : orders.isError ? <p role="alert" className="text-sm text-danger">Não foi possível carregar os pedidos.</p> : visible.length === 0 ? <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">Nenhum pedido encontrado.</div> :
      <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1 scrollbar-thin">{visible.map((order) => <button key={order.id} type="button" onClick={() => { setError(''); setSelected(order); }} className="flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:bg-surface-hover">
        <StoreLogo key={order.store.logoUpdatedAt ?? 'empty'} store={order.store} />
        <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong className="truncate text-base">{order.contact?.name ?? order.customerName ?? `Pedido ${order.externalOrderId}`}</strong><span className={`${statusBackground[order.status]} rounded px-2 py-0.5 text-xs font-semibold text-white`}>{labels[order.status]}</span></span>
          <span className="block text-xs text-muted-foreground">{order.store.name} · {order.externalOrderId.startsWith('manual:') ? 'Manual' : `#${order.externalOrderId}`}</span>
          {order.contact?.address && <span className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="size-3"/>{order.contact.address}</span>}</span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground"/>
      </button>)}</div>}
    {orders.data?.data.length === 200 && <p className="text-center text-xs text-muted-foreground">Exibindo os 200 pedidos mais recentes.</p>}

    <Dialog open={manualOpen} onOpenChange={setManualOpen}><DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain p-4 sm:max-h-[85vh] sm:p-5"><DialogHeader><DialogTitle>Novo pedido manual</DialogTitle></DialogHeader>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); setError(''); create.mutate(); }}>
        <div className="space-y-2"><Label htmlFor="manual-store">Loja</Label><select id="manual-store" required value={formStoreId} disabled={messageSent || create.isPending} onChange={(event) => setFormStoreId(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Selecione a loja</option>{(stores.data ?? []).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></div>
        <div className="space-y-2"><Label htmlFor="manual-contact">Contato</Label><ContactPicker id="manual-contact" value={contactId} onValueChange={setContactId} disabled={messageSent || create.isPending}/></div>
        <div className="space-y-2"><Label htmlFor="manual-whatsapp">Enviar pelo WhatsApp</Label><select id="manual-whatsapp" required value={selectedInstanceId} disabled={messageSent || create.isPending} onChange={(event) => setWhatsappInstanceId(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Selecione um WhatsApp conectado</option>{connectedInstances.map((instance) => <option key={instance.id} value={instance.id}>{instance.name}</option>)}</select>{connectedInstances.length === 0 && <p className="text-xs text-muted-foreground">Conecte um WhatsApp em Configurações para enviar a mensagem.</p>}</div>
        <div className="space-y-2"><Label htmlFor="manual-text">Texto do pedido</Label><Textarea id="manual-text" required maxLength={4000} value={orderText} disabled={messageSent || create.isPending} onChange={(event) => setOrderText(event.target.value)} placeholder="Cole ou escreva a mensagem do pedido" rows={6}/><p className="text-xs text-muted-foreground">O texto será enviado ao contato e registrado no pedido.</p></div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full sm:w-auto" disabled={!formStoreId || !contactId || !selectedInstanceId || !orderText.trim() || create.isPending}>{messageSent ? 'Salvar pedido' : 'Enviar mensagem e criar pedido'}</Button>
      </form>
    </DialogContent></Dialog>

    <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent className="max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] overflow-y-auto p-4 sm:max-h-[85vh] sm:max-w-2xl sm:p-5"><DialogHeader><DialogTitle>Detalhe do pedido</DialogTitle></DialogHeader>
      {selected && <div className="space-y-4 text-sm"><p className="font-medium">{selected.contact?.name ?? selected.customerName ?? 'Cliente não informado'} · {selected.store.name}</p>
        <p className="flex items-center gap-2 text-muted-foreground">Status: <span className={`${statusBackground[selected.status]} rounded px-2 py-0.5 text-xs font-semibold text-white`}>{labels[selected.status]}</span></p>
        {selected.status === 'EM_ROTA' && selected.deliveryDueAt && <p className="text-muted-foreground">Entrega presumida automaticamente após {new Date(selected.deliveryDueAt).toLocaleString('pt-BR')}, se o pedido continuar em rota.</p>}
        {selected.status === 'EM_ROTA' && selected.deliveryConfirmationMode === 'MANUAL' && <p className="text-muted-foreground">A entrega precisa ser confirmada manualmente.</p>}
        {selected.status === 'ENTREGUE' && selected.deliveryConfirmationSource === 'AUTOMATIC' && <p className="text-muted-foreground">Entrega presumida automaticamente, sem confirmação do destinatário.</p>}
        {selected.contact?.address && <p className="flex gap-2"><MapPin className="size-4"/>{selected.contact.address}</p>}
        <p className="flex gap-2 text-muted-foreground"><Clock3 className="size-4"/>Aprovado em {new Date(selected.approvedAt).toLocaleString('pt-BR')}</p>
        {detail.isPending ? <p className="text-muted-foreground">Carregando itens…</p> : detail.isError ? <p role="alert" className="text-danger">Não foi possível carregar os itens deste pedido.</p> : detail.data?.items?.length ? <OrderItems items={detail.data.items} totalAmount={detail.data.totalAmount} /> : detail.data?.items === null ? <p className="text-muted-foreground">Itens indisponíveis para este pedido.</p> : null}
        {selected.orderText && <div className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3">{selected.orderText}</div>}
        {error && <p role="alert" className="text-danger">{error}</p>}
        <div className="flex flex-wrap gap-2">{next[selected.status].map((status) => <button key={status} type="button" disabled={move.isPending} onClick={() => move.mutate(status)} className={`${statusBackground[status]} inline-flex h-9 items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50`}>{labels[status]}</button>)}</div>
      </div>}
    </DialogContent></Dialog>
  </div>;
}
