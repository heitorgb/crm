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

export interface AuthSession {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: AuthUser;
  tenant: AuthTenant;
  role: Role;
  membershipId: string;
}

export interface CurrentSession {
  user: AuthUser;
  tenant: AuthTenant;
  role: Role;
  membershipId: string;
  memberships: Membership[];
}

export interface LoginInput {
  email: string;
  password: string;
  tenantId?: string;
}
