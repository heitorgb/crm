import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MessageStatus } from '@/types/attendance';

interface DeliveryTicksProps {
  status: MessageStatus;
  className?: string;
}

export function DeliveryTicks({ status, className }: DeliveryTicksProps) {
  if (status === 'FAILED') {
    return (
      <span title="Falha no envio" aria-label="Falha no envio" role="img" className={className}>
        <AlertCircle className="size-3.5 text-danger" />
      </span>
    );
  }
  if (status === 'PENDING') {
    return (
      <span title="Enviando" aria-label="Enviando" role="img" className={cn('text-wa-tick', className)}>
        <Clock className="size-3.5" />
      </span>
    );
  }
  if (status === 'READ') {
    return (
      <span title="Lida" aria-label="Lida" role="img" className={cn('text-wa-tick-read', className)}>
        <CheckCheck className="size-3.5" />
      </span>
    );
  }
  if (status === 'DELIVERED') {
    return (
      <span title="Entregue" aria-label="Entregue" role="img" className={cn('text-wa-tick', className)}>
        <CheckCheck className="size-3.5" />
      </span>
    );
  }
  return (
    <span title="Enviada" aria-label="Enviada" role="img" className={cn('text-wa-tick', className)}>
      <Check className="size-3.5" />
    </span>
  );
}
