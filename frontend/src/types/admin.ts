import type { Role } from './auth';

export interface AdminTenantSummary {
  id: string;
  name: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTenantMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface AdminTenantDetail extends AdminTenantSummary {
  members: AdminTenantMember[];
  whatsappInstanceLimit: number;
  whatsappInstancesUsed: number;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  active: boolean;
  membershipsCount: number;
  createdAt: string;
}

export interface CreateTenantInput {
  name: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
}

export interface AddMemberInput {
  name: string;
  email: string;
  password?: string;
  role: Role;
}

export interface UpdateMemberInput {
  role?: Role;
  active?: boolean;
}

export interface PlatformSettings {
  linkPreviewsEnabled: boolean;
}
