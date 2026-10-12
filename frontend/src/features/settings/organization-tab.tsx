import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { FormField } from '@/components/common/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import { useOrganization, useRenameOrganization } from './queries';

export function OrganizationTab({ canManage }: { canManage: boolean }) {
  const query = useOrganization();
  const rename = useRenameOrganization();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const name = draft ?? query.data?.name ?? '';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSaved(false);

    if (name.trim().length === 0) {
      setError('Informe o nome da organização.');
      return;
    }

    try {
      await rename.mutateAsync({ name: name.trim() });
      setDraft(null);
      setSaved(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Não foi possível salvar a organização.',
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organização</CardTitle>
        <CardDescription>Nome exibido para os usuários da sua conta.</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-full max-w-sm" />
          </div>
        ) : query.isError ? (
          <p className="text-sm text-danger">Não foi possível carregar a organização.</p>
        ) : (
          <form className="max-w-sm space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            <FormField id="org-name" label="Nome da organização" required>
              <Input
                id="org-name"
                value={name}
                onChange={(event) => setDraft(event.target.value)}
                disabled={!canManage}
              />
            </FormField>

            {!canManage ? (
              <p className="text-xs text-muted-foreground">
                Apenas proprietários e administradores podem alterar a organização.
              </p>
            ) : null}

            {error ? <p className="text-xs font-medium text-danger">{error}</p> : null}
            {saved ? <p className="text-xs font-medium text-success">Organização atualizada.</p> : null}

            {canManage ? (
              <Button type="submit" disabled={rename.isPending}>
                {rename.isPending ? <Loader2 className="animate-spin" /> : null}
                Salvar
              </Button>
            ) : null}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
