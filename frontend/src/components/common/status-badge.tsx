import type { ReactNode } from 'react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type StatusTone = NonNullable<BadgeProps['variant']>;

const toneDot: Record<StatusTone, string> = {
  default: 'bg-primary',
  secondary: 'bg-muted-foreground',
  outline: 'bg-muted-foreground',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  accent: 'bg-accent',
};

interface StatusBadgeProps {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
  withDot?: boolean;
}

export function StatusBadge({ tone = 'secondary', children, className, withDot = true }: StatusBadgeProps) {
  return (
    <Badge variant={tone} className={cn('gap-1.5', className)}>
      {withDot ? <span className={cn('size-1.5 rounded-full', toneDot[tone])} aria-hidden /> : null}
      {children}
    </Badge>
  );
}
