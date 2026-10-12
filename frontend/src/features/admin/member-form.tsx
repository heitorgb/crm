import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { FormField } from '@/components/common/form-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api-client';
import type { Role } from '@/types/auth';
import { useAddMember } from './queries';

interface MemberFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
}

export function MemberForm({ open, onOpenChange, tenantId }: MemberFormProps) {
  const addMember = useAddMember(tenantId);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('USER');
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setName('');
    setEmail('');
    setPassword('');
    setRole('USER');
    setError(null);
  };

  const handleSubmit = async (): Promise<void> => {
    setError(null);

    if (name.trim().length === 0) {
      setError('Informe o nome do usuário.');
      return;
    }
    if (email.trim().length === 0) {
      setError('Informe o e-mail do usuário.');
      return;
    }
    if (password.length > 0 && password.length < 8) {
      setError('A senha deve ter pelo menos 8 caracteres.');
      return;
    }

    try {
      await addMember.mutateAsync({
        name: name.trim(),
        email: email.trim(),
        role,
        ...(password.length > 0 ? { password } : {}),
      });
      reset();
      onOpenChange(false);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'Não foi possível adicionar o usuário.',
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar usuário</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <FormField id="member-name" label="Nome" required>
            <Input id="member-name" value={name} onChange={(event) => setName(event.target.value)} />
          </FormField>

          <FormField id="member-email" label="E-mail" required>
            <Input
              id="member-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>

          <FormField
            id="member-password"
            label="Senha"
            description="Obrigatória apenas para usuários novos. Deixe em branco para vincular um usuário existente."
          >
            <Input
              id="member-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </FormField>

          <FormField id="member-role" label="Papel">
            <Select value={role} onValueChange={(value) => setRole(value as Role)}>
              <SelectTrigger id="member-role" aria-label="Papel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OWNER">Proprietário (OWNER)</SelectItem>
                <SelectItem value="ADMIN">Administrador (ADMIN)</SelectItem>
                <SelectItem value="USER">Usuário (USER)</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={addMember.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={addMember.isPending}>
            {addMember.isPending ? <Loader2 className="animate-spin" /> : null}
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
