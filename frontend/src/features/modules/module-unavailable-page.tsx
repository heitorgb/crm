import { PackageX } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Card } from '@/components/ui/card';

export function ModuleUnavailablePage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Funcionalidade indisponível" />
      <Card className="p-4">
        <EmptyState
          icon={PackageX}
          title="Módulo desativado para esta organização"
          description="Esta funcionalidade foi desativada pelo administrador da plataforma. Fale com o suporte se precisar reativá-la."
        />
      </Card>
    </div>
  );
}
