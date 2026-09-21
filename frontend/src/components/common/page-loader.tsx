import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageLoaderProps {
  label?: string;
  className?: string;
}

export function PageLoader({ label = 'Carregando…', className }: PageLoaderProps) {
  return (
    <div className={cn('flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground', className)}>
      <Loader2 className="size-6 animate-spin text-primary" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
