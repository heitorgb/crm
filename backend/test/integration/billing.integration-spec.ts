import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { BillingRecurrencesService } from '../../src/modules/billing/billing-recurrences.service.js';
import { BillingRemindersService } from '../../src/modules/billing/billing-reminders.service.js';
import { addDays, localDateString, localHour } from '../../src/modules/billing/billing-time.js';
import { EvolutionRequestError } from '../../src/modules/whatsapp/evolution/evolution.client.js';
import {
  authHeaders,
  cleanupTenants,
  createTestApp,
  seedMember,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from './crm.helpers.js';

const TIMEZONE = 'America/Sao_Paulo';
const today = (): string => localDateString(new Date(), TIMEZONE);

class FakeEvolution {
  configured = true;
  readonly sent: { instance: string; number: string; text: string }[] = [];
  calls = 0;
  failWith?: EvolutionRequestError;

  async sendText(instance: string, number: string, text: string) {
    this.calls += 1;
    if (this.failWith) {
      throw this.failWith;
    }
    this.sent.push({ instance, number, text });
    return { externalMessageId: `ext-${this.sent.length}`, raw: {} };
  }

  async setWebhook() {
    return {};
  }
  async getConnectionState() {
    return { instance: 'fake', state: 'open' };
  }
  async createInstance() {
    return {};
  }
  async connect() {
    return {};
  }
  async disconnect() {
    return {};
  }
  async findContacts() {
    return [];
  }
  async findGroupInfos() {
    return null;
  }
  async fetchProfilePictureUrl() {
    return null;
  }
  async getBase64FromMediaMessage() {
    return { base64: '', mimeType: null, fileName: null, caption: null, size: null };
  }
  async sendMedia() {
    return { externalMessageId: 'media', raw: {} };
  }
  async sendWhatsAppAudio() {
    return { externalMessageId: 'audio', raw: {} };
  }
  async updateMessage() {
    return {};
  }
}

const evolution = new FakeEvolution();

describe('Billing (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reminders: BillingRemindersService;
  let recurrences: BillingRecurrencesService;
  let ownerA: SeededTenant;
  let adminA: SeededTenant;
  let userA: SeededTenant;
  let ownerB: SeededTenant;

  beforeAll(async () => {
    context = await createTestApp({ evolution });
    app = context.app;
    prisma = context.prisma;
    reminders = app.get(BillingRemindersService);
    recurrences = app.get(BillingRecurrencesService);
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    evolution.sent.length = 0;
    evolution.calls = 0;
    evolution.failWith = undefined;
    ownerA = await seedTenant(app, prisma, { name: 'Billing Owner A', role: 'OWNER' });
    adminA = await seedMember(app, prisma, ownerA.tenantId, { name: 'Billing Admin A', role: 'ADMIN' });
    userA = await seedMember(app, prisma, ownerA.tenantId, { name: 'Billing User A', role: 'USER' });
    ownerB = await seedTenant(app, prisma, { name: 'Billing Owner B', role: 'OWNER' });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, adminA, userA, ownerB]);
  });

  async function createCustomer(tenant: SeededTenant, name = 'Cliente'): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/customers',
      headers: authHeaders(tenant),
      payload: { name },
    });
    return response.json().id as string;
  }

  async function createContact(
    tenant: SeededTenant,
    customerId: string,
    phone: string | null,
  ): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      headers: authHeaders(tenant),
      payload: { customerId, name: 'Contato', ...(phone ? { phone } : {}) },
    });
    return response.json().id as string;
  }

  function createConnectedInstance(tenant: SeededTenant): Promise<{ id: string }> {
    return prisma.whatsAppInstance.create({
      data: {
        tenantId: tenant.tenantId,
        name: 'Instância',
        instanceName: `billing-${randomUUID()}`,
        status: 'CONNECTED',
        active: true,
      },
      select: { id: true },
    });
  }

  function createCharge(tenant: SeededTenant, body: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/billing/charges',
      headers: authHeaders(tenant),
      payload: body,
    });
  }

  function updateSettings(tenant: SeededTenant, body: Record<string, unknown>) {
    return app.inject({
      method: 'PATCH',
      url: '/api/billing/settings',
      headers: authHeaders(tenant),
      payload: body,
    });
  }

  describe('charges CRUD and validation', () => {
    it('creates and reads a charge scoped to the tenant', async () => {
      const customerId = await createCustomer(ownerA, 'Acme');
      const response = await createCharge(ownerA, {
        customerId,
        description: 'Mensalidade de outubro',
        amountCents: 15075,
        dueDate: today(),
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        customerId,
        customerName: 'Acme',
        description: 'Mensalidade de outubro',
        amountCents: 15075,
        dueDate: today(),
        status: 'PENDING',
        paidAt: null,
      });
      expect(response.json()).not.toHaveProperty('tenantId');

      const detail = await app.inject({
        method: 'GET',
        url: `/api/billing/charges/${response.json().id}`,
        headers: authHeaders(ownerA),
      });
      expect(detail.statusCode).toBe(200);
    });

    it('rejects invalid amounts and dates', async () => {
      const customerId = await createCustomer(ownerA);

      expect(
        (await createCharge(ownerA, { customerId, description: 'X', amountCents: 0, dueDate: today() }))
          .statusCode,
      ).toBe(400);
      expect(
        (
          await createCharge(ownerA, {
            customerId,
            description: 'X',
            amountCents: 10.5,
            dueDate: today(),
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await createCharge(ownerA, {
            customerId,
            description: 'X',
            amountCents: 100,
            dueDate: '16/10/2026',
          })
        ).statusCode,
      ).toBe(400);
      const impossible = await createCharge(ownerA, {
        customerId,
        description: 'X',
        amountCents: 100,
        dueDate: '2026-02-30',
      });
      expect(impossible.statusCode).toBe(400);
      expect(impossible.json().code).toBe('BILLING_INVALID_DATE');
    });

    it('rejects an unknown customer or a foreign tenant customer', async () => {
      const foreign = await createCustomer(ownerB, 'Foreign');
      const response = await createCharge(ownerA, {
        customerId: foreign,
        description: 'X',
        amountCents: 100,
        dueDate: today(),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('BILLING_CUSTOMER_NOT_FOUND');
    });

    it('edits a pending charge and refuses to edit a paid one', async () => {
      const customerId = await createCustomer(ownerA);
      const created = await createCharge(ownerA, {
        customerId,
        description: 'Original',
        amountCents: 1000,
        dueDate: today(),
      });
      const id = created.json().id as string;

      const updated = await app.inject({
        method: 'PATCH',
        url: `/api/billing/charges/${id}`,
        headers: authHeaders(ownerA),
        payload: { description: 'Atualizada', amountCents: 2500, dueDate: addDays(today(), 5) },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({
        description: 'Atualizada',
        amountCents: 2500,
        dueDate: addDays(today(), 5),
      });

      await app.inject({
        method: 'POST',
        url: `/api/billing/charges/${id}/pay`,
        headers: authHeaders(ownerA),
      });

      const forbiddenEdit = await app.inject({
        method: 'PATCH',
        url: `/api/billing/charges/${id}`,
        headers: authHeaders(ownerA),
        payload: { description: 'Não deveria' },
      });
      expect(forbiddenEdit.statusCode).toBe(409);
      expect(forbiddenEdit.json().code).toBe('BILLING_CHARGE_NOT_EDITABLE');
    });
  });

  describe('status, payment and cancellation', () => {
    it('marks a charge as overdue when the due date is in the past', async () => {
      const customerId = await createCustomer(ownerA);
      const created = await createCharge(ownerA, {
        customerId,
        description: 'Atrasada',
        amountCents: 5000,
        dueDate: addDays(today(), -1),
      });

      const list = await app.inject({
        method: 'GET',
        url: '/api/billing/charges?status=OVERDUE',
        headers: authHeaders(ownerA),
      });
      expect(list.json().data).toHaveLength(1);
      expect(list.json().data[0]).toMatchObject({ id: created.json().id, status: 'OVERDUE' });
    });

    it('pays a charge once, recording date and responsible user', async () => {
      const customerId = await createCustomer(ownerA);
      const created = await createCharge(ownerA, {
        customerId,
        description: 'Pagar',
        amountCents: 9900,
        dueDate: today(),
      });
      const id = created.json().id as string;

      const paid = await app.inject({
        method: 'POST',
        url: `/api/billing/charges/${id}/pay`,
        headers: authHeaders(ownerA),
      });
      expect(paid.statusCode).toBe(200);
      expect(paid.json()).toMatchObject({ status: 'PAID', paidByUserId: ownerA.userId });
      expect(paid.json().paidAt).not.toBeNull();

      const duplicate = await app.inject({
        method: 'POST',
        url: `/api/billing/charges/${id}/pay`,
        headers: authHeaders(ownerA),
      });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().code).toBe('BILLING_CHARGE_NOT_PAYABLE');
    });

    it('cancels a pending charge and refuses to cancel twice', async () => {
      const customerId = await createCustomer(ownerA);
      const created = await createCharge(ownerA, {
        customerId,
        description: 'Cancelar',
        amountCents: 100,
        dueDate: today(),
      });
      const id = created.json().id as string;

      const canceled = await app.inject({
        method: 'POST',
        url: `/api/billing/charges/${id}/cancel`,
        headers: authHeaders(ownerA),
      });
      expect(canceled.statusCode).toBe(200);
      expect(canceled.json().status).toBe('CANCELED');

      const again = await app.inject({
        method: 'POST',
        url: `/api/billing/charges/${id}/cancel`,
        headers: authHeaders(ownerA),
      });
      expect(again.statusCode).toBe(409);
    });

    it('summarizes the overview indicators', async () => {
      const customerId = await createCustomer(ownerA);
      await createCharge(ownerA, { customerId, description: 'Pendente', amountCents: 1000, dueDate: addDays(today(), 3) });
      await createCharge(ownerA, { customerId, description: 'Vencida', amountCents: 2000, dueDate: addDays(today(), -2) });
      const paid = await createCharge(ownerA, { customerId, description: 'Paga', amountCents: 3000, dueDate: today() });
      await app.inject({
        method: 'POST',
        url: `/api/billing/charges/${paid.json().id}/pay`,
        headers: authHeaders(ownerA),
      });

      const overview = await app.inject({
        method: 'GET',
        url: '/api/billing/overview',
        headers: authHeaders(ownerA),
      });
      expect(overview.statusCode).toBe(200);
      expect(overview.json()).toMatchObject({
        totalPendingCents: 1000,
        totalOverdueCents: 2000,
        totalPaidCents: 3000,
        pendingCount: 1,
        overdueCount: 1,
        paidCount: 1,
        failedReminders: 0,
      });
      expect(overview.json().upcoming).toHaveLength(1);
    });
  });

  describe('authorization', () => {
    it('restricts financial writes to OWNER/ADMIN', async () => {
      const customerId = await createCustomer(ownerA);

      const create = await createCharge(userA, {
        customerId,
        description: 'X',
        amountCents: 100,
        dueDate: today(),
      });
      expect(create.statusCode).toBe(403);

      const settings = await updateSettings(userA, { remindersEnabled: false });
      expect(settings.statusCode).toBe(403);

      const list = await app.inject({
        method: 'GET',
        url: '/api/billing/charges',
        headers: authHeaders(userA),
      });
      expect(list.statusCode).toBe(200);
    });

    it('lets an ADMIN (not only the OWNER) save the billing settings', async () => {
      const response = await updateSettings(adminA, {
        remindersEnabled: true,
        reminderOffsets: [-5, 0, 5],
        messageTemplate: 'Oi {cliente}, vence {vencimento}.',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        remindersEnabled: true,
        reminderOffsets: [-5, 0, 5],
        messageTemplate: 'Oi {cliente}, vence {vencimento}.',
      });

      const persisted = await app.inject({
        method: 'GET',
        url: '/api/billing/settings',
        headers: authHeaders(adminA),
      });
      expect(persisted.json().reminderOffsets).toEqual([-5, 0, 5]);
    });

    it('rejects a USER trying to change the billing settings', async () => {
      const response = await updateSettings(userA, { messageTemplate: 'hacked' });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('requires authentication for the billing settings', async () => {
      const response = await app.inject({ method: 'PATCH', url: '/api/billing/settings', payload: {} });
      expect(response.statusCode).toBe(401);
    });

    it('scopes settings changes to the authenticated tenant', async () => {
      await updateSettings(ownerA, { messageTemplate: 'mensagem do tenant A' });
      await updateSettings(ownerB, { messageTemplate: 'mensagem do tenant B' });

      const settingsA = await app.inject({
        method: 'GET',
        url: '/api/billing/settings',
        headers: authHeaders(ownerA),
      });
      const settingsB = await app.inject({
        method: 'GET',
        url: '/api/billing/settings',
        headers: authHeaders(ownerB),
      });

      expect(settingsA.json().messageTemplate).toBe('mensagem do tenant A');
      expect(settingsB.json().messageTemplate).toBe('mensagem do tenant B');
    });
  });

  describe('tenant isolation', () => {
    it('never reads or mutates another tenant charge', async () => {
      const customerB = await createCustomer(ownerB, 'Cliente B');
      const chargeB = await createCharge(ownerB, {
        customerId: customerB,
        description: 'Só do B',
        amountCents: 100,
        dueDate: today(),
      });
      const idB = chargeB.json().id as string;

      const listA = await app.inject({
        method: 'GET',
        url: '/api/billing/charges',
        headers: authHeaders(ownerA),
      });
      expect(listA.json().data).toHaveLength(0);

      const readBAsA = await app.inject({
        method: 'GET',
        url: `/api/billing/charges/${idB}`,
        headers: authHeaders(ownerA),
      });
      expect(readBAsA.statusCode).toBe(404);

      const payBAsA = await app.inject({
        method: 'POST',
        url: `/api/billing/charges/${idB}/pay`,
        headers: authHeaders(ownerA),
      });
      expect(payBAsA.statusCode).toBe(404);

      const untouched = await prisma.billingCharge.findUnique({ where: { id: idB } });
      expect(untouched?.status).toBe('PENDING');
    });
  });

  describe('recurrence', () => {
    it('generates one identifiable charge per due date without duplicates', async () => {
      const customerId = await createCustomer(ownerA);
      const startDate = addDays(today(), -70);

      const created = await createCharge(ownerA, {
        customerId,
        description: 'Assinatura mensal',
        amountCents: 4990,
        dueDate: startDate,
        recurrence: { frequency: 'MONTHLY' },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().recurrenceId).not.toBeNull();

      await recurrences.generateDue(today());
      const afterFirst = await prisma.billingCharge.findMany({
        where: { tenantId: ownerA.tenantId, recurrenceId: created.json().recurrenceId as string },
        orderBy: { dueDate: 'asc' },
      });

      await recurrences.generateDue(today());
      const afterSecond = await prisma.billingCharge.findMany({
        where: { tenantId: ownerA.tenantId, recurrenceId: created.json().recurrenceId as string },
      });

      expect(afterFirst.length).toBeGreaterThanOrEqual(3);
      expect(afterSecond).toHaveLength(afterFirst.length);
      const dueDates = afterFirst.map((charge) => charge.dueDate.toISOString().slice(0, 10));
      expect(new Set(dueDates).size).toBe(dueDates.length);
      expect(afterFirst[0].dueDate.toISOString().slice(0, 10)).toBe(startDate);
    });

    it('stops generating after the recurrence is deactivated', async () => {
      const customerId = await createCustomer(ownerA);
      const created = await createCharge(ownerA, {
        customerId,
        description: 'Assinatura',
        amountCents: 1000,
        dueDate: addDays(today(), -70),
        recurrence: { frequency: 'MONTHLY' },
      });
      const recurrenceId = created.json().recurrenceId as string;

      const deactivated = await app.inject({
        method: 'DELETE',
        url: `/api/billing/recurrences/${recurrenceId}`,
        headers: authHeaders(ownerA),
      });
      expect(deactivated.statusCode).toBe(200);
      expect(deactivated.json().active).toBe(false);

      const before = await prisma.billingCharge.count({ where: { recurrenceId } });
      await recurrences.generateDue(today());
      const after = await prisma.billingCharge.count({ where: { recurrenceId } });
      expect(after).toBe(before);
    });
  });

  describe('reminders', () => {
    async function prepareReminderScenario(
      tenant: SeededTenant,
      options: { phone?: string | null; instance?: boolean } = {},
    ): Promise<{ chargeId: string; customerId: string }> {
      const customerId = await createCustomer(tenant, 'Cobrado');
      if (options.phone !== null) {
        await createContact(tenant, customerId, options.phone ?? '5511999999999');
      }
      if (options.instance ?? true) {
        await createConnectedInstance(tenant);
      }
      await updateSettings(tenant, {
        remindersEnabled: true,
        reminderOffsets: [0],
        sendWindowStartHour: 0,
        sendWindowEndHour: 23,
        messageTemplate: 'Oi {cliente}, {descricao} = {valor} em {vencimento}.',
      });

      const created = await createCharge(tenant, {
        customerId,
        description: 'Mensalidade',
        amountCents: 15075,
        dueDate: today(),
      });
      return { chargeId: created.json().id as string, customerId };
    }

    it('sends a reminder once and is idempotent across scans', async () => {
      const { chargeId } = await prepareReminderScenario(ownerA);

      await reminders.runScan();
      expect(evolution.sent).toHaveLength(1);
      expect(evolution.sent[0].text).toBe(
        `Oi Cobrado, Mensalidade = R$ 150,75 em ${today()}.`,
      );

      await reminders.runScan();
      await reminders.runScan();

      expect(evolution.sent).toHaveLength(1);
      const rows = await prisma.billingReminder.findMany({ where: { chargeId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'SENT', attempts: 1, destination: '5511999999999' });
      expect(rows[0].externalMessageId).not.toBeNull();
    });

    it('skips a reminder when the contact has no usable phone', async () => {
      const { chargeId } = await prepareReminderScenario(ownerA, { phone: null });

      await reminders.runScan();

      expect(evolution.sent).toHaveLength(0);
      const reminder = await prisma.billingReminder.findFirstOrThrow({ where: { chargeId } });
      expect(reminder.status).toBe('SKIPPED');
      expect(reminder.errorMessage).toBe('missing_phone');
    });

    it('retries without an instance and gives up after the maximum attempts', async () => {
      const { chargeId } = await prepareReminderScenario(ownerA, { instance: false });
      await reminders.generateReminders(today());
      const reminder = await prisma.billingReminder.findFirstOrThrow({ where: { chargeId } });

      await reminders.attemptSend(ownerA.tenantId, reminder.id);
      let current = await prisma.billingReminder.findUniqueOrThrow({ where: { id: reminder.id } });
      expect(current.status).toBe('PENDING');
      expect(current.attempts).toBe(1);
      expect(current.errorMessage).toBe('no_instance');

      await reminders.attemptSend(ownerA.tenantId, reminder.id);
      await reminders.attemptSend(ownerA.tenantId, reminder.id);
      current = await prisma.billingReminder.findUniqueOrThrow({ where: { id: reminder.id } });
      expect(current.status).toBe('FAILED');
      expect(current.attempts).toBe(3);
      expect(evolution.sent).toHaveLength(0);
    });

    it('does not mark a reminder as sent when Evolution fails', async () => {
      const { chargeId } = await prepareReminderScenario(ownerA);
      await reminders.generateReminders(today());
      const reminder = await prisma.billingReminder.findFirstOrThrow({ where: { chargeId } });

      evolution.failWith = new EvolutionRequestError('boom', 500);

      await reminders.attemptSend(ownerA.tenantId, reminder.id);
      let current = await prisma.billingReminder.findUniqueOrThrow({ where: { id: reminder.id } });
      expect(current.status).toBe('PENDING');
      expect(current.errorMessage).toBe('evolution_http_500');
      expect(current.nextAttemptAt).not.toBeNull();

      await reminders.attemptSend(ownerA.tenantId, reminder.id);
      await reminders.attemptSend(ownerA.tenantId, reminder.id);
      current = await prisma.billingReminder.findUniqueOrThrow({ where: { id: reminder.id } });
      expect(current.status).toBe('FAILED');
      expect(evolution.calls).toBe(3);
      expect(evolution.sent).toHaveLength(0);
    });

    it('stops pending reminders when the charge is paid', async () => {
      const { chargeId } = await prepareReminderScenario(ownerA);
      await reminders.generateReminders(today());
      const pending = await prisma.billingReminder.findFirstOrThrow({ where: { chargeId } });
      expect(pending.status).toBe('PENDING');

      const paid = await app.inject({
        method: 'POST',
        url: `/api/billing/charges/${chargeId}/pay`,
        headers: authHeaders(ownerA),
      });
      expect(paid.statusCode).toBe(200);

      const afterPay = await prisma.billingReminder.findUniqueOrThrow({ where: { id: pending.id } });
      expect(afterPay.status).toBe('SKIPPED');
      expect(afterPay.errorMessage).toBe('charge_paid');

      await reminders.attemptSend(ownerA.tenantId, pending.id);
      expect(evolution.sent).toHaveLength(0);

      const history = await app.inject({
        method: 'GET',
        url: `/api/billing/charges/${chargeId}/reminders`,
        headers: authHeaders(ownerA),
      });
      expect(history.statusCode).toBe(200);
      expect(history.json().data).toHaveLength(1);
      expect(history.json().data[0].status).toBe('SKIPPED');
    });
  });

  describe('contact-based charges (the CRM clients)', () => {
    async function createStandaloneContact(
      tenant: SeededTenant,
      name: string,
      phone: string | null,
    ): Promise<string> {
      const contact = await prisma.contact.create({
        data: { tenantId: tenant.tenantId, name, phone, customerId: null },
        select: { id: true },
      });
      return contact.id;
    }

    it('creates a charge for an existing contact without a customer and reminds it', async () => {
      const contactId = await createStandaloneContact(ownerA, 'Ana Souza', '5511911111111');
      await createConnectedInstance(ownerA);
      await updateSettings(ownerA, {
        remindersEnabled: true,
        reminderOffsets: [0],
        sendWindowStartHour: 0,
        sendWindowEndHour: 23,
        messageTemplate: 'Oi {cliente}, {descricao} = {valor}.',
      });

      const created = await createCharge(ownerA, {
        contactId,
        description: 'Mensalidade',
        amountCents: 9900,
        dueDate: today(),
      });

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        customerId: null,
        contactId,
        contactName: 'Ana Souza',
        status: 'PENDING',
      });

      const list = await app.inject({
        method: 'GET',
        url: '/api/billing/charges?status=PENDING',
        headers: authHeaders(ownerA),
      });
      expect(list.json().data[0]).toMatchObject({ contactName: 'Ana Souza' });

      await reminders.runScan();
      expect(evolution.sent).toHaveLength(1);
      expect(evolution.sent[0].number).toBe('5511911111111');
      expect(evolution.sent[0].text).toBe('Oi Ana Souza, Mensalidade = R$ 99,00.');
    });

    it('reuses the customer linked to the contact when present', async () => {
      const customerId = await createCustomer(ownerA, 'Empresa X');
      const contactId = await createContact(ownerA, customerId, '5511922222222');

      const created = await createCharge(ownerA, {
        contactId,
        description: 'Serviço',
        amountCents: 100,
        dueDate: today(),
      });

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ customerId, customerName: 'Empresa X' });
    });

    it('requires a customer or a contact', async () => {
      const response = await createCharge(ownerA, {
        description: 'Sem parte',
        amountCents: 100,
        dueDate: today(),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('BILLING_PARTY_REQUIRED');
    });

    it('never accepts a contact from another tenant', async () => {
      const foreignContactId = await createStandaloneContact(ownerB, 'Foreign', '5511933333333');

      const response = await createCharge(ownerA, {
        contactId: foreignContactId,
        description: 'Cruzado',
        amountCents: 100,
        dueDate: today(),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('BILLING_CONTACT_NOT_FOUND');
    });

    it('still lists contacts through the contacts endpoint', async () => {
      await createStandaloneContact(ownerA, 'Contato Visível', '5511944444444');

      const response = await app.inject({
        method: 'GET',
        url: '/api/contacts',
        headers: authHeaders(ownerA),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.map((item: { name: string }) => item.name)).toContain(
        'Contato Visível',
      );
    });
  });

  describe('manual reminders', () => {
    async function setupCharge(
      tenant: SeededTenant,
      options: { phone?: string | null } = {},
    ): Promise<string> {
      const customerId = await createCustomer(tenant, 'Cobrado Manual');
      if (options.phone !== null) {
        await createContact(tenant, customerId, options.phone ?? '5511999999999');
      }
      const created = await createCharge(tenant, {
        customerId,
        description: 'Mensalidade',
        amountCents: 9900,
        dueDate: today(),
      });
      return created.json().id as string;
    }

    function sendManual(tenant: SeededTenant, chargeId: string, idempotencyKey: string) {
      return app.inject({
        method: 'POST',
        url: `/api/billing/charges/${chargeId}/reminders`,
        headers: authHeaders(tenant),
        payload: { idempotencyKey },
      });
    }

    it('sends a reminder immediately for a pending charge', async () => {
      await createConnectedInstance(ownerA);
      const chargeId = await setupCharge(ownerA);

      const response = await sendManual(ownerA, chargeId, randomUUID());

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        chargeId,
        origin: 'MANUAL',
        createdByUserId: ownerA.userId,
        status: 'SENT',
        destination: '5511999999999',
      });
      expect(response.json().externalMessageId).not.toBeNull();
      expect(evolution.sent).toHaveLength(1);
    });

    it('works even when the automatic automation is disabled', async () => {
      await createConnectedInstance(ownerA);
      await updateSettings(ownerA, { remindersEnabled: false, reminderOffsets: [] });
      const chargeId = await setupCharge(ownerA);

      await reminders.runScan();
      const autoCount = await prisma.billingReminder.count({
        where: { chargeId, origin: 'AUTOMATIC' },
      });

      const response = await sendManual(ownerA, chargeId, randomUUID());

      expect(autoCount).toBe(0);
      expect(response.statusCode).toBe(201);
      expect(response.json().status).toBe('SENT');
      expect(evolution.sent).toHaveLength(1);
    });

    it('blocks paid and canceled charges', async () => {
      await createConnectedInstance(ownerA);
      const paidChargeId = await setupCharge(ownerA);
      await app.inject({
        method: 'POST',
        url: `/api/billing/charges/${paidChargeId}/pay`,
        headers: authHeaders(ownerA),
      });

      const paid = await sendManual(ownerA, paidChargeId, randomUUID());
      expect(paid.statusCode).toBe(409);
      expect(paid.json().code).toBe('BILLING_CHARGE_NOT_SENDABLE');

      const canceledChargeId = await setupCharge(ownerA);
      await app.inject({
        method: 'POST',
        url: `/api/billing/charges/${canceledChargeId}/cancel`,
        headers: authHeaders(ownerA),
      });

      const canceled = await sendManual(ownerA, canceledChargeId, randomUUID());
      expect(canceled.statusCode).toBe(409);
      expect(evolution.sent).toHaveLength(0);
    });

    it('records a skipped reminder when there is no usable phone', async () => {
      await createConnectedInstance(ownerA);
      const chargeId = await setupCharge(ownerA, { phone: null });

      const response = await sendManual(ownerA, chargeId, randomUUID());

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ status: 'SKIPPED', errorMessage: 'missing_phone' });
      expect(evolution.sent).toHaveLength(0);
    });

    it('records a failure when no instance is available', async () => {
      const chargeId = await setupCharge(ownerA);

      const response = await sendManual(ownerA, chargeId, randomUUID());

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ status: 'FAILED', errorMessage: 'no_instance' });
      expect(evolution.sent).toHaveLength(0);
    });

    it('records a failure when Evolution rejects the send', async () => {
      await createConnectedInstance(ownerA);
      const chargeId = await setupCharge(ownerA);
      evolution.failWith = new EvolutionRequestError('boom', 500);

      const response = await sendManual(ownerA, chargeId, randomUUID());

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ status: 'FAILED', errorMessage: 'evolution_http_500' });
      expect(response.json().externalMessageId).toBeNull();
      expect(evolution.sent).toHaveLength(0);
    });

    it('is idempotent for a repeated request with the same key', async () => {
      await createConnectedInstance(ownerA);
      const chargeId = await setupCharge(ownerA);
      const key = randomUUID();

      const first = await sendManual(ownerA, chargeId, key);
      const second = await sendManual(ownerA, chargeId, key);

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(second.json().id).toBe(first.json().id);
      expect(evolution.sent).toHaveLength(1);
      expect(
        await prisma.billingReminder.count({ where: { chargeId, origin: 'MANUAL' } }),
      ).toBe(1);
    });

    it('allows new explicit sends with distinct keys', async () => {
      await createConnectedInstance(ownerA);
      const chargeId = await setupCharge(ownerA);

      await sendManual(ownerA, chargeId, randomUUID());
      await sendManual(ownerA, chargeId, randomUUID());

      expect(evolution.sent).toHaveLength(2);
      expect(
        await prisma.billingReminder.count({ where: { chargeId, origin: 'MANUAL' } }),
      ).toBe(2);
    });

    it('never sends for a charge of another tenant', async () => {
      await createConnectedInstance(ownerB);
      const foreignChargeId = await setupCharge(ownerB);
      await createConnectedInstance(ownerA);

      const response = await sendManual(ownerA, foreignChargeId, randomUUID());

      expect(response.statusCode).toBe(404);
      expect(evolution.sent).toHaveLength(0);
      expect(
        await prisma.billingReminder.count({ where: { chargeId: foreignChargeId } }),
      ).toBe(0);
    });

    it('keeps manual and automatic history separate without duplicating automation', async () => {
      await createConnectedInstance(ownerA);
      await updateSettings(ownerA, {
        remindersEnabled: true,
        reminderOffsets: [0],
        sendWindowStartHour: 0,
        sendWindowEndHour: 23,
      });
      const chargeId = await setupCharge(ownerA);

      await reminders.runScan();
      await sendManual(ownerA, chargeId, randomUUID());
      await reminders.runScan();

      const history = await app.inject({
        method: 'GET',
        url: `/api/billing/charges/${chargeId}/reminders`,
        headers: authHeaders(ownerA),
      });
      const origins = history.json().data.map((item: { origin: string }) => item.origin);
      expect(origins.filter((origin: string) => origin === 'AUTOMATIC')).toHaveLength(1);
      expect(origins.filter((origin: string) => origin === 'MANUAL')).toHaveLength(1);
      expect(evolution.sent).toHaveLength(2);
    });

    it('requires authentication and role', async () => {
      await createConnectedInstance(ownerA);
      const chargeId = await setupCharge(ownerA);

      const anonymous = await app.inject({
        method: 'POST',
        url: `/api/billing/charges/${chargeId}/reminders`,
        payload: { idempotencyKey: randomUUID() },
      });
      expect(anonymous.statusCode).toBe(401);

      const forbidden = await sendManual(userA, chargeId, randomUUID());
      expect(forbidden.statusCode).toBe(403);
    });
  });

  describe('reminder scheduling and send window', () => {
    async function setupChargeOn(dueDate: string, tenant = ownerA): Promise<string> {
      const customerId = await createCustomer(tenant, 'Agendado');
      await createContact(tenant, customerId, '5511988888888');
      const created = await createCharge(tenant, {
        customerId,
        description: 'Agenda',
        amountCents: 1000,
        dueDate,
      });
      return created.json().id as string;
    }

    it('catches up a reminder missed on a previous day but not older ones', async () => {
      await createConnectedInstance(ownerA);
      await updateSettings(ownerA, {
        remindersEnabled: true,
        reminderOffsets: [0],
        sendWindowStartHour: 0,
        sendWindowEndHour: 23,
      });
      const yesterday = await setupChargeOn(addDays(today(), -1));
      const tooOld = await setupChargeOn(addDays(today(), -10));

      await reminders.generateReminders(today());

      const missed = await prisma.billingReminder.findFirst({ where: { chargeId: yesterday } });
      expect(missed).not.toBeNull();
      expect(missed?.scheduledFor.toISOString().slice(0, 10)).toBe(addDays(today(), -1));

      expect(await prisma.billingReminder.findFirst({ where: { chargeId: tooOld } })).toBeNull();
    });

    it('does not send outside the allowed window and re-evaluates later', async () => {
      await createConnectedInstance(ownerA);
      const nowHour = localHour(new Date(), 'America/Sao_Paulo');
      const excludedStart = (nowHour + 4) % 24;
      const excludedEnd = (nowHour + 5) % 24;
      await updateSettings(ownerA, {
        remindersEnabled: true,
        reminderOffsets: [0],
        sendWindowStartHour: excludedStart,
        sendWindowEndHour: excludedEnd,
      });
      const chargeId = await setupChargeOn(today());

      await reminders.runScan();

      expect(evolution.sent).toHaveLength(0);
      const pending = await prisma.billingReminder.findFirstOrThrow({ where: { chargeId } });
      expect(pending.status).toBe('PENDING');

      await updateSettings(ownerA, { sendWindowStartHour: 0, sendWindowEndHour: 23 });
      await reminders.runScan();

      expect(evolution.sent).toHaveLength(1);
      const sent = await prisma.billingReminder.findFirstOrThrow({ where: { chargeId } });
      expect(sent.status).toBe('SENT');
    });

    it('suppresses automatic sends while disabled and resumes after re-enabling', async () => {
      await createConnectedInstance(ownerA);
      await updateSettings(ownerA, {
        remindersEnabled: true,
        reminderOffsets: [0],
        sendWindowStartHour: 0,
        sendWindowEndHour: 23,
      });
      const chargeId = await setupChargeOn(today());
      await reminders.generateReminders(today());
      expect(await prisma.billingReminder.count({ where: { chargeId } })).toBe(1);

      await updateSettings(ownerA, { remindersEnabled: false });
      await reminders.runScan();
      expect(evolution.sent).toHaveLength(0);
      expect(
        (await prisma.billingReminder.findFirstOrThrow({ where: { chargeId } })).status,
      ).toBe('PENDING');

      await updateSettings(ownerA, { remindersEnabled: true });
      await reminders.runScan();
      expect(evolution.sent).toHaveLength(1);
    });

    it('interprets negative, zero and positive offsets', async () => {
      await createConnectedInstance(ownerA);
      await updateSettings(ownerA, {
        remindersEnabled: true,
        reminderOffsets: [-1, 0, 1],
        sendWindowStartHour: 0,
        sendWindowEndHour: 23,
      });
      const chargeId = await setupChargeOn(today());

      await reminders.runScan();

      const rows = await prisma.billingReminder.findMany({ where: { chargeId } });
      const byOffset = new Map(rows.map((row) => [row.offsetDays, row]));

      // -1: target was yesterday, recovered and sent now.
      expect(byOffset.get(-1)?.scheduledFor.toISOString().slice(0, 10)).toBe(addDays(today(), -1));
      expect(byOffset.get(-1)?.status).toBe('SENT');
      // 0: target today, sent now.
      expect(byOffset.get(0)?.status).toBe('SENT');
      // +1: future target, not generated yet.
      expect(byOffset.has(1)).toBe(false);
      expect(evolution.sent).toHaveLength(2);
    });

    it('exposes the real scheduler frequency and time zone', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/billing/settings',
        headers: authHeaders(ownerA),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        scanIntervalMinutes: 5,
        timeZone: 'America/Sao_Paulo',
      });
    });
  });
});
