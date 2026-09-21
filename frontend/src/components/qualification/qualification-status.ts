import { Activity, CalendarClock, CheckCircle2, ShieldAlert, UserCheck, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { StatusTone } from '@/components/common/status-badge';
import type { QualificationLevel, QualificationStatus } from '@/types/qualification';

export interface QualificationStatusMeta {
  label: string;
  description: string;
  tone: StatusTone;
  icon: LucideIcon;
}

export const QUALIFICATION_STATUS_META: Record<QualificationStatus, QualificationStatusMeta> = {
  BOT_QUALIFYING: {
    label: 'Em qualificação',
    description: 'O bot está conduzindo a conversa e coletando informações.',
    tone: 'info',
    icon: Activity,
  },
  QUALIFIED: {
    label: 'Qualificado',
    description: 'O lead atende aos critérios definidos pelo tenant.',
    tone: 'success',
    icon: CheckCircle2,
  },
  DISQUALIFIED: {
    label: 'Desqualificado',
    description: 'O lead não atende aos critérios de qualificação.',
    tone: 'danger',
    icon: XCircle,
  },
  NEEDS_HUMAN: {
    label: 'Precisa de humano',
    description: 'Exceção ou pedido explícito exigem atendimento humano.',
    tone: 'warning',
    icon: ShieldAlert,
  },
  WAITING_DIGEST: {
    label: 'Aguardando resumo',
    description: 'Qualificado e aguardando entrega no resumo agendado.',
    tone: 'accent',
    icon: CalendarClock,
  },
  HANDED_OFF: {
    label: 'Repassado',
    description: 'O lead já foi entregue a um responsável humano.',
    tone: 'secondary',
    icon: UserCheck,
  },
};

export const QUALIFICATION_LEVEL_META: Record<
  QualificationLevel,
  { label: string; tone: StatusTone }
> = {
  high: { label: 'Alta', tone: 'success' },
  medium: { label: 'Média', tone: 'warning' },
  low: { label: 'Baixa', tone: 'danger' },
};

export function levelFromScore(score: number): QualificationLevel {
  if (score >= 75) {
    return 'high';
  }
  if (score >= 45) {
    return 'medium';
  }
  return 'low';
}
