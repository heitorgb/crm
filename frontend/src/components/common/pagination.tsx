import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({ page, pageCount, onPageChange, className }: PaginationProps) {
  const safePageCount = Math.max(pageCount, 1);

  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <p className="text-xs text-muted-foreground">
        Página <span className="font-medium text-foreground">{page}</span> de {safePageCount}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => onPageChange(Math.max(page - 1, 1))}
          disabled={page <= 1}
          aria-label="Página anterior"
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => onPageChange(Math.min(page + 1, safePageCount))}
          disabled={page >= safePageCount}
          aria-label="Próxima página"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
