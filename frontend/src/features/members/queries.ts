import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import type { Member } from '@/types/sales';

export const memberKeys = {
  all: ['members'] as const,
};

export function useMembers() {
  return useQuery({
    queryKey: memberKeys.all,
    queryFn: () => apiRequest<Member[]>('/members'),
    staleTime: 5 * 60_000,
  });
}
