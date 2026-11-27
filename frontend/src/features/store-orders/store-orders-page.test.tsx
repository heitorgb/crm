// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({
  startConversation: vi.fn(),
  sendMessage: vi.fn(),
  createOrder: vi.fn(),
  listOrders: vi.fn(),
  getOrder: vi.fn(),
  getCards: vi.fn(),
  linkContact: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock('@/providers/use-realtime', () => ({ useRealtime: () => ({ socket: null }) }));
vi.mock('@/features/whatsapp/queries', () => ({
  useWhatsAppInstances: () => ({ data: { data: [{ id: 'instance-1', name: 'WhatsApp conectado', status: 'CONNECTED' }] } }),
}));
vi.mock('@/features/contacts/contact-picker', () => ({
  ContactPicker: ({ onValueChange }: { onValueChange: (id: string) => void }) =>
    <button type="button" onClick={() => onValueChange('contact-1')}>Escolher contato</button>,
}));
vi.mock('./store-logo', () => ({ StoreLogo: () => <span>Logo</span> }));
vi.mock('@/features/attendance/services/attendance-service', () => ({
  attendanceService: { startConversation: mocks.startConversation, sendMessage: mocks.sendMessage },
}));
vi.mock('@/lib/api-client', () => ({
  apiRequest: (path: string, options?: unknown) => {
    if (path === '/store-orders/stores') return Promise.resolve([{ id: 'store-1', name: 'Loja', logoUpdatedAt: null }]);
    if (path === '/store-orders/cards') return mocks.getCards();
    if (path.startsWith('/store-orders?')) return mocks.listOrders();
    if (path === '/store-orders/manual') return mocks.createOrder(options);
    if (path === '/store-orders/order-1') return mocks.getOrder();
    if (path === '/store-orders/order-1/contact') return mocks.linkContact(options);
    if (path === '/store-orders/order-1/status') return mocks.updateStatus(options);
    throw new Error(`Rota inesperada: ${path}`);
  },
}));

import { StoreOrdersPage } from './store-orders-page';

beforeEach(() => {
  mocks.startConversation.mockResolvedValue({ id: 'conversation-1' });
  mocks.sendMessage.mockResolvedValue({ ok: true });
  mocks.createOrder.mockResolvedValue({ id: 'order-1' });
  mocks.listOrders.mockResolvedValue({ data: [], counts: {} });
  mocks.getCards.mockResolvedValue({ statuses: ['PENDENTE_SEPARACAO', 'SEPARANDO', 'SEPARADO', 'EM_ROTA', 'OBSERVACAO', 'ENTREGUE'] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function fillManualOrder() {
  fireEvent.click(screen.getByRole('button', { name: 'Criar pedido manual' }));
  await screen.findByRole('option', { name: 'Loja' });
  fireEvent.change(screen.getByLabelText('Loja'), { target: { value: 'store-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Escolher contato' }));
  fireEvent.change(screen.getByLabelText('Texto do pedido'), { target: { value: 'Texto enviado ao contato' } });
}

describe('Novo pedido manual', () => {
  it('sends the message before creating the order', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter><QueryClientProvider client={queryClient}><StoreOrdersPage /></QueryClientProvider></MemoryRouter>);
    await fillManualOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem e criar pedido' }));

    await waitFor(() => expect(mocks.createOrder).toHaveBeenCalledOnce());
    expect(mocks.startConversation).toHaveBeenCalledWith({ contactId: 'contact-1', whatsappInstanceId: 'instance-1' });
    expect(mocks.sendMessage).toHaveBeenCalledWith('conversation-1', 'Texto enviado ao contato', false);
    expect(mocks.sendMessage.mock.invocationCallOrder[0]).toBeLessThan(mocks.createOrder.mock.invocationCallOrder[0]);
  });

  it('does not resend the message when saving the order is retried', async () => {
    mocks.createOrder.mockRejectedValueOnce(new Error('Falha ao salvar'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter><QueryClientProvider client={queryClient}><StoreOrdersPage /></QueryClientProvider></MemoryRouter>);
    await fillManualOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem e criar pedido' }));
    await screen.findByText(/Mensagem enviada, mas o pedido não foi salvo/);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar pedido' }));

    await waitFor(() => expect(mocks.createOrder).toHaveBeenCalledTimes(2));
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(mocks.createOrder.mock.calls[0][0].body.requestId).toBe(mocks.createOrder.mock.calls[1][0].body.requestId);
  });
});

describe('Vínculo do contato ao pedido', () => {
  it.each([
    ['SENT', 'Contato vinculado e aviso do status atual enviado ao WhatsApp.', 'status'],
    ['FAILED', 'Contato vinculado, mas o aviso não foi enviado.', 'alert'],
    ['SKIPPED', 'Contato vinculado. Os avisos são enviados nos status Separado e Em rota.', 'status'],
  ])('shows the %s notification result without losing the saved contact', async (status, message, role) => {
    const order = {
      id: 'order-1', externalOrderId: '123', customerName: 'Cliente teste', orderText: null,
      status: status === 'SKIPPED' ? 'PENDENTE_SEPARACAO' : 'SEPARADO',
      approvedAt: '2026-11-05T12:00:00.000Z', enteredRouteAt: null,
      deliveryDueAt: null, deliveryConfirmationMode: null, deliveryConfirmationSource: null,
      store: { id: 'store-1', name: 'Loja', logoUpdatedAt: null }, contact: null,
    };
    mocks.listOrders.mockResolvedValue({ data: [order], counts: {} });
    mocks.getOrder.mockResolvedValue({ ...order, items: null, totalAmount: null });
    mocks.linkContact.mockResolvedValue({
      ...order, contact: { id: 'contact-1', name: 'Ana', address: null },
      contactNotification: { status, message },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter><QueryClientProvider client={queryClient}><StoreOrdersPage /></QueryClientProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Cliente teste/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Escolher contato' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));

    expect((await screen.findByRole(role)).textContent).toBe(message);
    expect(screen.getByRole('dialog').textContent).toContain('Ana');
    expect(screen.queryByRole('button', { name: 'Vincular' })).toBeNull();
    expect(mocks.linkContact).toHaveBeenCalledExactlyOnceWith({ method: 'PATCH', body: { contactId: 'contact-1' } });
  });
});

describe('Aviso ao mudar o status do pedido', () => {
  it.each([
    ['SENT', 'Status atualizado. Aviso do status atual enviado ao WhatsApp.', 'status'],
    ['FAILED', 'Status atualizado. O aviso não foi enviado: configure o WhatsApp da loja em Configurações > Lojas.', 'alert'],
  ])('keeps the updated order visible with the %s sending outcome', async (status, message, role) => {
    const order = {
      id: 'order-1', externalOrderId: '123', customerName: 'Ana', orderText: null,
      status: 'SEPARANDO', approvedAt: '2026-11-05T12:00:00.000Z', enteredRouteAt: null,
      deliveryDueAt: null, deliveryConfirmationMode: null, deliveryConfirmationSource: null,
      store: { id: 'store-1', name: 'Loja', logoUpdatedAt: null },
      contact: { id: 'contact-1', name: 'Ana', address: null },
    };
    mocks.listOrders.mockResolvedValue({ data: [order], counts: {} });
    mocks.getOrder.mockResolvedValue({ ...order, items: null, totalAmount: null });
    mocks.updateStatus.mockResolvedValue({ ...order, status: 'SEPARADO', statusNotification: { status, message } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter><QueryClientProvider client={queryClient}><StoreOrdersPage /></QueryClientProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Ana/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Separado' }));
    expect((await screen.findByRole(role)).textContent).toBe(message);
    expect(screen.getByRole('dialog').textContent).toContain('Separado');
    expect(screen.getByRole('button', { name: 'Em rota' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Separado' })).toBeNull();
    expect(mocks.updateStatus).toHaveBeenCalledExactlyOnceWith({ method: 'PATCH', body: { status: 'SEPARADO' } });
  });
});

it('shows quantities, prices and the order total when opening an order', async () => {
  const order = {
    id: 'order-1', externalOrderId: '123', customerName: 'Ana', orderText: null,
    status: 'PENDENTE_SEPARACAO', approvedAt: '2026-11-05T12:00:00.000Z', enteredRouteAt: null,
    deliveryDueAt: null, deliveryConfirmationMode: null, deliveryConfirmationSource: null,
    store: { id: 'store-1', name: 'Loja', logoUpdatedAt: null }, contact: null,
  };
  mocks.listOrders.mockResolvedValue({ data: [order], counts: { PENDENTE_SEPARACAO: 1 } });
  mocks.getOrder.mockResolvedValue({ ...order, items: [{ productCode: '42', description: 'Peça azul',
    quantity: '2.0000', unitPrice: '25.5000', lineTotal: '51.0000' }], totalAmount: '51.0000' });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={queryClient}><StoreOrdersPage /></QueryClientProvider></MemoryRouter>);
  expect((await screen.findByRole('button', { name: 'Pendente separação: 1 pedido' })).className).toContain('bg-amber-700');
  expect(screen.getByRole('button', { name: 'Separando: 0 pedidos' }).className).toContain('bg-orange-700');
  const deliveredCard = screen.getByRole('button', { name: 'Entregues: 0 pedidos' });
  expect(deliveredCard.className).toContain('bg-slate-700');
  fireEvent.click(deliveredCard);
  expect(screen.getByText('Nenhum pedido encontrado.')).toBeTruthy();
  fireEvent.click(deliveredCard);
  fireEvent.click(await screen.findByRole('button', { name: /Ana/ }));
  expect(screen.getByRole('button', { name: 'Separando' }).className).toContain('bg-orange-700');
  expect(screen.getByRole('button', { name: 'Observação' }).className).toContain('bg-rose-900');
  const mobileItems = await screen.findByRole('list', { name: 'Itens para separação' });
  expect(within(mobileItems).getByText('Peça azul')).toBeTruthy();
  expect(within(mobileItems).getByText('Código 42')).toBeTruthy();
  expect(within(mobileItems).getByText('2')).toBeTruthy();
  expect(within(mobileItems).getByText(/R\$\s*25,50/)).toBeTruthy();
  expect(within(mobileItems).getByText(/R\$\s*51,00/)).toBeTruthy();
  expect(screen.getByText('Total do pedido:').parentElement?.textContent).toMatch(/R\$\s*51,00/);
});

it('flags orders that are still waiting for separation after the reminder', async () => {
  const base = {
    customerName: 'Ana', orderText: null, approvedAt: '2026-11-05T12:00:00.000Z', enteredRouteAt: null,
    deliveryDueAt: null, deliveryConfirmationMode: null, deliveryConfirmationSource: null,
    store: { id: 'store-1', name: 'Loja', logoUpdatedAt: null }, contact: null,
  };
  mocks.listOrders.mockResolvedValue({ data: [
    { ...base, id: 'order-1', externalOrderId: '1', status: 'PENDENTE_SEPARACAO', separationReminderSentAt: '2026-11-05T12:31:00.000Z' },
    { ...base, id: 'order-2', externalOrderId: '2', customerName: 'Bia', status: 'SEPARADO', separationReminderSentAt: '2026-11-05T12:31:00.000Z' },
  ], counts: { PENDENTE_SEPARACAO: 1, SEPARADO: 1 } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={queryClient}><StoreOrdersPage /></QueryClientProvider></MemoryRouter>);
  expect(within(await screen.findByRole('button', { name: /Ana/ })).getByText('Atrasado')).toBeTruthy();
  expect(within(screen.getByRole('button', { name: /Bia/ })).queryByText('Atrasado')).toBeNull();
});

it('hides selected cards without hiding their orders from the list', async () => {
  mocks.getCards.mockResolvedValue({ statuses: ['PENDENTE_SEPARACAO'] });
  mocks.listOrders.mockResolvedValue({ data: [{
    id: 'order-1', externalOrderId: '123', customerName: 'Ana', orderText: null,
    status: 'ENTREGUE', approvedAt: '2026-11-05T12:00:00.000Z', enteredRouteAt: null,
    deliveryDueAt: null, deliveryConfirmationMode: null, deliveryConfirmationSource: null,
    store: { id: 'store-1', name: 'Loja', logoUpdatedAt: null }, contact: null,
  }], counts: { ENTREGUE: 1 } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={queryClient}><StoreOrdersPage /></QueryClientProvider></MemoryRouter>);
  expect(await screen.findByRole('button', { name: /Ana/ })).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Entregues: 1 pedido' })).toBeNull());
});
