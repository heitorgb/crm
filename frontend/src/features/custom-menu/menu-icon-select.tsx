import { MENU_ICON_OPTIONS } from '@/config/menu-icons';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const NONE_VALUE = 'none';

interface MenuIconSelectProps {
  id?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  ariaLabel?: string;
  disabled?: boolean;
}

export function MenuIconSelect({
  id,
  value,
  onChange,
  ariaLabel,
  disabled,
}: MenuIconSelectProps) {
  return (
    <Select
      value={value ?? NONE_VALUE}
      onValueChange={(next) => onChange(next === NONE_VALUE ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel}>
        <SelectValue placeholder="Sem ícone" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_VALUE}>Sem ícone</SelectItem>
        {MENU_ICON_OPTIONS.map((option) => (
          <SelectItem key={option.key} value={option.key}>
            <span className="flex items-center gap-2">
              <option.icon className="size-4" aria-hidden="true" />
              {option.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
