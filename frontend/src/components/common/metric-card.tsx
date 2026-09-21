import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  label: string;
  value: string;
  icon?: LucideIcon;
  hint?: string;
  trend?: { value: string; direction: 'up' | 'down' | 'flat' };
  className?: string;
}

export function MetricCard({ label, value, icon: Icon, hint, trend, className }: MetricCardProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tracking-tight text-foreground">{value}</p>
          <div className="flex items-center gap-2">
            {trend ? (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 text-xs font-medium',
                  trend.direction === 'up' && 'text-success',
                  trend.direction === 'down' && 'text-danger',
                  trend.direction === 'flat' && 'text-muted-foreground',
                )}
              >
                {trend.direction === 'up' ? <ArrowUpRight className="size-3.5" /> : null}
                {trend.direction === 'down' ? <ArrowDownRight className="size-3.5" /> : null}
                {trend.value}
              </span>
            ) : null}
            {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
          </div>
        </div>
        {Icon ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}
