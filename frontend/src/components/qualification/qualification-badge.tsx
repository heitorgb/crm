import { StatusBadge } from '@/components/common/status-badge';
import type { QualificationLevel } from '@/types/qualification';
import { cn } from '@/lib/utils';
import { QUALIFICATION_LEVEL_META } from './qualification-status';

interface QualificationBadgeProps {
  level: QualificationLevel;
  className?: string;
}

export function QualificationBadge({ level, className }: QualificationBadgeProps) {
  const meta = QUALIFICATION_LEVEL_META[level];

  return (
    <StatusBadge tone={meta.tone} className={cn(className)}>
      {meta.label}
    </StatusBadge>
  );
}
