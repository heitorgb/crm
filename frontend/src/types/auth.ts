export type Role = 'OWNER' | 'ADMIN' | 'USER';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export interface AuthTenant {
  id: string;
  name: string;
}

export interface Membership {
  id: string;
  tenantId: string;
  tenantName: string;
  role: Role;
  active: boolean;
}

export interface AuthSessionResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: AuthUser;
  tenant: AuthTenant;
  role: Role;
  membershipId: string;
}

export interface AuthSession extends AuthSessionResponse {
  expiresAt: number;
}

export interface CurrentSession {
  user: AuthUser;
  tenant: AuthTenant;
  role: Role;
  membershipId: string;
  memberships: Membership[];
  isPlatformAdmin: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
  tenantId?: string;
}

export interface UpdateProfileInput {
  name: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}
