import { Injectable } from '@nestjs/common';
import { DataSensitivityLevel, Prisma } from '@prisma/client';
import type { QualificationProfile } from '@prisma/client';
import { buildPage, skipOf, type PageResult } from '../../common/http/pagination.js';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type {
  CreateQualificationProfileDto,
  ListQualificationProfilesQueryDto,
  UpdateQualificationProfileDto,
} from './dto/qualification-profile.dto.js';
import { DEFAULT_PRIVACY_NOTICE } from './qualification-profiles.constants.js';
import { QualificationProfileNotFoundError } from './qualification-profiles.errors.js';

export interface ProfileItemView {
  key: string;
  label: string;
  description?: string;
}

export interface RequiredInformationItemView extends ProfileItemView {
  required?: boolean;
}

export interface CriterionItemView extends ProfileItemView {
  weight?: number;
}

export interface QualificationProfileView {
  id: string;
  name: string;
  description: string | null;
  businessContext: string | null;
  botName: string | null;
  initialMessage: string | null;
  privacyNoticeText: string | null;
  tone: string | null;
  objective: string | null;
  requiredInformation: RequiredInformationItemView[];
  qualificationCriteria: CriterionItemView[];
  disqualificationCriteria: CriterionItemView[];
  completionCriteria: ProfileItemView[];
  customInstructions: string | null;
  qualifiedMessage: string | null;
  disqualifiedMessage: string | null;
  needsHumanMessage: string | null;
  humanHandoffRules: ProfileItemView[];
  qualificationLevels: ProfileItemView[];
  dataSensitivityLevel: DataSensitivityLevel;
  isDefault: boolean;
  active: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class QualificationProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(
    query: ListQualificationProfilesQueryDto,
  ): Promise<PageResult<QualificationProfileView>> {
    const { tenantId } = this.tenantContext.requireContext();
    const where: Prisma.QualificationProfileWhereInput = { tenantId };

    if (query.active !== undefined) {
      where.active = query.active;
    }

    if (query.isDefault !== undefined) {
      where.isDefault = query.isDefault;
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, profiles] = await this.prisma.$transaction([
      this.prisma.qualificationProfile.count({ where }),
      this.prisma.qualificationProfile.findMany({
        where,
        orderBy: { [query.sort]: query.order },
        skip: skipOf(query.page, query.perPage),
        take: query.perPage,
      }),
    ]);

    return buildPage(profiles.map(toProfileView), total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<QualificationProfileView> {
    const { tenantId } = this.tenantContext.requireContext();
    const profile = await this.prisma.qualificationProfile.findFirst({ where: { id, tenantId } });

    if (!profile) {
      throw new QualificationProfileNotFoundError();
    }

    return toProfileView(profile);
  }

  async create(dto: CreateQualificationProfileDto): Promise<QualificationProfileView> {
    const { tenantId } = this.tenantContext.requireContext();
    const active = dto.active ?? true;
    const isDefault = (dto.isDefault ?? false) && active;

    const data: Prisma.QualificationProfileUncheckedCreateInput = {
      ...buildScalarFields(dto),
      tenantId,
      name: dto.name.trim(),
      active,
      isDefault,
      version: 1,
      privacyNoticeText: resolvePrivacyNotice(dto.privacyNoticeText, active) ?? null,
    };

    const created = await this.prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.qualificationProfile.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.qualificationProfile.create({ data });
    });

    return toProfileView(created);
  }

  async update(id: string, dto: UpdateQualificationProfileDto): Promise<QualificationProfileView> {
    const { tenantId } = this.tenantContext.requireContext();
    const existing = await this.prisma.qualificationProfile.findFirst({ where: { id, tenantId } });

    if (!existing) {
      throw new QualificationProfileNotFoundError();
    }

    const active = dto.active ?? existing.active;
    const data: Prisma.QualificationProfileUncheckedUpdateInput = { ...buildScalarFields(dto) };

    data.active = active;

    if (dto.isDefault !== undefined) {
      data.isDefault = dto.isDefault && active;
    } else if (!active) {
      data.isDefault = false;
    }

    if (dto.privacyNoticeText !== undefined) {
      data.privacyNoticeText = resolvePrivacyNotice(dto.privacyNoticeText, active) ?? null;
    } else if (active && !existing.privacyNoticeText) {
      data.privacyNoticeText = DEFAULT_PRIVACY_NOTICE;
    }

    if (hasContentChanges(dto)) {
      data.version = { increment: 1 };
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx.qualificationProfile.updateMany({
          where: { tenantId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      await tx.qualificationProfile.update({ where: { id }, data });
    });

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const { tenantId } = this.tenantContext.requireContext();
    const result = await this.prisma.qualificationProfile.deleteMany({ where: { id, tenantId } });

    if (result.count === 0) {
      throw new QualificationProfileNotFoundError();
    }
  }
}

const CONTENT_FIELDS: readonly string[] = [
  'name',
  'description',
  'businessContext',
  'botName',
  'initialMessage',
  'privacyNoticeText',
  'tone',
  'objective',
  'requiredInformation',
  'qualificationCriteria',
  'disqualificationCriteria',
  'completionCriteria',
  'customInstructions',
  'qualifiedMessage',
  'disqualifiedMessage',
  'needsHumanMessage',
  'humanHandoffRules',
  'qualificationLevels',
  'dataSensitivityLevel',
];

function hasContentChanges(dto: UpdateQualificationProfileDto): boolean {
  const values = dto as unknown as Record<string, unknown>;
  return CONTENT_FIELDS.some((field) => values[field] !== undefined);
}

interface ProfileScalarFields {
  description?: string | null;
  businessContext?: string | null;
  botName?: string | null;
  initialMessage?: string | null;
  tone?: string | null;
  objective?: string | null;
  customInstructions?: string | null;
  qualifiedMessage?: string | null;
  disqualifiedMessage?: string | null;
  needsHumanMessage?: string | null;
  dataSensitivityLevel?: DataSensitivityLevel;
  requiredInformation?: Prisma.InputJsonValue;
  qualificationCriteria?: Prisma.InputJsonValue;
  disqualificationCriteria?: Prisma.InputJsonValue;
  completionCriteria?: Prisma.InputJsonValue;
  humanHandoffRules?: Prisma.InputJsonValue;
  qualificationLevels?: Prisma.InputJsonValue;
}

function buildScalarFields(
  dto: CreateQualificationProfileDto | UpdateQualificationProfileDto,
): ProfileScalarFields {
  const data: ProfileScalarFields = {};

  if (dto.description !== undefined) data.description = normalizeOptionalText(dto.description);
  if (dto.businessContext !== undefined) {
    data.businessContext = normalizeOptionalText(dto.businessContext);
  }
  if (dto.botName !== undefined) data.botName = normalizeOptionalText(dto.botName);
  if (dto.initialMessage !== undefined) data.initialMessage = normalizeOptionalText(dto.initialMessage);
  if (dto.tone !== undefined) data.tone = normalizeOptionalText(dto.tone);
  if (dto.objective !== undefined) data.objective = normalizeOptionalText(dto.objective);
  if (dto.customInstructions !== undefined) {
    data.customInstructions = normalizeOptionalText(dto.customInstructions);
  }
  if (dto.qualifiedMessage !== undefined) {
    data.qualifiedMessage = normalizeOptionalText(dto.qualifiedMessage);
  }
  if (dto.disqualifiedMessage !== undefined) {
    data.disqualifiedMessage = normalizeOptionalText(dto.disqualifiedMessage);
  }
  if (dto.needsHumanMessage !== undefined) {
    data.needsHumanMessage = normalizeOptionalText(dto.needsHumanMessage);
  }
  if (dto.dataSensitivityLevel !== undefined) {
    data.dataSensitivityLevel = dto.dataSensitivityLevel;
  }

  if (dto.requiredInformation !== undefined) {
    data.requiredInformation = toJson(dto.requiredInformation);
  }
  if (dto.qualificationCriteria !== undefined) {
    data.qualificationCriteria = toJson(dto.qualificationCriteria);
  }
  if (dto.disqualificationCriteria !== undefined) {
    data.disqualificationCriteria = toJson(dto.disqualificationCriteria);
  }
  if (dto.completionCriteria !== undefined) {
    data.completionCriteria = toJson(dto.completionCriteria);
  }
  if (dto.humanHandoffRules !== undefined) {
    data.humanHandoffRules = toJson(dto.humanHandoffRules);
  }
  if (dto.qualificationLevels !== undefined) {
    data.qualificationLevels = toJson(dto.qualificationLevels);
  }

  return data;
}

function toJson(value: unknown[]): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function resolvePrivacyNotice(
  value: string | null | undefined,
  active: boolean,
): string | null | undefined {
  if (value === undefined) {
    return active ? DEFAULT_PRIVACY_NOTICE : null;
  }

  const trimmed = (value ?? '').trim();
  if (trimmed.length > 0) {
    return trimmed;
  }

  return active ? DEFAULT_PRIVACY_NOTICE : null;
}

function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asItems<T>(value: Prisma.JsonValue): T[] {
  return Array.isArray(value) ? (value as unknown as T[]) : [];
}

function toProfileView(profile: QualificationProfile): QualificationProfileView {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    businessContext: profile.businessContext,
    botName: profile.botName,
    initialMessage: profile.initialMessage,
    privacyNoticeText: profile.privacyNoticeText,
    tone: profile.tone,
    objective: profile.objective,
    requiredInformation: asItems<RequiredInformationItemView>(profile.requiredInformation),
    qualificationCriteria: asItems<CriterionItemView>(profile.qualificationCriteria),
    disqualificationCriteria: asItems<CriterionItemView>(profile.disqualificationCriteria),
    completionCriteria: asItems<ProfileItemView>(profile.completionCriteria),
    customInstructions: profile.customInstructions,
    qualifiedMessage: profile.qualifiedMessage,
    disqualifiedMessage: profile.disqualifiedMessage,
    needsHumanMessage: profile.needsHumanMessage,
    humanHandoffRules: asItems<ProfileItemView>(profile.humanHandoffRules),
    qualificationLevels: asItems<ProfileItemView>(profile.qualificationLevels),
    dataSensitivityLevel: profile.dataSensitivityLevel,
    isDefault: profile.isDefault,
    active: profile.active,
    version: profile.version,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
