import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  CustomMenuButtonNotFoundError,
  CustomMenuGroupNotFoundError,
  InvalidCustomMenuPayloadError,
} from './custom-menu.errors.js';
import type {
  CreateCustomMenuButtonDto,
  CreateCustomMenuGroupDto,
  SaveCustomMenuDto,
  UpdateCustomMenuButtonDto,
  UpdateCustomMenuGroupDto,
} from './dto/custom-menu.dto.js';

export interface CustomMenuButtonView {
  id: string;
  name: string;
  url: string;
  icon: string | null;
  active: boolean;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomMenuGroupView {
  id: string;
  name: string;
  icon: string | null;
  active: boolean;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  buttons: CustomMenuButtonView[];
}

const BUTTON_SELECT = {
  id: true,
  name: true,
  url: true,
  icon: true,
  active: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CustomMenuButtonSelect;

const BUTTON_ORDER_BY = [
  { position: 'asc' },
  { createdAt: 'asc' },
] satisfies Prisma.CustomMenuButtonOrderByWithRelationInput[];

const GROUP_SELECT = {
  id: true,
  name: true,
  icon: true,
  active: true,
  position: true,
  createdAt: true,
  updatedAt: true,
  buttons: {
    orderBy: BUTTON_ORDER_BY,
    select: BUTTON_SELECT,
  },
} satisfies Prisma.CustomMenuGroupSelect;

const NAVIGATION_GROUP_SELECT = {
  ...GROUP_SELECT,
  buttons: {
    where: { active: true },
    orderBy: BUTTON_ORDER_BY,
    select: BUTTON_SELECT,
  },
} satisfies Prisma.CustomMenuGroupSelect;

const GROUP_ORDER_BY = [
  { position: 'asc' },
  { createdAt: 'asc' },
] satisfies Prisma.CustomMenuGroupOrderByWithRelationInput[];

type PrismaCustomMenuGroup = Prisma.CustomMenuGroupGetPayload<{ select: typeof GROUP_SELECT }>;
type PrismaCustomMenuButton = Prisma.CustomMenuButtonGetPayload<{ select: typeof BUTTON_SELECT }>;

@Injectable()
export class CustomMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(): Promise<{ groups: CustomMenuGroupView[] }> {
    const { tenantId } = this.tenantContext.requireContext();
    const groups = await this.prisma.customMenuGroup.findMany({
      where: { tenantId },
      orderBy: GROUP_ORDER_BY,
      select: GROUP_SELECT,
    });

    return { groups: groups.map(toGroupView) };
  }

  async navigation(): Promise<{ groups: CustomMenuGroupView[] }> {
    const { tenantId } = this.tenantContext.requireContext();
    const groups = await this.prisma.customMenuGroup.findMany({
      where: {
        tenantId,
        active: true,
        buttons: { some: { active: true } },
      },
      orderBy: GROUP_ORDER_BY,
      select: NAVIGATION_GROUP_SELECT,
    });

    return { groups: groups.map(toGroupView) };
  }

  async createGroup(dto: CreateCustomMenuGroupDto): Promise<CustomMenuGroupView> {
    const { tenantId } = this.tenantContext.requireContext();

    return this.prisma.$transaction(async (tx) => {
      const position = dto.position ?? (await nextGroupPosition(tx, tenantId));
      const group = await tx.customMenuGroup.create({
        data: {
          tenantId,
          name: dto.name,
          icon: dto.icon ?? null,
          active: dto.active,
          position,
          buttons: {
            create: (dto.buttons ?? []).map((button, index) => ({
              tenantId,
              name: button.name,
              url: button.url,
              icon: button.icon ?? null,
              active: button.active,
              position: index,
            })),
          },
        },
        select: GROUP_SELECT,
      });

      return toGroupView(group);
    });
  }

  async updateGroup(id: string, dto: UpdateCustomMenuGroupDto): Promise<CustomMenuGroupView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireGroup(tenantId, id);

    const data: Prisma.CustomMenuGroupUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.icon !== undefined) data.icon = dto.icon;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.position !== undefined) data.position = dto.position;

    await this.prisma.customMenuGroup.update({ where: { id }, data });

    return this.findGroup(tenantId, id);
  }

  async removeGroup(id: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();
    const result = await this.prisma.customMenuGroup.deleteMany({ where: { id, tenantId } });

    if (result.count === 0) {
      throw new CustomMenuGroupNotFoundError();
    }
  }

  async createButton(
    groupId: string,
    dto: CreateCustomMenuButtonDto,
  ): Promise<CustomMenuButtonView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireGroup(tenantId, groupId);

    return this.prisma.$transaction(async (tx) => {
      const position = dto.position ?? (await nextButtonPosition(tx, tenantId, groupId));
      const button = await tx.customMenuButton.create({
        data: {
          tenantId,
          groupId,
          name: dto.name,
          url: dto.url,
          icon: dto.icon ?? null,
          active: dto.active,
          position,
        },
        select: BUTTON_SELECT,
      });

      return toButtonView(button);
    });
  }

  async updateButton(id: string, dto: UpdateCustomMenuButtonDto): Promise<CustomMenuButtonView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireButton(tenantId, id);

    const data: Prisma.CustomMenuButtonUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.url !== undefined) data.url = dto.url;
    if (dto.icon !== undefined) data.icon = dto.icon;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.position !== undefined) data.position = dto.position;

    return this.prisma.customMenuButton
      .update({ where: { id }, data, select: BUTTON_SELECT })
      .then(toButtonView);
  }

  async removeButton(id: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();
    const result = await this.prisma.customMenuButton.deleteMany({ where: { id, tenantId } });

    if (result.count === 0) {
      throw new CustomMenuButtonNotFoundError();
    }
  }

  async save(dto: SaveCustomMenuDto): Promise<{ groups: CustomMenuGroupView[] }> {
    const { tenantId } = this.tenantContext.requireContext();

    return this.prisma.$transaction(async (tx) => {
      const existingGroups = await tx.customMenuGroup.findMany({
        where: { tenantId },
        select: {
          id: true,
          buttons: { select: { id: true, groupId: true } },
        },
      });

      const existingGroupIds = new Set(existingGroups.map((group) => group.id));
      const existingButtons = new Map(
        existingGroups.flatMap((group) =>
          group.buttons.map((button) => [button.id, button] as const),
        ),
      );

      assertPayloadIds(dto, existingGroupIds, existingButtons);

      const desiredGroupIds = new Set(dto.groups.flatMap((group) => (group.id ? [group.id] : [])));
      const groupsToDelete = existingGroups
        .filter((group) => !desiredGroupIds.has(group.id))
        .map((group) => group.id);

      if (groupsToDelete.length > 0) {
        await tx.customMenuGroup.deleteMany({
          where: { tenantId, id: { in: groupsToDelete } },
        });
      }

      for (const [groupIndex, groupInput] of dto.groups.entries()) {
        const groupId = groupInput.id
          ? await updateGroupInTransaction(tx, groupInput.id, groupInput, groupIndex)
          : await createGroupInTransaction(tx, tenantId, groupInput, groupIndex);

        const existingForGroup = existingGroups.find((group) => group.id === groupId);
        const desiredButtonIds = new Set(
          groupInput.buttons.flatMap((button) => (button.id ? [button.id] : [])),
        );

        if (existingForGroup) {
          const buttonsToDelete = existingForGroup.buttons
            .filter((button) => !desiredButtonIds.has(button.id))
            .map((button) => button.id);

          if (buttonsToDelete.length > 0) {
            await tx.customMenuButton.deleteMany({
              where: { tenantId, groupId, id: { in: buttonsToDelete } },
            });
          }
        }

        for (const [buttonIndex, buttonInput] of groupInput.buttons.entries()) {
          if (buttonInput.id) {
            await tx.customMenuButton.update({
              where: { id: buttonInput.id },
              data: {
                name: buttonInput.name,
                url: buttonInput.url,
                icon: buttonInput.icon ?? null,
                active: buttonInput.active,
                position: buttonIndex,
              },
            });
          } else {
            await tx.customMenuButton.create({
              data: {
                tenantId,
                groupId,
                name: buttonInput.name,
                url: buttonInput.url,
                icon: buttonInput.icon ?? null,
                active: buttonInput.active,
                position: buttonIndex,
              },
            });
          }
        }
      }

      const groups = await tx.customMenuGroup.findMany({
        where: { tenantId },
        orderBy: GROUP_ORDER_BY,
        select: GROUP_SELECT,
      });

      return { groups: groups.map(toGroupView) };
    });
  }

  private async requireGroup(tenantId: string, id: string): Promise<void> {
    const group = await this.prisma.customMenuGroup.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });

    if (!group) {
      throw new CustomMenuGroupNotFoundError();
    }
  }

  private async requireButton(tenantId: string, id: string): Promise<void> {
    const button = await this.prisma.customMenuButton.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });

    if (!button) {
      throw new CustomMenuButtonNotFoundError();
    }
  }

  private async findGroup(tenantId: string, id: string): Promise<CustomMenuGroupView> {
    const group = await this.prisma.customMenuGroup.findFirst({
      where: { id, tenantId },
      select: GROUP_SELECT,
    });

    if (!group) {
      throw new CustomMenuGroupNotFoundError();
    }

    return toGroupView(group);
  }
}

async function nextGroupPosition(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
  const aggregate = await tx.customMenuGroup.aggregate({
    where: { tenantId },
    _max: { position: true },
  });

  return (aggregate._max.position ?? -1) + 1;
}

async function nextButtonPosition(
  tx: Prisma.TransactionClient,
  tenantId: string,
  groupId: string,
): Promise<number> {
  const aggregate = await tx.customMenuButton.aggregate({
    where: { tenantId, groupId },
    _max: { position: true },
  });

  return (aggregate._max.position ?? -1) + 1;
}

function assertPayloadIds(
  dto: SaveCustomMenuDto,
  existingGroupIds: Set<string>,
  existingButtons: Map<string, { id: string; groupId: string }>,
): void {
  const groupIds = dto.groups.flatMap((group) => (group.id ? [group.id] : []));
  if (new Set(groupIds).size !== groupIds.length) {
    throw new InvalidCustomMenuPayloadError('Grupos duplicados no menu personalizado');
  }

  for (const group of dto.groups) {
    if (group.id && !existingGroupIds.has(group.id)) {
      throw new CustomMenuGroupNotFoundError();
    }

    for (const button of group.buttons) {
      if (!button.id) {
        continue;
      }

      const existing = existingButtons.get(button.id);
      if (!existing) {
        throw new CustomMenuButtonNotFoundError();
      }

      if (!group.id || existing.groupId !== group.id) {
        throw new InvalidCustomMenuPayloadError(
          'Um botão não pode ser movido entre grupos na mesma operação',
        );
      }
    }
  }

  const buttonIds = dto.groups.flatMap((group) =>
    group.buttons.flatMap((button) => (button.id ? [button.id] : [])),
  );
  if (new Set(buttonIds).size !== buttonIds.length) {
    throw new InvalidCustomMenuPayloadError('Botões duplicados no menu personalizado');
  }
}

type GroupInput = SaveCustomMenuDto['groups'][number];

async function createGroupInTransaction(
  tx: Prisma.TransactionClient,
  tenantId: string,
  group: GroupInput,
  position: number,
): Promise<string> {
  const created = await tx.customMenuGroup.create({
    data: {
      tenantId,
      name: group.name,
      icon: group.icon ?? null,
      active: group.active,
      position,
    },
    select: { id: true },
  });

  return created.id;
}

async function updateGroupInTransaction(
  tx: Prisma.TransactionClient,
  id: string,
  group: GroupInput,
  position: number,
): Promise<string> {
  await tx.customMenuGroup.update({
    where: { id },
    data: {
      name: group.name,
      icon: group.icon ?? null,
      active: group.active,
      position,
    },
  });

  return id;
}

function toGroupView(group: PrismaCustomMenuGroup): CustomMenuGroupView {
  return {
    id: group.id,
    name: group.name,
    icon: group.icon,
    active: group.active,
    position: group.position,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    buttons: group.buttons.map(toButtonView),
  };
}

function toButtonView(button: PrismaCustomMenuButton): CustomMenuButtonView {
  return {
    id: button.id,
    name: button.name,
    url: button.url,
    icon: button.icon,
    active: button.active,
    position: button.position,
    createdAt: button.createdAt,
    updatedAt: button.updatedAt,
  };
}
