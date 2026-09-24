import type { LucideIcon } from 'lucide-react';
import { Clock } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';

interface PlaceholderPageProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
}

export function PlaceholderPage({ title, description, icon = Clock }: PlaceholderPageProps) {
  return (
    <div className="space-y-5">
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={icon}
        title="Módulo em construção"
        description="Este módulo faz parte das próximas fases do CRM e ainda não possui dados reais."
      />
    </div>
  );
}
