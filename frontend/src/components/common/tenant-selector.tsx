import { Building2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface TenantOption {
  id: string;
  name: string;
}

interface TenantSelectorProps {
  tenants: TenantOption[];
  value?: string;
  onChange: (tenantId: string) => void;
  loading?: boolean;
  className?: string;
}

export function TenantSelector({
  tenants,
  value,
  onChange,
  loading = false,
  className,
}: TenantSelectorProps) {
  if (loading) {
    return <Skeleton className={cn('h-9 w-[190px]', className)} />;
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('h-9 w-[190px] gap-2', className)} aria-label="Organização ativa">
        <span className="flex min-w-0 items-center gap-2">
          <Building2 className="size-4 shrink-0 text-muted-foreground" />
          <SelectValue placeholder="Selecionar" />
        </span>
      </SelectTrigger>
      <SelectContent>
        {tenants.map((tenant) => (
          <SelectItem key={tenant.id} value={tenant.id}>
            {tenant.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
