import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { CreateTagDto, ListTagsQueryDto, UpdateTagDto } from './dto/tag.dto.js';
import { TagNameConflictError, TagNotFoundError } from './tags.errors.js';

export interface TagView {
  id: string;
  name: string;
  color: string | null;
  customerCount: number;
  createdAt: Date;
  updatedAt: Date;
}

type PrismaTag = Prisma.TagGetPayload<{ include: { _count: { select: { customers: true } } } }>;

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(query: ListTagsQueryDto): Promise<PageResult<TagView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.TagWhereInput = { tenantId };

    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    const [total, tags] = await this.prisma.$transaction([
      this.prisma.tag.count({ where }),
      this.prisma.tag.findMany({
        where,
        orderBy: { [query.sort]: query.order },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
        include: { _count: { select: { customers: true } } },
      }),
    ]);

    return buildPage(tags.map(toTagView), total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<TagView> {
    const { tenantId } = this.tenantContext.requireContext();
    const tag = await this.prisma.tag.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { customers: true } } },
    });

    if (!tag) {
      throw new TagNotFoundError();
    }

    return toTagView(tag);
  }

  async create(dto: CreateTagDto): Promise<TagView> {
    const { tenantId } = this.tenantContext.requireContext();

    try {
      const tag = await this.prisma.tag.create({
        data: {
          tenantId,
          name: dto.name.trim(),
          color: dto.color ?? null,
        },
        include: { _count: { select: { customers: true } } },
      });

      return toTagView(tag);
    } catch (error) {
      throw mapNameConflict(error);
    }
  }

  async update(id: string, dto: UpdateTagDto): Promise<TagView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireTag(tenantId, id);

    const data: Prisma.TagUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.color !== undefined) data.color = dto.color;

    try {
      const tag = await this.prisma.tag.update({
        where: { id },
        data,
        include: { _count: { select: { customers: true } } },
      });

      return toTagView(tag);
    } catch (error) {
      throw mapNameConflict(error);
    }
  }

  async remove(id: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();
    const result = await this.prisma.tag.deleteMany({ where: { id, tenantId } });

    if (result.count === 0) {
      throw new TagNotFoundError();
    }
  }

  private async requireTag(tenantId: string, id: string): Promise<void> {
    const existing = await this.prisma.tag.findFirst({ where: { id, tenantId }, select: { id: true } });

    if (!existing) {
      throw new TagNotFoundError();
    }
  }
}

function toTagView(tag: PrismaTag): TagView {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    customerCount: tag._count.customers,
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt,
  };
}

function mapNameConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new TagNameConflictError();
  }

  return error;
}
