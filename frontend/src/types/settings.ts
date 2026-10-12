import type { Role } from './auth';

export interface Organization {
  id: string;
  name: string;
}

export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
}

export interface CreateMemberInput {
  name: string;
  email: string;
  password?: string;
  role: Role;
}

export interface UpdateMemberInput {
  role?: Role;
  active?: boolean;
}
