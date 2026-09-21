import { cn } from '@/lib/utils';

interface QualificationProgressProps {
  value: number;
  max: number;
  label?: string;
  hint?: string;
  className?: string;
}

export function QualificationProgress({
  value,
  max,
  label = 'Informações coletadas',
  hint,
  className,
}: QualificationProgressProps) {
  const safeMax = Math.max(max, 1);
  const clampedValue = Math.max(0, Math.min(value, safeMax));
  const percentage = Math.round((clampedValue / safeMax) * 100);

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">
          {clampedValue}/{safeMax} · {percentage}%
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${percentage}%` }}
        />
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
