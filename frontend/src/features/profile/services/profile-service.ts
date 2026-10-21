import { apiRequest, apiUpload } from '@/lib/api-client';
import type { AuthUser } from '@/types/auth';

export const profileService = {
  uploadAvatar: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiUpload<AuthUser>('/auth/me/avatar', formData);
  },

  removeAvatar: () => apiRequest<AuthUser>('/auth/me/avatar', { method: 'DELETE' }),
};
