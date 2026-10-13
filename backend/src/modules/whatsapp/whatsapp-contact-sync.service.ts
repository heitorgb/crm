import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { phoneFromJid } from '../../common/whatsapp/jid.js';
import {
  JOB_NAMES,
  JOB_QUEUE,
  type JobPayload,
  type JobQueue,
} from '../../infrastructure/queue/job-queue.types.js';
import {
  ContactsService,
  type ImportContactsResult,
  type WhatsAppContactInput,
} from '../contacts/contacts.service.js';
import { EvolutionClient } from './evolution/evolution.client.js';

@Injectable()
export class WhatsAppContactSyncService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppContactSyncService.name);

  constructor(
    private readonly evolution: EvolutionClient,
    private readonly contacts: ContactsService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  onModuleInit(): void {
    this.queue.registerProcessor(JOB_NAMES.CONTACTS_SYNC, (payload) => this.handle(payload));
  }

  /** Enqueues a background import; the payload always carries the tenant explicitly. */
  async enqueue(input: { tenantId: string; instanceName: string }): Promise<void> {
    await this.queue.enqueue(JOB_NAMES.CONTACTS_SYNC, { ...input });
  }

  private async handle(payload: JobPayload): Promise<void> {
    const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null;
    const instanceName = typeof payload.instanceName === 'string' ? payload.instanceName : null;
    if (!tenantId || !instanceName) {
      return;
    }

    try {
      const result = await this.sync(tenantId, instanceName);
      if (result) {
        this.logger.log(
          `Synced contacts from ${instanceName}: ${result.created} created, ${result.updated} updated`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Contact sync failed for ${instanceName}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  /** Best-effort import of the connected number's address book. Never throws. */
  async sync(tenantId: string, instanceName: string): Promise<ImportContactsResult | null> {
    if (!this.evolution.configured) {
      return null;
    }

    const addressBook = await this.evolution.findContacts(instanceName);
    const contacts: WhatsAppContactInput[] = [];
    for (const contact of addressBook) {
      const phone = phoneFromJid(contact.jid);
      if (!phone) {
        continue;
      }
      contacts.push({ phone, name: contact.name, avatarUrl: contact.avatarUrl });
    }

    if (contacts.length === 0) {
      return { created: 0, updated: 0 };
    }

    return this.contacts.importFromWhatsApp(tenantId, contacts);
  }
}
