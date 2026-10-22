import { Logger } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import type { TenantContextService } from '../../../src/common/tenant-context/tenant-context.service.js';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { JOB_NAMES } from '../../../src/infrastructure/queue/job-queue.types.js';
import type { JobQueue } from '../../../src/infrastructure/queue/job-queue.types.js';
import type { RealtimeService } from '../../../src/infrastructure/realtime/realtime.service.js';
import { ConversationProcessingService } from '../../../src/modules/conversations/conversation-processing.service.js';
import { WhatsAppInstanceNotConnectedError } from '../../../src/modules/conversations/conversations.errors.js';
import {
  EvolutionRequestError,
  type EvolutionClient,
} from '../../../src/modules/whatsapp/evolution/evolution.client.js';
import type { MessagesService } from '../../../src/modules/conversations/messages.service.js';

interface Harness {
  service: ConversationProcessingService;
  prisma: {
    message: { findFirst: ReturnType<typeof vi.fn> };
    conversation: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  };
  evolution: {
    configured: boolean;
    sendText: ReturnType<typeof vi.fn>;
  };
  messages: {
    persistOutbound: ReturnType<typeof vi.fn>;
    markOutboundStatus: ReturnType<typeof vi.fn>;
    markOutboundFailed: ReturnType<typeof vi.fn>;
  };
  queue: { enqueue: ReturnType<typeof vi.fn> };
  transcriptionSettings: { isAutoEnabled: ReturnType<typeof vi.fn> };
}

function createHarness(): Harness {
  const prisma = {
    message: { findFirst: vi.fn() },
    conversation: { findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  };
  const evolution = { configured: true, sendText: vi.fn() };
  const messages = {
    persistOutbound: vi.fn().mockResolvedValue({ id: 'message-1' }),
    markOutboundStatus: vi.fn().mockResolvedValue(undefined),
    markOutboundFailed: vi.fn().mockResolvedValue(undefined),
  };
  const realtime = { emitToTenant: vi.fn(), emitToConversation: vi.fn() };
  const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const transcriptionSettings = { isAutoEnabled: vi.fn().mockResolvedValue(false) };

  const tenantContext = {
    run: <T>(_options: unknown, fn: () => Promise<T>) => fn(),
  } as unknown as TenantContextService;

  const service = new ConversationProcessingService(
    prisma as unknown as PrismaService,
    tenantContext,
    evolution as unknown as EvolutionClient,
    messages as unknown as MessagesService,
    realtime as unknown as RealtimeService,
    {} as never,
    transcriptionSettings as never,
    { get: vi.fn() } as never,
    {} as never,
    queue as unknown as JobQueue,
  );

  return { service, prisma, evolution, messages, queue, transcriptionSettings };
}

function seedMessage(
  prisma: Harness['prisma'],
  overrides: { status: string; externalMessageId: string | null },
): void {
  prisma.message.findFirst.mockResolvedValue({
    id: 'message-1',
    tenantId: 'tenant-1',
    direction: 'OUTBOUND',
    type: MessageType.TEXT,
    content: 'Olá',
    senderId: 'user-1',
    senderName: 'Atendente',
    externalMessageId: overrides.externalMessageId,
    status: overrides.status,
    metadata: {},
    attachments: [],
    conversation: {
      id: 'conversation-1',
      externalContactId: '5511999999999@s.whatsapp.net',
      externalLid: null,
      preferredAddress: null,
      contact: { phone: null },
      instance: { instanceName: 'inst-1', status: 'CONNECTED' },
    },
  });
}

describe('ConversationProcessingService.retrySend', () => {
  it('never resends a DELIVERED message', async () => {
    const { service, prisma, evolution, messages } = createHarness();
    seedMessage(prisma, { status: 'DELIVERED', externalMessageId: 'ext-1' });

    await service.retrySend({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(evolution.sendText).not.toHaveBeenCalled();
    expect(messages.markOutboundStatus).not.toHaveBeenCalled();
    expect(messages.markOutboundFailed).not.toHaveBeenCalled();
  });

  it('never resends a READ message', async () => {
    const { service, prisma, evolution } = createHarness();
    seedMessage(prisma, { status: 'READ', externalMessageId: 'ext-1' });

    await service.retrySend({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(evolution.sendText).not.toHaveBeenCalled();
  });

  it('never resends a message the provider already accepted (external id present)', async () => {
    const { service, prisma, evolution } = createHarness();
    seedMessage(prisma, { status: 'FAILED', externalMessageId: 'ext-accepted' });

    await service.retrySend({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(evolution.sendText).not.toHaveBeenCalled();
  });

  it('resends a FAILED message that was never accepted exactly once', async () => {
    const { service, prisma, evolution, messages } = createHarness();
    seedMessage(prisma, { status: 'FAILED', externalMessageId: null });
    evolution.sendText.mockResolvedValue({ externalMessageId: 'new-ext', raw: {} });

    await service.retrySend({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(evolution.sendText).toHaveBeenCalledTimes(1);
    expect(messages.markOutboundStatus).toHaveBeenCalledWith('message-1', 'SENT', 'new-ext', {
      destinationType: 'PN',
    });
    expect(messages.persistOutbound).not.toHaveBeenCalled();
  });

  it('keeps a retryable provider error (HTTP 500) for the bounded queue retry', async () => {
    const { service, prisma, evolution, messages } = createHarness();
    seedMessage(prisma, { status: 'FAILED', externalMessageId: null });
    evolution.sendText.mockRejectedValue(new EvolutionRequestError('server error', 500));

    await expect(
      service.retrySend({ tenantId: 'tenant-1', messageId: 'message-1' }),
    ).rejects.toBeInstanceOf(EvolutionRequestError);

    expect(messages.markOutboundFailed).toHaveBeenCalledWith('message-1', 'EVOLUTION_HTTP_500');
  });

  it('does not blindly repeat a network failure with an uncertain outcome', async () => {
    const { service, prisma, evolution, messages } = createHarness();
    seedMessage(prisma, { status: 'FAILED', externalMessageId: null });
    evolution.sendText.mockRejectedValue(new EvolutionRequestError('socket hang up'));

    await expect(
      service.retrySend({ tenantId: 'tenant-1', messageId: 'message-1' }),
    ).resolves.toBeUndefined();

    expect(messages.markOutboundFailed).toHaveBeenCalledWith('message-1', 'EVOLUTION_NETWORK_UNCERTAIN');
  });

  it('resends a failed message to the preferred address when asked to fall back', async () => {
    const { service, prisma, evolution, messages } = createHarness();
    seedMessage(prisma, { status: 'FAILED', externalMessageId: 'ext-failed' });
    prisma.message.findFirst.mockResolvedValue({
      id: 'message-1',
      tenantId: 'tenant-1',
      direction: 'OUTBOUND',
      type: MessageType.TEXT,
      content: 'Olá',
      senderId: 'user-1',
      senderName: 'Atendente',
      externalMessageId: 'ext-failed',
      status: 'FAILED',
      metadata: { fallbackAttempted: true },
      attachments: [],
      conversation: {
        id: 'conversation-1',
        externalContactId: '5511999999999@s.whatsapp.net',
        externalLid: '75209205874877@lid',
        preferredAddress: 'PN',
        contact: { phone: null },
        instance: { instanceName: 'inst-1', status: 'CONNECTED' },
      },
    });
    evolution.sendText.mockResolvedValue({ externalMessageId: 'new-ext', raw: {} });

    await service.retrySend({ tenantId: 'tenant-1', messageId: 'message-1', fallback: true });

    expect(evolution.sendText).toHaveBeenCalledWith(
      'inst-1',
      '5511999999999',
      'Olá',
      undefined,
    );
    expect(messages.markOutboundStatus).toHaveBeenCalledWith('message-1', 'SENT', 'new-ext', {
      destinationType: 'PN',
    });
  });
});

describe('ConversationProcessingService.dispatch', () => {
  function seedConversation(prisma: Harness['prisma']): void {
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      tenantId: 'tenant-1',
      externalContactId: '5511999999999@s.whatsapp.net',
      externalLid: null,
      preferredAddress: null,
      contact: { phone: null },
      instance: { instanceName: 'inst-1', status: 'CONNECTED' },
    });
  }

  const author = { senderId: 'user-1', senderName: 'Atendente', showAgentName: false };

  it('logs a structured failure and enqueues a retry for a definitive HTTP error', async () => {
    const { service, prisma, evolution, messages, queue } = createHarness();
    seedConversation(prisma);
    evolution.sendText.mockRejectedValue(new EvolutionRequestError('server error', 500));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await service.deliverText('tenant-1', 'conversation-1', 'Olá', author);

    expect(messages.markOutboundFailed).toHaveBeenCalledWith('message-1', 'EVOLUTION_HTTP_500');
    expect(queue.enqueue).toHaveBeenCalledWith('whatsapp.message.send', {
      tenantId: 'tenant-1',
      messageId: 'message-1',
    });
    const payload = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(payload).toContain('whatsapp.send.failed');
    expect(payload).toContain('"messageId":"message-1"');
    expect(payload).toContain('"tenantId":"tenant-1"');
    expect(payload).toContain('"instance":"inst-1"');
    expect(payload).toContain('"endpoint":"POST /message/sendText"');
    expect(payload).toContain('"httpStatus":500');

    warn.mockRestore();
  });

  it('does not enqueue a retry when the network failure has an uncertain outcome', async () => {
    const { service, prisma, evolution, messages, queue } = createHarness();
    seedConversation(prisma);
    evolution.sendText.mockRejectedValue(new EvolutionRequestError('socket hang up'));

    await service.deliverText('tenant-1', 'conversation-1', 'Olá', author);

    expect(messages.markOutboundFailed).toHaveBeenCalledWith('message-1', 'EVOLUTION_NETWORK_UNCERTAIN');
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('prefers the captured LID over the dialable phone on a LID-migrated account', async () => {
    const { service, prisma, evolution } = createHarness();
    seedConversation(prisma);
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      tenantId: 'tenant-1',
      externalContactId: '5511999999999@s.whatsapp.net',
      externalLid: '75209205874877@lid',
      preferredAddress: null,
      contact: { phone: null },
      instance: { instanceName: 'inst-1', status: 'CONNECTED' },
    });
    evolution.sendText.mockResolvedValue({ externalMessageId: 'ext-1', raw: {} });

    await service.deliverText('tenant-1', 'conversation-1', 'Olá', author);

    expect(evolution.sendText).toHaveBeenCalledWith(
      'inst-1',
      '75209205874877@lid',
      'Olá',
      undefined,
    );
  });

  it('honors the learned PN preference over the LID', async () => {
    const { service, prisma, evolution } = createHarness();
    seedConversation(prisma);
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      tenantId: 'tenant-1',
      externalContactId: '5511999999999@s.whatsapp.net',
      externalLid: '75209205874877@lid',
      preferredAddress: 'PN',
      contact: { phone: null },
      instance: { instanceName: 'inst-1', status: 'CONNECTED' },
    });
    evolution.sendText.mockResolvedValue({ externalMessageId: 'ext-1', raw: {} });

    await service.deliverText('tenant-1', 'conversation-1', 'Olá', author);

    expect(evolution.sendText).toHaveBeenCalledWith(
      'inst-1',
      '5511999999999',
      'Olá',
      undefined,
    );
  });

  it('uses the contact phone when the conversation is LID-addressed and PN is preferred', async () => {
    const { service, prisma, evolution } = createHarness();
    seedConversation(prisma);
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      tenantId: 'tenant-1',
      externalContactId: '75209205874877@lid',
      externalLid: null,
      preferredAddress: 'PN',
      contact: { phone: '5511888888888' },
      instance: { instanceName: 'inst-1', status: 'CONNECTED' },
    });
    evolution.sendText.mockResolvedValue({ externalMessageId: 'ext-1', raw: {} });

    await service.deliverText('tenant-1', 'conversation-1', 'Olá', author);

    expect(evolution.sendText).toHaveBeenCalledWith(
      'inst-1',
      '5511888888888',
      'Olá',
      undefined,
    );
  });

  it('sends to the LID when the conversation itself is addressed by a LID', async () => {
    const { service, prisma, evolution } = createHarness();
    seedConversation(prisma);
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      tenantId: 'tenant-1',
      externalContactId: '75209205874877@lid',
      externalLid: null,
      preferredAddress: null,
      contact: { phone: null },
      instance: { instanceName: 'inst-1', status: 'CONNECTED' },
    });
    evolution.sendText.mockResolvedValue({ externalMessageId: 'ext-1', raw: {} });

    await service.deliverText('tenant-1', 'conversation-1', 'Olá', author);

    expect(evolution.sendText).toHaveBeenCalledWith(
      'inst-1',
      '75209205874877@lid',
      'Olá',
      undefined,
    );
  });

  it('falls back to the dialable phone when no LID was captured', async () => {
    const { service, prisma, evolution } = createHarness();
    seedConversation(prisma);
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      tenantId: 'tenant-1',
      externalContactId: '5511999999999@s.whatsapp.net',
      externalLid: null,
      preferredAddress: null,
      contact: { phone: null },
      instance: { instanceName: 'inst-1', status: 'CONNECTED' },
    });
    evolution.sendText.mockResolvedValue({ externalMessageId: 'ext-1', raw: {} });

    await service.deliverText('tenant-1', 'conversation-1', 'Olá', author);

    expect(evolution.sendText).toHaveBeenCalledWith(
      'inst-1',
      '5511999999999',
      'Olá',
      undefined,
    );
  });

  it('asks Evolution to generate a link preview when the text contains a URL', async () => {
    const { service, prisma, evolution } = createHarness();
    seedConversation(prisma);
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      tenantId: 'tenant-1',
      externalContactId: '5511999999999@s.whatsapp.net',
      externalLid: null,
      preferredAddress: null,
      contact: { phone: null },
      instance: { instanceName: 'inst-1', status: 'CONNECTED' },
    });
    evolution.sendText.mockResolvedValue({ externalMessageId: 'ext-1', raw: {} });

    await service.deliverText(
      'tenant-1',
      'conversation-1',
      'Veja https://exemplo.com/artigo',
      author,
    );

    expect(evolution.sendText).toHaveBeenCalledWith(
      'inst-1',
      '5511999999999',
      'Veja https://exemplo.com/artigo',
      undefined,
      { linkPreview: true },
    );
  });

  it('persists the resolved preview and asks Evolution to render it', async () => {
    const { service, prisma, evolution, messages } = createHarness();
    seedConversation(prisma);
    evolution.sendText.mockResolvedValue({ externalMessageId: 'ext-1', raw: {} });
    const preview = {
      url: 'https://exemplo.com/artigo',
      title: 'Título',
      description: 'Descrição',
      imageUrl: 'https://exemplo.com/capa.png',
      siteName: 'Exemplo',
      domain: 'exemplo.com',
    };

    await service.deliverText(
      'tenant-1',
      'conversation-1',
      'Veja https://exemplo.com/artigo',
      author,
      null,
      { linkPreview: true, preview },
    );

    expect(messages.persistOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ linkPreview: preview }),
      }),
    );
    expect(evolution.sendText).toHaveBeenCalledWith(
      'inst-1',
      '5511999999999',
      'Veja https://exemplo.com/artigo',
      undefined,
      { linkPreview: true },
    );
  });

  it('suppresses the preview when the operator removed it before sending', async () => {
    const { service, prisma, evolution, messages } = createHarness();
    seedConversation(prisma);
    evolution.sendText.mockResolvedValue({ externalMessageId: 'ext-1', raw: {} });

    await service.deliverText(
      'tenant-1',
      'conversation-1',
      'Veja https://exemplo.com/artigo',
      author,
      null,
      { linkPreview: false, preview: null },
    );

    expect(messages.persistOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ suppressLinkPreview: true }),
      }),
    );
    expect(evolution.sendText).toHaveBeenCalledWith(
      'inst-1',
      '5511999999999',
      'Veja https://exemplo.com/artigo',
      undefined,
      { linkPreview: false },
    );
  });

  it('blocks the send and does not persist when the instance is not connected', async () => {
    const { service, prisma, evolution, messages } = createHarness();
    seedConversation(prisma);
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1',
      tenantId: 'tenant-1',
      externalContactId: '5511999999999@s.whatsapp.net',
      externalLid: null,
      preferredAddress: null,
      contact: { phone: null },
      instance: { instanceName: 'inst-1', status: 'DISCONNECTED' },
    });

    await expect(
      service.deliverText('tenant-1', 'conversation-1', 'Olá', author),
    ).rejects.toBeInstanceOf(WhatsAppInstanceNotConnectedError);

    expect(messages.persistOutbound).not.toHaveBeenCalled();
    expect(evolution.sendText).not.toHaveBeenCalled();
  });
});

describe('ConversationProcessingService.processMedia', () => {
  it('enqueues automatic transcription only when the preference is enabled', async () => {
    const harness = createHarness();
    harness.prisma.message.findFirst.mockResolvedValue({
      id: 'message-1',
      type: MessageType.AUDIO,
      direction: 'INBOUND',
      metadata: {},
    });
    vi.spyOn(harness.service, 'ensureMediaStored').mockResolvedValue('stored');

    await harness.service.processMedia({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(harness.transcriptionSettings.isAutoEnabled).toHaveBeenCalledWith('tenant-1');
    expect(harness.queue.enqueue).not.toHaveBeenCalled();

    harness.transcriptionSettings.isAutoEnabled.mockResolvedValue(true);
    await harness.service.processMedia({ tenantId: 'tenant-1', messageId: 'message-1' });

    expect(harness.queue.enqueue).toHaveBeenCalledWith(
      JOB_NAMES.TRANSCRIPTION_PROCESS,
      { tenantId: 'tenant-1', messageId: 'message-1' },
      { jobId: 'transcription-message-1' },
    );
  });
});
