import { buildSeparationReminderPush } from '../../../src/modules/store-orders/store-order-delivery-scheduler.service.js';

describe('buildSeparationReminderPush', () => {
  it('describes a single overdue order with customer, store and waiting time', () => {
    const push = buildSeparationReminderPush([{ storeId: 'store-1', customer: 'Ana', store: 'JP Peças', waitingMinutes: 42 }]);

    expect(push).toEqual({
      title: 'Pedido aguardando separação',
      body: 'Ana · JP Peças — aguardando há 42 min',
      tag: 'store-order-separation-reminder',
      data: { path: '/entregas' },
    });
  });

  it('groups several overdue orders into one notification', () => {
    const push = buildSeparationReminderPush([
      { storeId: 'store-1', customer: 'Ana', store: 'JP Peças', waitingMinutes: 42 },
      { storeId: 'store-2', customer: 'Bruno', store: 'Loja 2', waitingMinutes: 31 },
    ]);

    expect(push.title).toBe('2 pedidos aguardando separação');
    expect(push.body).toBe('Abra o Acompanhamento para ver os pedidos atrasados.');
    expect(push.data.path).toBe('/entregas');
  });
});
