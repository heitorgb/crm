import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type {
  CreateQuickReplyDto,
  ListQuickRepliesQueryDto,
  UpdateQuickReplyDto,
} from './dto/quick-reply.dto.js';
import { QuickReplyNotFoundError, QuickReplyTitleConflictError } from './quick-replies.errors.js';

export interface QuickReplyView {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

const QUICK_REPLY_SELECT = {
  id: true,
  title: true,
  content: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.QuickReplySelect;

type PrismaQuickReply = Prisma.QuickReplyGetPayload<{ select: typeof QUICK_REPLY_SELECT }>;

@Injectable()
export class QuickRepliesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(query: ListQuickRepliesQueryDto): Promise<PageResult<QuickReplyView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.QuickReplyWhereInput = { tenantId };

    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { content: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, quickReplies] = await this.prisma.$transaction([
      this.prisma.quickReply.count({ where }),
      this.prisma.quickReply.findMany({
        where,
        orderBy: { [query.sort]: query.order },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
        select: QUICK_REPLY_SELECT,
      }),
    ]);

    return buildPage(quickReplies.map(toQuickReplyView), total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<QuickReplyView> {
    const { tenantId } = this.tenantContext.requireContext();
    const quickReply = await this.prisma.quickReply.findFirst({
      where: { id, tenantId },
      select: QUICK_REPLY_SELECT,
    });

    if (!quickReply) {
      throw new QuickReplyNotFoundError();
    }

    return toQuickReplyView(quickReply);
  }

  async create(dto: CreateQuickReplyDto): Promise<QuickReplyView> {
    const { tenantId } = this.tenantContext.requireContext();

    try {
      const quickReply = await this.prisma.quickReply.create({
        data: {
          tenantId,
          title: dto.title.trim(),
          content: dto.content.trim(),
        },
        select: QUICK_REPLY_SELECT,
      });

      return toQuickReplyView(quickReply);
    } catch (error) {
      throw mapTitleConflict(error);
    }
  }

  async update(id: string, dto: UpdateQuickReplyDto): Promise<QuickReplyView> {
    const { tenantId } = this.tenantContext.requireContext();
    await this.requireQuickReply(tenantId, id);

    const data: Prisma.QuickReplyUncheckedUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.content !== undefined) data.content = dto.content.trim();

    try {
      const quickReply = await this.prisma.quickReply.update({
        where: { id },
        data,
        select: QUICK_REPLY_SELECT,
      });

      return toQuickReplyView(quickReply);
    } catch (error) {
      throw mapTitleConflict(error);
    }
  }

  async remove(id: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();
    const result = await this.prisma.quickReply.deleteMany({ where: { id, tenantId } });

    if (result.count === 0) {
      throw new QuickReplyNotFoundError();
    }
  }

  private async requireQuickReply(tenantId: string, id: string): Promise<void> {
    const existing = await this.prisma.quickReply.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });

    if (!existing) {
      throw new QuickReplyNotFoundError();
    }
  }
}

function toQuickReplyView(quickReply: PrismaQuickReply): QuickReplyView {
  return {
    id: quickReply.id,
    title: quickReply.title,
    content: quickReply.content,
    createdAt: quickReply.createdAt,
    updatedAt: quickReply.updatedAt,
  };
}

function mapTitleConflict(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new QuickReplyTitleConflictError();
  }

  return error;
}
