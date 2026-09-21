import { Sparkles } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';

interface AiAnalysisEmptyStateProps {
  description?: string;
}

export function AiAnalysisEmptyState({
  description = 'Assim que o bot concluir a qualificação, a análise gerada por IA aparecerá aqui.',
}: AiAnalysisEmptyStateProps) {
  return (
    <EmptyState
      icon={Sparkles}
      title="Nenhuma análise disponível"
      description={description}
    />
  );
}
