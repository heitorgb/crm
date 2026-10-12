import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useThemeStore, type Theme } from '@/stores/theme-store';

const options: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
];

export function AppearanceTab() {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aparência</CardTitle>
        <CardDescription>Escolha o tema da interface do CRM.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTheme(option.value)}
              className={cn(
                'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                theme === option.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-surface-hover',
              )}
            >
              <option.icon className="size-4" />
              <span className="flex-1 text-sm font-medium">{option.label}</span>
              {theme === option.value ? <Check className="size-4 text-primary" /> : null}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
