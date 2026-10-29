// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { WhatsAppConnectionTicket, WhatsAppInstance } from '@/types/whatsapp';

const state = vi.hoisted(() => ({
  status: 'CONNECTING' as string,
  reason: null as number | null,
  isFetching: false,
}));

vi.mock('./queries', () => ({
  useWhatsAppInstanceStatus: () => ({
    data: { status: state.status, reason: state.reason },
    isFetching: state.isFetching,
  }),
}));

import { ConnectDialog } from './connect-dialog';

const instance: WhatsAppInstance = {
  id: 'instance-1',
  name: 'Atendimento',
  instanceName: 'inst-1',
  externalInstanceId: null,
  phone: null,
  status: 'CONNECTING',
  statusReason: null,
  connectionObservedAt: null,
  active: true,
  hasCredentials: false,
  historySync: {
    status: 'IDLE',
    progress: null,
    chunks: null,
    messages: null,
    startedAt: null,
    completedAt: null,
    updatedAt: null,
    error: null,
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const firstTicket: WhatsAppConnectionTicket = {
  status: 'CONNECTING',
  qrCodeBase64: 'data:image/png;base64,FIRST',
  pairingCode: null,
  code: '2@first',
  updatedAt: '2026-10-29T10:00:00.000Z',
};

const rotatedTicket: WhatsAppConnectionTicket = {
  ...firstTicket,
  qrCodeBase64: 'data:image/png;base64,ROTATED',
  code: '2@rotated',
  updatedAt: '2026-10-29T10:00:45.000Z',
};

function renderDialog(ticket: WhatsAppConnectionTicket | null = firstTicket) {
  return render(
    <ConnectDialog
      open
      onOpenChange={() => undefined}
      instance={instance}
      ticket={ticket}
      regenerating={false}
      onRegenerate={() => undefined}
    />,
  );
}

afterEach(() => {
  cleanup();
  state.status = 'CONNECTING';
  state.reason = null;
  state.isFetching = false;
});

describe('ConnectDialog', () => {
  it('renders the latest rotated QR code', () => {
    const { rerender } = renderDialog();
    expect(screen.getByAltText('QR code de conexão do WhatsApp')).toHaveProperty(
      'src',
      'data:image/png;base64,FIRST',
    );

    rerender(
      <ConnectDialog
        open
        onOpenChange={() => undefined}
        instance={instance}
        ticket={rotatedTicket}
        regenerating={false}
        onRegenerate={() => undefined}
      />,
    );

    expect(screen.getByAltText('QR code de conexão do WhatsApp')).toHaveProperty(
      'src',
      'data:image/png;base64,ROTATED',
    );
  });

  it('explains a refused connection and offers a new QR', () => {
    state.status = 'ERROR';
    state.reason = 428;
    renderDialog();

    expect(screen.getByText('Não foi possível concluir a conexão.')).toBeTruthy();
    expect(screen.getByText(/O limite de QR codes desta tentativa foi atingido/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Gerar novo QR/ })).toBeTruthy();
  });

  it('explains an expired QR code instead of waiting forever', () => {
    state.status = 'DISCONNECTED';
    renderDialog();

    expect(screen.getByText('O QR code expirou.')).toBeTruthy();
    expect(screen.queryByText('Aguardando conexão…')).toBeNull();
  });

  it('confirms the connection once the backend reports CONNECTED', () => {
    state.status = 'CONNECTED';
    renderDialog();

    expect(screen.getByText('WhatsApp conectado com sucesso.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Gerar novo QR/ })).toBeNull();
  });
});
