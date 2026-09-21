import { StatusBadge } from '@/components/common/status-badge';
import type { QualificationStatus } from '@/types/qualification';
import { cn } from '@/lib/utils';
import { QUALIFICATION_STATUS_META } from './qualification-status';

interface QualificationStatusBadgeProps {
  status: QualificationStatus;
  showIcon?: boolean;
  className?: string;
}

export function QualificationStatusBadge({
  status,
  showIcon = true,
  className,
}: QualificationStatusBadgeProps) {
  const meta = QUALIFICATION_STATUS_META[status];

  return (
    <StatusBadge tone={meta.tone} withDot={false} className={cn('gap-1', className)}>
      {showIcon ? <meta.icon aria-hidden /> : null}
      {meta.label}
    </StatusBadge>
  );
}
