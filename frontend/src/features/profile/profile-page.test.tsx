// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAuthStore } from '@/stores/auth-store';
import { ProfilePage } from './profile-page';

vi.mock('@/features/auth/queries', () => ({
  useUpdateProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChangePassword: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('./queries', () => ({
  useUploadAvatar: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveAvatar: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

beforeEach(() => {
  useAuthStore.setState({
    session: {
      accessToken: 'token',
      tokenType: 'Bearer',
      expiresIn: 900,
      expiresAt: Date.now() + 900_000,
      user: { id: 'user-1', name: 'Ana Souza', email: 'ana@example.com', avatarUrl: null },
      tenant: { id: 'tenant-1', name: 'OrderUp' },
      role: 'OWNER',
      membershipId: 'member-1',
    },
  });
});

afterEach(() => {
  cleanup();
  useAuthStore.setState({ session: null });
});

describe('ProfilePage avatar', () => {
  it('shows the default avatar, validates the type and previews a valid image', () => {
    const createObjectURL = vi.fn(() => 'blob:avatar-preview');
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
    });

    const { container } = render(<ProfilePage />);

    expect(screen.getByText('AS')).toBeTruthy();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    fireEvent.change(input, {
      target: { files: [new File(['text'], 'avatar.txt', { type: 'text/plain' })] },
    });
    expect(screen.getByText('Selecione uma imagem JPEG, PNG ou WebP.')).toBeTruthy();

    fireEvent.change(input, {
      target: { files: [new File(['image'], 'avatar.png', { type: 'image/png' })] },
    });

    expect(createObjectURL).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Salvar foto/ })).toBeTruthy();
  });
});
