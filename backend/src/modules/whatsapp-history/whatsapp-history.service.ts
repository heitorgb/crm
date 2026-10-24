import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import { EvolutionClient } from '../whatsapp/evolution/evolution.client.js';
import { WhatsAppInstancesService } from '../whatsapp/whatsapp-instances.service.js';
import { WebhookService } from '../webhooks/webhook.service.js';
import type { BackfillWhatsAppHistoryDto } from './dto/whatsapp-history.dto.js';

export interface WhatsAppHistoryBackfillResult {
  instanceId: string;
  instanceName: string;
  days: number;
  from: Date;
  to: Date;
  scanned: number;
  imported: number;
  skipped: number;
  failed: number;
  pages: number;
}

const DEFAULT_BACKFILL_MAX_MESSAGES = 1000;
const BACKFILL_PAGE_SIZE = 200;

@Injectable()
export class WhatsAppHistoryService {
  private readonly logger = new Logger(WhatsAppHistoryService.name);

  constructor(
    private readonly instances: WhatsAppInstancesService,
    private readonly evolution: EvolutionClient,
    private readonly webhook: WebhookService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async backfill(
    id: string,
    input: BackfillWhatsAppHistoryDto,
  ): Promise<WhatsAppHistoryBackfillResult> {
    const instance = await this.instances.findResolved(id);
    const days = input.days ?? this.config.get('WHATSAPP_HISTORY_IMPORT_DAYS') ?? 30;
    const maxMessages = input.maxMessages ?? DEFAULT_BACKFILL_MAX_MESSAGES;
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

    let page = 1;
    let pages = 1;
    let scanned = 0;
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    while (page <= pages && scanned < maxMessages) {
      const result = await this.evolution.findMessages(instance.instanceName, {
        from,
        to,
        page,
        limit: BACKFILL_PAGE_SIZE,
      });

      pages = Math.max(1, Math.min(result.pages, Math.ceil(maxMessages / BACKFILL_PAGE_SIZE)));
      const records = result.records.slice(0, maxMessages - scanned);
      const ingested = await this.webhook.ingestHistoryMessages(instance, records, {
        cutoff: from.getTime(),
        emitRecentRealtime: false,
        source: 'backfill',
      });

      scanned += records.length;
      imported += ingested.imported;
      skipped += ingested.skipped;
      failed += ingested.failed;

      if (result.records.length === 0) {
        break;
      }

      page += 1;
    }

    const summary = {
      instance: instance.instanceName,
      days,
      scanned,
      imported,
      skipped,
      failed,
      pages: page - 1,
    };
    this.logger.log(`whatsapp.history.backfill ${JSON.stringify(summary)}`);

    return {
      instanceId: instance.id,
      instanceName: instance.instanceName,
      days,
      from,
      to,
      scanned,
      imported,
      skipped,
      failed,
      pages: page - 1,
    };
  }
}
