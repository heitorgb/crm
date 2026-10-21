import { apiRequest } from '@/lib/api-client';
import type { CustomMenuResponse, SaveCustomMenuInput } from '@/types/custom-menu';

export const customMenuService = {
  list: () => apiRequest<CustomMenuResponse>('/custom-menu'),

  navigation: () => apiRequest<CustomMenuResponse>('/custom-menu/navigation'),

  save: (input: SaveCustomMenuInput) =>
    apiRequest<CustomMenuResponse>('/custom-menu', { method: 'PUT', body: input }),
};
