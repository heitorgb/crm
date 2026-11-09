import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

type Status = 'PENDENTE_SEPARACAO' | 'SEPARANDO' | 'SEPARADO' | 'EM_ROTA' | 'OBSERVACAO' | 'ENTREGUE';
type CardPreferences = { statuses: Status[] };

const options: { status: Status; label: string }[] = [
  { status: 'PENDENTE_SEPARACAO', label: 'Pendente separação' },
  { status: 'SEPARANDO', label: 'Separando' },
  { status: 'SEPARADO', label: 'Separados' },
  { status: 'EM_ROTA', label: 'Em rota' },
  { status: 'OBSERVACAO', label: 'Observação' },
  { status: 'ENTREGUE', label: 'Entregues' },
];

export function DeliveryCardsSettings() {
  const client = useQueryClient();
  const tenantId = useAuthStore((state) => state.session?.tenant.id);
  const cards = useQuery({
    queryKey: ['store-orders', 'cards', tenantId],
    queryFn: () => apiRequest<CardPreferences>('/store-orders/cards'),
  });
  const update = useMutation({
    mutationFn: (statuses: Status[]) => apiRequest<CardPreferences>('/store-orders/cards', {
      method: 'PATCH', body: { statuses },
    }),
    onSuccess: (result) => client.setQueryData(['store-orders', 'cards', tenantId], result),
  });

  return <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
    <div>
      <h2 className="text-lg font-semibold">Cards de Entregas</h2>
      <p className="text-sm text-muted-foreground">Escolha quais status aparecem como cards para todos da organização. Os pedidos continuam na lista.</p>
    </div>
    {cards.isPending ? <p className="text-sm text-muted-foreground">Carregando cards…</p>
      : cards.isError ? <p role="alert" className="text-sm text-danger">Não foi possível carregar os cards.</p>
        : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {options.map(({ status, label }) => <label key={status} className="flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm">
            <input type="checkbox" checked={cards.data.statuses.includes(status)} disabled={update.isPending}
              onChange={() => update.mutate(cards.data.statuses.includes(status)
                ? cards.data.statuses.filter((item) => item !== status)
                : options.map((item) => item.status).filter((item) => item === status || cards.data.statuses.includes(item)))}
              className="size-4 accent-primary" />
            {label}
          </label>)}
        </div>}
    {update.isError && <p role="alert" className="text-sm text-danger">Não foi possível salvar os cards. Tente novamente.</p>}
  </section>;
}
