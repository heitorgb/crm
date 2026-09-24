import { CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

interface DatePickerProps {
  id?: string;
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
}

export function DatePicker({
  id,
  value,
  onChange,
  placeholder = 'Selecionar data',
  className,
}: DatePickerProps) {
  const isoValue = value ? value.toISOString().slice(0, 10) : '';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className={cn(
            'w-full justify-start gap-2 font-normal',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarDays />
          {value ? formatDate(value) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <Input
          type="date"
          value={isoValue}
          onChange={(event) =>
            onChange(event.target.value ? new Date(`${event.target.value}T00:00:00`) : undefined)
          }
        />
      </PopoverContent>
    </Popover>
  );
}
