import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Tenant } from '@prisma/client';
import { TenantContextService } from '../../common/tenant-context/tenant-context.service.js';
import type { Env } from '../../config/env.validation.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type {
  AcceptLegalDocumentsDto,
  UpdateDpoSettingsDto,
  UpdateRetentionSettingsDto,
} from './dto/compliance.dto.js';

export interface DpoContactView {
  name: string;
  email: string;
  configuredByTenant: boolean;
}

export interface LegalSettingsView {
  current: { termsVersion: string; dpaVersion: string };
  tenant: {
    termsVersion: string | null;
    termsAcceptedAt: Date | null;
    dpaVersion: string | null;
    dpaAcceptedAt: Date | null;
  };
}

export interface ComplianceSettingsView {
  dpo: DpoContactView;
  retention: { conversationDays: number; leadDays: number };
  legal: LegalSettingsView;
}

@Injectable()
export class ComplianceSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async getSettings(): Promise<ComplianceSettingsView> {
    const { tenantId } = this.tenantContext.requireContext();
    const tenant = await this.requireTenant(tenantId);
    return toSettingsView(tenant, this.fallbackDpo(), this.platformVersions());
  }

  async updateDpo(dto: UpdateDpoSettingsDto): Promise<ComplianceSettingsView> {
    const { tenantId } = this.tenantContext.requireContext();
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.name !== undefined ? { dpoName: normalize(dto.name) } : {}),
        ...(dto.email !== undefined ? { dpoEmail: normalize(dto.email) } : {}),
      },
    });
    return toSettingsView(tenant, this.fallbackDpo(), this.platformVersions());
  }

  async updateRetention(dto: UpdateRetentionSettingsDto): Promise<ComplianceSettingsView> {
    const { tenantId } = this.tenantContext.requireContext();
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.conversationDays !== undefined
          ? { retentionConversationDays: dto.conversationDays }
          : {}),
        ...(dto.leadDays !== undefined ? { retentionLeadDays: dto.leadDays } : {}),
      },
    });
    return toSettingsView(tenant, this.fallbackDpo(), this.platformVersions());
  }

  async acceptLegalDocuments(dto: AcceptLegalDocumentsDto): Promise<ComplianceSettingsView> {
    const { tenantId } = this.tenantContext.requireContext();
    const now = new Date();
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        termsVersion: dto.termsVersion,
        termsAcceptedAt: now,
        dpaVersion: dto.dpaVersion,
        dpaAcceptedAt: now,
      },
    });
    return toSettingsView(tenant, this.fallbackDpo(), this.platformVersions());
  }

  /** Public lookup used to answer data subjects; tenant id alone is not sensitive. */
  async getPublicDpo(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, dpoName: true, dpoEmail: true },
    });

    if (!tenant) {
      return null;
    }

    const configured = Boolean(tenant.dpoName && tenant.dpoEmail);
    const fallback = this.fallbackDpo();

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      controller: 'tenant',
      dpo: configured
        ? { name: tenant.dpoName as string, email: tenant.dpoEmail as string, configuredByTenant: true }
        : { ...fallback, configuredByTenant: false },
      note: configured
        ? 'O tenant é o Controlador dos dados; o contato acima é o Encarregado indicado por ele.'
        : 'O tenant é o Controlador e ainda não indicou Encarregado; este canal é o suporte técnico da OrderUp, não substitui o Controlador.',
    };
  }

  platformVersions(): { termsVersion: string; dpaVersion: string } {
    return {
      termsVersion: this.config.get('LEGAL_TERMS_VERSION') ?? '2026-01',
      dpaVersion: this.config.get('LEGAL_DPA_VERSION') ?? '2026-01',
    };
  }

  private fallbackDpo(): { name: string; email: string } {
    return {
      name: this.config.get('ORDERUP_DPO_NAME') ?? 'OrderUp — Encarregado de Dados',
      email: this.config.get('ORDERUP_DPO_EMAIL') ?? 'privacidade@orderup.com.br',
    };
  }

  private async requireTenant(tenantId: string): Promise<Tenant> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    return tenant;
  }
}

function toSettingsView(
  tenant: Tenant,
  fallback: { name: string; email: string },
  versions: { termsVersion: string; dpaVersion: string },
): ComplianceSettingsView {
  const configured = Boolean(tenant.dpoName && tenant.dpoEmail);
  return {
    dpo: configured
      ? { name: tenant.dpoName as string, email: tenant.dpoEmail as string, configuredByTenant: true }
      : { ...fallback, configuredByTenant: false },
    retention: {
      conversationDays: tenant.retentionConversationDays,
      leadDays: tenant.retentionLeadDays,
    },
    legal: {
      current: versions,
      tenant: {
        termsVersion: tenant.termsVersion,
        termsAcceptedAt: tenant.termsAcceptedAt,
        dpaVersion: tenant.dpaVersion,
        dpaAcceptedAt: tenant.dpaAcceptedAt,
      },
    },
  };
}

function normalize(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
