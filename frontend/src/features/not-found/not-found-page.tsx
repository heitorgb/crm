import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 p-6">
      <PageHeader title="404" description="A página que você tentou acessar não existe." />
      <EmptyState
        icon={Compass}
        title="Página não encontrada"
        description="Verifique o endereço ou volte para o dashboard."
        action={
          <Button asChild>
            <Link to="/dashboard">Ir para o dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}
