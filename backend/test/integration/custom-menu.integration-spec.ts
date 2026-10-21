import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import {
  authHeaders,
  cleanupTenants,
  createTestApp,
  seedMember,
  seedTenant,
  type SeededTenant,
  type TestApp,
} from './crm.helpers.js';

interface GroupPayload {
  id?: string;
  name: string;
  icon?: string | null;
  active?: boolean;
  buttons: Array<{
    id?: string;
    name: string;
    url: string;
    icon?: string | null;
    active?: boolean;
  }>;
}

describe('Custom menu (integration)', () => {
  let context: TestApp;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let ownerA: SeededTenant;
  let userA: SeededTenant;
  let ownerB: SeededTenant;

  beforeAll(async () => {
    context = await createTestApp();
    app = context.app;
    prisma = context.prisma;
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    ownerA = await seedTenant(app, prisma, { name: 'Custom Menu Owner A', role: 'OWNER' });
    userA = await seedMember(app, prisma, ownerA.tenantId, {
      name: 'Custom Menu User A',
      role: 'USER',
    });
    ownerB = await seedTenant(app, prisma, { name: 'Custom Menu Owner B', role: 'OWNER' });
  });

  afterEach(async () => {
    await cleanupTenants(prisma, [ownerA, userA, ownerB]);
  });

  function saveMenu(tenant: SeededTenant, groups: GroupPayload[]) {
    return app.inject({
      method: 'PUT',
      url: '/api/custom-menu',
      headers: authHeaders(tenant),
      payload: { groups },
    });
  }

  function listMenu(tenant: SeededTenant) {
    return app.inject({
      method: 'GET',
      url: '/api/custom-menu',
      headers: authHeaders(tenant),
    });
  }

  function navigation(tenant: SeededTenant) {
    return app.inject({
      method: 'GET',
      url: '/api/custom-menu/navigation',
      headers: authHeaders(tenant),
    });
  }

  describe('CRUD and ordering', () => {
    it('saves groups with buttons and returns them in the configured order', async () => {
      const saved = await saveMenu(ownerA, [
        {
          name: 'Lojas',
          icon: 'store',
          active: true,
          buttons: [
            { name: 'JP Peças', url: 'https://pecas.example.com', icon: 'store', active: true },
            {
              name: 'TI dos Celulares',
              url: 'https://celulares.example.com',
              icon: 'smartphone',
              active: true,
            },
          ],
        },
        {
          name: 'Sistemas',
          icon: 'globe',
          active: true,
          buttons: [{ name: 'ERP', url: 'https://erp.example.com', icon: 'server', active: true }],
        },
      ]);

      expect(saved.statusCode).toBe(200);
      const groups = saved.json().groups as Array<{
        id: string;
        name: string;
        position: number;
        buttons: Array<{ id: string; name: string; position: number }>;
      }>;

      expect(groups.map((group) => group.name)).toEqual(['Lojas', 'Sistemas']);
      expect(groups[0].position).toBe(0);
      expect(groups[1].position).toBe(1);
      expect(groups[0].buttons.map((button) => button.name)).toEqual([
        'JP Peças',
        'TI dos Celulares',
      ]);
      expect(groups[0].buttons.map((button) => button.position)).toEqual([0, 1]);
      expect(groups[0]).not.toHaveProperty('tenantId');
      expect(groups[0].buttons[0]).not.toHaveProperty('tenantId');

      const listed = await listMenu(ownerA);
      expect(listed.statusCode).toBe(200);
      expect(listed.json().groups).toHaveLength(2);
    });

    it('updates, reorders and removes groups and buttons on a new save', async () => {
      const first = await saveMenu(ownerA, [
        {
          name: 'Lojas',
          buttons: [
            { name: 'Loja A', url: 'https://a.example.com' },
            { name: 'Loja B', url: 'https://b.example.com' },
          ],
        },
        {
          name: 'Sistemas',
          buttons: [{ name: 'ERP', url: 'https://erp.example.com' }],
        },
      ]);
      const initialGroups = first.json().groups as Array<{
        id: string;
        buttons: Array<{ id: string }>;
      }>;

      const second = await saveMenu(ownerA, [
        {
          id: initialGroups[1].id,
          name: 'Sistemas internos',
          active: true,
          buttons: [
            {
              id: initialGroups[1].buttons[0].id,
              name: 'ERP novo',
              url: 'https://erp2.example.com',
              active: true,
            },
          ],
        },
        {
          id: initialGroups[0].id,
          name: 'Lojas',
          active: true,
          buttons: [
            {
              id: initialGroups[0].buttons[1].id,
              name: 'Loja B',
              url: 'https://b.example.com',
              active: true,
            },
          ],
        },
      ]);

      expect(second.statusCode).toBe(200);
      const groups = second.json().groups as Array<{
        name: string;
        buttons: Array<{ name: string; url: string }>;
      }>;
      expect(groups.map((group) => group.name)).toEqual(['Sistemas internos', 'Lojas']);
      expect(groups[0].buttons).toEqual([
        expect.objectContaining({ name: 'ERP novo', url: 'https://erp2.example.com' }),
      ]);
      expect(groups[1].buttons.map((button) => button.name)).toEqual(['Loja B']);

      const removedButton = await prisma.customMenuButton.findUnique({
        where: { id: initialGroups[0].buttons[0].id },
      });
      expect(removedButton).toBeNull();
    });

    it('supports individual CRUD endpoints and cascades buttons on group deletion', async () => {
      const createdGroup = await app.inject({
        method: 'POST',
        url: '/api/custom-menu/groups',
        headers: authHeaders(ownerA),
        payload: {
          name: 'Parceiros',
          icon: 'briefcase',
          active: true,
          buttons: [{ name: 'Parceiro', url: 'https://parceiro.example.com' }],
        },
      });
      expect(createdGroup.statusCode).toBe(201);
      const groupId = createdGroup.json().id as string;

      const createdButton = await app.inject({
        method: 'POST',
        url: `/api/custom-menu/groups/${groupId}/buttons`,
        headers: authHeaders(ownerA),
        payload: { name: 'Outro parceiro', url: 'http://parceiro2.example.com', active: true },
      });
      expect(createdButton.statusCode).toBe(201);
      const buttonId = createdButton.json().id as string;

      const updatedGroup = await app.inject({
        method: 'PATCH',
        url: `/api/custom-menu/groups/${groupId}`,
        headers: authHeaders(ownerA),
        payload: { name: 'Parceiros atualizados', active: false, position: 4 },
      });
      expect(updatedGroup.statusCode).toBe(200);
      expect(updatedGroup.json()).toMatchObject({
        name: 'Parceiros atualizados',
        active: false,
        position: 4,
      });

      const updatedButton = await app.inject({
        method: 'PATCH',
        url: `/api/custom-menu/buttons/${buttonId}`,
        headers: authHeaders(ownerA),
        payload: { name: 'Parceiro editado', icon: 'globe', active: false },
      });
      expect(updatedButton.statusCode).toBe(200);
      expect(updatedButton.json()).toMatchObject({
        name: 'Parceiro editado',
        icon: 'globe',
        active: false,
      });

      const removedButton = await app.inject({
        method: 'DELETE',
        url: `/api/custom-menu/buttons/${buttonId}`,
        headers: authHeaders(ownerA),
      });
      expect(removedButton.statusCode).toBe(204);

      const removedGroup = await app.inject({
        method: 'DELETE',
        url: `/api/custom-menu/groups/${groupId}`,
        headers: authHeaders(ownerA),
      });
      expect(removedGroup.statusCode).toBe(204);

      const remainingButtons = await prisma.customMenuButton.count({
        where: { tenantId: ownerA.tenantId },
      });
      expect(remainingButtons).toBe(0);
    });
  });

  describe('navigation', () => {
    it('returns only active groups with active buttons and ignores empty groups', async () => {
      await saveMenu(ownerA, [
        {
          name: 'Ativo',
          active: true,
          buttons: [
            { name: 'Visível', url: 'https://visible.example.com', active: true },
            { name: 'Oculto', url: 'https://hidden.example.com', active: false },
          ],
        },
        {
          name: 'Inativo',
          active: false,
          buttons: [{ name: 'Botão inativo', url: 'https://inactive.example.com', active: true }],
        },
        {
          name: 'Sem botões ativos',
          active: true,
          buttons: [{ name: 'Oculto', url: 'https://hidden2.example.com', active: false }],
        },
        {
          name: 'Vazio',
          active: true,
          buttons: [],
        },
      ]);

      const response = await navigation(ownerA);
      expect(response.statusCode).toBe(200);

      const groups = response.json().groups as Array<{
        name: string;
        buttons: Array<{ name: string }>;
      }>;
      expect(groups).toHaveLength(1);
      expect(groups[0].name).toBe('Ativo');
      expect(groups[0].buttons.map((button) => button.name)).toEqual(['Visível']);

      const fullList = await listMenu(ownerA);
      expect(fullList.json().groups).toHaveLength(4);
    });
  });

  describe('validation and security', () => {
    it('rejects blank names, unsafe protocols and unknown fields', async () => {
      const blankGroup = await saveMenu(ownerA, [
        { name: '   ', buttons: [{ name: 'Site', url: 'https://example.com' }] },
      ]);
      expect(blankGroup.statusCode).toBe(400);

      const blankButton = await saveMenu(ownerA, [
        { name: 'Lojas', buttons: [{ name: ' ', url: 'https://example.com' }] },
      ]);
      expect(blankButton.statusCode).toBe(400);

      for (const url of [
        'javascript:alert(1)',
        'data:text/html,<h1>x</h1>',
        'file:///etc/passwd',
        'ftp://example.com',
        'not-a-url',
      ]) {
        const response = await saveMenu(ownerA, [
          { name: 'Lojas', buttons: [{ name: 'Site', url }] },
        ]);
        expect(response.statusCode).toBe(400);
      }

      const unknownIcon = await saveMenu(ownerA, [
        {
          name: 'Lojas',
          icon: 'not-a-real-icon',
          buttons: [{ name: 'Site', url: 'https://example.com' }],
        },
      ]);
      expect(unknownIcon.statusCode).toBe(400);

      const unknownField = await app.inject({
        method: 'PUT',
        url: '/api/custom-menu',
        headers: authHeaders(ownerA),
        payload: {
          groups: [],
          tenantId: ownerB.tenantId,
        },
      });
      expect(unknownField.statusCode).toBe(400);
    });

    it('allows users to read but rejects mutations by a USER role', async () => {
      await saveMenu(ownerA, [
        { name: 'Lojas', buttons: [{ name: 'Site', url: 'https://example.com' }] },
      ]);

      expect((await listMenu(userA)).statusCode).toBe(200);
      expect((await navigation(userA)).statusCode).toBe(200);
      expect((await saveMenu(userA, [])).statusCode).toBe(403);

      const createGroup = await app.inject({
        method: 'POST',
        url: '/api/custom-menu/groups',
        headers: authHeaders(userA),
        payload: { name: 'Novo', buttons: [] },
      });
      expect(createGroup.statusCode).toBe(403);
    });
  });

  describe('tenant isolation', () => {
    it('never reads or mutates another tenant menu', async () => {
      const fromB = await saveMenu(ownerB, [
        {
          name: 'Só do B',
          active: true,
          buttons: [{ name: 'Site B', url: 'https://b.example.com', active: true }],
        },
      ]);
      const groupB = (
        fromB.json().groups as Array<{ id: string; buttons: Array<{ id: string }> }>
      )[0];

      const listA = await listMenu(ownerA);
      expect(listA.json().groups).toHaveLength(0);
      expect((await navigation(ownerA)).json().groups).toHaveLength(0);

      const updateAsA = await app.inject({
        method: 'PATCH',
        url: `/api/custom-menu/groups/${groupB.id}`,
        headers: authHeaders(ownerA),
        payload: { name: 'hacked' },
      });
      expect(updateAsA.statusCode).toBe(404);

      const updateButtonAsA = await app.inject({
        method: 'PATCH',
        url: `/api/custom-menu/buttons/${groupB.buttons[0].id}`,
        headers: authHeaders(ownerA),
        payload: { name: 'hacked' },
      });
      expect(updateButtonAsA.statusCode).toBe(404);

      const deleteAsA = await app.inject({
        method: 'DELETE',
        url: `/api/custom-menu/groups/${groupB.id}`,
        headers: authHeaders(ownerA),
      });
      expect(deleteAsA.statusCode).toBe(404);

      const saveAsA = await saveMenu(ownerA, [
        {
          id: groupB.id,
          name: 'hacked',
          buttons: [],
        },
      ]);
      expect(saveAsA.statusCode).toBe(404);

      const untouched = await prisma.customMenuGroup.findUnique({ where: { id: groupB.id } });
      expect(untouched?.name).toBe('Só do B');
    });
  });
});
