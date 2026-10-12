import { apiRequest } from '@/lib/api-client';
import type {
  CreateMemberInput,
  Member,
  Organization,
  UpdateMemberInput,
} from '@/types/settings';

export const settingsService = {
  getOrganization: () => apiRequest<Organization>('/tenants/current'),

  renameOrganization: (input: { name: string }) =>
    apiRequest<Organization>('/tenants/current', { method: 'PATCH', body: input }),

  listMembers: () => apiRequest<Member[]>('/members'),

  createMember: (input: CreateMemberInput) =>
    apiRequest<Member>('/members', { method: 'POST', body: input }),

  updateMember: (id: string, input: UpdateMemberInput) =>
    apiRequest<Member>(`/members/${id}`, { method: 'PATCH', body: input }),

  removeMember: (id: string) => apiRequest<void>(`/members/${id}`, { method: 'DELETE' }),
};
