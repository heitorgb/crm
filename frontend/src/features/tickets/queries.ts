import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TicketStatus } from '@/types/attendance';
import { ticketsService, type ListTicketsParams, type TicketInput } from './services/tickets-service';

export const ticketKeys = {
  all: ['tickets'] as const,
  list: (params: ListTicketsParams) => ['tickets', 'list', params] as const,
};

export function useTickets(params: ListTicketsParams = {}) {
  return useQuery({
    queryKey: ticketKeys.list(params),
    queryFn: () => ticketsService.list(params),
    refetchInterval: 20000,
    placeholderData: (previous) => previous,
  });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TicketInput) => ticketsService.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ticketKeys.all }),
  });
}

export function useUpdateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<TicketInput> & { status?: TicketStatus } }) =>
      ticketsService.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ticketKeys.all }),
  });
}
