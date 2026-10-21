import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, Check, KeyRound, Loader2, Trash2, UserRound } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { PageHeader } from '@/components/common/page-header';
import { UserAvatar } from '@/components/common/user-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/common/form-field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type { Role } from '@/types/auth';
import { useChangePassword, useUpdateProfile } from '@/features/auth/queries';
import { useRemoveAvatar, useUploadAvatar } from './queries';

const roleLabel: Record<Role, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  USER: 'Usuário',
};

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function ProfilePage() {
  const session = useAuthStore((state) => state.session);
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();
  const uploadAvatar = useUploadAvatar();
  const removeAvatar = useRemoveAvatar();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(session?.user.name ?? '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarSaved, setAvatarSaved] = useState(false);
  const [removeAvatarOpen, setRemoveAvatarOpen] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  useEffect(
    () => () => {
      if (avatarPreview) {
        URL.revokeObjectURL(avatarPreview);
      }
    },
    [avatarPreview],
  );

  const handleAvatarSelected = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setAvatarError(null);
    setAvatarSaved(false);

    if (!file) {
      return;
    }
    if (!AVATAR_TYPES.includes(file.type)) {
      setAvatarError('Selecione uma imagem JPEG, PNG ou WebP.');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError('A imagem deve ter no máximo 5 MB.');
      return;
    }

    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleAvatarUpload = async (): Promise<void> => {
    if (!avatarFile) {
      return;
    }
    setAvatarError(null);
    setAvatarSaved(false);

    try {
      await uploadAvatar.mutateAsync(avatarFile);
      setAvatarFile(null);
      setAvatarPreview(null);
      setAvatarSaved(true);
    } catch (error) {
      setAvatarError(
        error instanceof ApiError ? error.message : 'Não foi possível salvar a foto de perfil.',
      );
    }
  };

  const handleAvatarRemove = async (): Promise<void> => {
    setAvatarError(null);
    setAvatarSaved(false);

    try {
      await removeAvatar.mutateAsync();
      setAvatarFile(null);
      setAvatarPreview(null);
      setRemoveAvatarOpen(false);
      setAvatarSaved(true);
    } catch (error) {
      setAvatarError(
        error instanceof ApiError ? error.message : 'Não foi possível remover a foto de perfil.',
      );
      setRemoveAvatarOpen(false);
    }
  };

  const handleProfileSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setProfileError(null);
    setProfileSaved(false);

    if (name.trim().length === 0) {
      setProfileError('Informe o seu nome.');
      return;
    }

    try {
      await updateProfile.mutateAsync({ name: name.trim() });
      setProfileSaved(true);
    } catch (error) {
      setProfileError(
        error instanceof ApiError ? error.message : 'Não foi possível salvar o perfil.',
      );
    }
  };

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);

    if (newPassword.length < 8) {
      setPasswordError('A nova senha deve ter pelo menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('A confirmação não corresponde à nova senha.');
      return;
    }

    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSaved(true);
    } catch (error) {
      setPasswordError(
        error instanceof ApiError ? error.message : 'Não foi possível alterar a senha.',
      );
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Meu perfil" description="Seus dados de acesso e segurança da conta." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <UserRound className="size-5" />
            </span>
            <div>
              <CardTitle>Dados pessoais</CardTitle>
              <CardDescription>Nome exibido para a equipe.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(event) => void handleProfileSubmit(event)}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="relative mx-auto shrink-0 sm:mx-0">
                  <UserAvatar
                    name={session?.user.name ?? '?'}
                    src={avatarPreview ?? session?.user.avatarUrl}
                    authenticated={!avatarPreview}
                    className="size-20 text-lg"
                  />
                  <Button
                    type="button"
                    size="icon"
                    className="absolute -bottom-1 -right-1 size-8 rounded-full shadow-md"
                    onClick={() => avatarInputRef.current?.click()}
                    aria-label="Selecionar foto de perfil"
                  >
                    <Camera />
                  </Button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept={AVATAR_TYPES.join(',')}
                    className="hidden"
                    onChange={handleAvatarSelected}
                  />
                </div>

                <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
                  <div>
                    <p className="truncate text-sm font-medium">{session?.user.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{session?.user.email}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    JPEG, PNG ou WebP, até 5 MB. A imagem é recortada em formato quadrado.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={uploadAvatar.isPending}
                    >
                      <Camera />
                      {avatarPreview
                        ? 'Escolher outra foto'
                        : session?.user.avatarUrl
                          ? 'Trocar foto'
                          : 'Adicionar foto'}
                    </Button>
                    {avatarPreview ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleAvatarUpload()}
                          disabled={uploadAvatar.isPending}
                        >
                          {uploadAvatar.isPending ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Check />
                          )}
                          Salvar foto
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setAvatarFile(null);
                            setAvatarPreview(null);
                            setAvatarError(null);
                          }}
                          disabled={uploadAvatar.isPending}
                        >
                          Cancelar
                        </Button>
                      </>
                    ) : session?.user.avatarUrl ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        onClick={() => setRemoveAvatarOpen(true)}
                        disabled={removeAvatar.isPending}
                      >
                        {removeAvatar.isPending ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Trash2 />
                        )}
                        Remover foto
                      </Button>
                    ) : null}
                  </div>
                  {avatarError ? (
                    <p className="text-xs font-medium text-danger">{avatarError}</p>
                  ) : null}
                  {avatarSaved && !avatarError ? (
                    <p className="text-xs font-medium text-success">Foto de perfil atualizada.</p>
                  ) : null}
                </div>
              </div>

              <FormField id="profile-name" label="Nome" required>
                <Input
                  id="profile-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </FormField>

              <FormField id="profile-email" label="E-mail" description="O e-mail de login não pode ser alterado.">
                <Input id="profile-email" value={session?.user.email ?? ''} disabled />
              </FormField>

              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Organização:</span>
                <span className="font-medium">{session?.tenant.name}</span>
                {session ? (
                  <Badge variant="secondary">{roleLabel[session.role] ?? session.role}</Badge>
                ) : null}
              </div>

              {profileError ? <p className="text-xs font-medium text-danger">{profileError}</p> : null}
              {profileSaved ? (
                <p className="text-xs font-medium text-success">Perfil atualizado.</p>
              ) : null}

              <Button type="submit" disabled={updateProfile.isPending}>
                {updateProfile.isPending ? <Loader2 className="animate-spin" /> : null}
                Salvar alterações
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <KeyRound className="size-5" />
            </span>
            <div>
              <CardTitle>Senha</CardTitle>
              <CardDescription>
                Ao alterar, as outras sessões são encerradas automaticamente.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(event) => void handlePasswordSubmit(event)}>
              <FormField id="current-password" label="Senha atual" required>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </FormField>

              <FormField id="new-password" label="Nova senha" required>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </FormField>

              <FormField id="confirm-password" label="Confirmar nova senha" required>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </FormField>

              {passwordError ? <p className="text-xs font-medium text-danger">{passwordError}</p> : null}
              {passwordSaved ? (
                <p className="text-xs font-medium text-success">Senha alterada com sucesso.</p>
              ) : null}

              <Button type="submit" disabled={changePassword.isPending}>
                {changePassword.isPending ? <Loader2 className="animate-spin" /> : null}
                Alterar senha
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={removeAvatarOpen}
        onOpenChange={setRemoveAvatarOpen}
        title="Remover foto de perfil"
        description="A foto personalizada será excluída e o avatar com suas iniciais voltará a ser exibido."
        confirmLabel="Remover"
        destructive
        loading={removeAvatar.isPending}
        onConfirm={() => void handleAvatarRemove()}
      />
    </div>
  );
}
