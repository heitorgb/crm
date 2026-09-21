import { cn } from '@/lib/utils';
import type { QualificationLevel } from '@/types/qualification';
import { QualificationBadge } from './qualification-badge';
import { QUALIFICATION_LEVEL_META } from './qualification-status';

interface QualificationScoreProps {
  score: number;
  level: QualificationLevel;
  size?: number;
  label?: string;
  className?: string;
}

const strokeTone: Record<QualificationLevel, string> = {
  high: 'stroke-success',
  medium: 'stroke-warning',
  low: 'stroke-danger',
};

export function QualificationScore({
  score,
  level,
  size = 92,
  label = 'Score de qualificação',
  className,
}: QualificationScoreProps) {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div
        className="relative shrink-0"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${label}: ${clamped} de 100 (${QUALIFICATION_LEVEL_META[level].label})`}
      >
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className="fill-none stroke-muted"
            strokeWidth={8}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className={cn('fill-none transition-all duration-500', strokeTone[level])}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold leading-none text-foreground">{clamped}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">/100</span>
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <QualificationBadge level={level} />
      </div>
    </div>
  );
}
