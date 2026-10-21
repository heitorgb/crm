import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authKeys } from '@/features/auth/queries';
import { settingsKeys } from '@/features/settings/queries';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthUser } from '@/types/auth';
import { profileService } from './services/profile-service';

function useAvatarMutation<TInput>(mutationFn: (input: TInput) => Promise<AuthUser>) {
  const updateUser = useAuthStore((state) => state.updateUser);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TInput) => mutationFn(input),
    onSuccess: (user) => {
      updateUser(user);
      void queryClient.invalidateQueries({ queryKey: authKeys.me });
      void queryClient.invalidateQueries({ queryKey: settingsKeys.members });
    },
  });
}

export function useUploadAvatar() {
  return useAvatarMutation<File>((file) => profileService.uploadAvatar(file));
}

export function useRemoveAvatar() {
  return useAvatarMutation<void>(() => profileService.removeAvatar());
}
