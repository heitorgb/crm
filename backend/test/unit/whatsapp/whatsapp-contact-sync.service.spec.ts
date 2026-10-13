import type { JobPayload, JobProcessor } from '../../../src/infrastructure/queue/job-queue.types.js';
import { JOB_NAMES } from '../../../src/infrastructure/queue/job-queue.types.js';
import type { ContactsService } from '../../../src/modules/contacts/contacts.service.js';
import type { EvolutionClient } from '../../../src/modules/whatsapp/evolution/evolution.client.js';
import { WhatsAppContactSyncService } from '../../../src/modules/whatsapp/whatsapp-contact-sync.service.js';

interface Harness {
  service: WhatsAppContactSyncService;
  evolution: { configured: boolean; findContacts: ReturnType<typeof vi.fn> };
  contacts: { importFromWhatsApp: ReturnType<typeof vi.fn> };
  run: (name: string, payload: JobPayload) => Promise<void>;
}

function createHarness(configured = true, findContacts?: ReturnType<typeof vi.fn>): Harness {
  const evolution = {
    configured,
    findContacts: findContacts ?? vi.fn().mockResolvedValue([]),
  };
  const contacts = {
    importFromWhatsApp: vi.fn().mockResolvedValue({ created: 0, updated: 0 }),
  };

  const processors = new Map<string, JobProcessor>();
  const queue = {
    enqueue: vi.fn(async (name: string, payload: JobPayload) => {
      const processor = processors.get(name);
      if (processor) {
        await processor(payload);
      }
    }),
    registerProcessor: vi.fn((name: string, processor: JobProcessor) => {
      processors.set(name, processor);
    }),
    scheduleRepeatable: vi.fn(),
    close: vi.fn(),
  };

  const service = new WhatsAppContactSyncService(
    evolution as unknown as EvolutionClient,
    contacts as unknown as ContactsService,
    queue,
  );
  service.onModuleInit();

  return {
    service,
    evolution,
    contacts,
    run: (name, payload) => queue.enqueue(name, payload),
  };
}

describe('WhatsAppContactSyncService', () => {
  it('imports individual numbers and skips groups, status and invalid jids', async () => {
    const { service, contacts } = createHarness(
      true,
      vi.fn().mockResolvedValue([
        { jid: '5511911111111@s.whatsapp.net', name: 'Alice', avatarUrl: 'https://cdn/a.jpg' },
        { jid: '120363000000000000@g.us', name: 'Grupo', avatarUrl: null },
        { jid: 'status@broadcast', name: 'Status', avatarUrl: null },
        { jid: 'abc@lid', name: 'Lid', avatarUrl: null },
        { jid: '75209205874877@lid', name: 'Lid Numérico', avatarUrl: null },
        { jid: '867051314767696@bot', name: 'Meta AI', avatarUrl: null },
        { jid: '120363410064967646@newsletter', name: 'Newsletter', avatarUrl: null },
      ]),
    );

    await service.sync('tenant-1', 'inst-1');

    expect(contacts.importFromWhatsApp).toHaveBeenCalledWith('tenant-1', [
      { phone: '5511911111111', name: 'Alice', avatarUrl: 'https://cdn/a.jpg' },
    ]);
  });

  it('does nothing when Evolution is not configured', async () => {
    const { service, evolution, contacts } = createHarness(false);

    await service.sync('tenant-1', 'inst-1');

    expect(evolution.findContacts).not.toHaveBeenCalled();
    expect(contacts.importFromWhatsApp).not.toHaveBeenCalled();
  });

  it('enqueues the job with the tenant and imports through the processor', async () => {
    const { run, contacts } = createHarness(
      true,
      vi.fn().mockResolvedValue([
        { jid: '5511922222222@s.whatsapp.net', name: 'Bruno', avatarUrl: null },
      ]),
    );

    await run(JOB_NAMES.CONTACTS_SYNC, { tenantId: 'tenant-9', instanceName: 'inst-9' });

    expect(contacts.importFromWhatsApp).toHaveBeenCalledWith('tenant-9', [
      { phone: '5511922222222', name: 'Bruno', avatarUrl: null },
    ]);
  });

  it('swallows provider failures so the caller is never broken', async () => {
    const { run } = createHarness(true, vi.fn().mockRejectedValue(new Error('evolution down')));

    await expect(
      run(JOB_NAMES.CONTACTS_SYNC, { tenantId: 'tenant-1', instanceName: 'inst-1' }),
    ).resolves.toBeUndefined();
  });
});
