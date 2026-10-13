import { UserRound } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useAttendanceStore } from '@/stores/attendance-store';

export function AttendanceTab() {
  const showAgentName = useAttendanceStore((state) => state.showAgentName);
  const setShowAgentName = useAttendanceStore((state) => state.setShowAgentName);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Atendimento</CardTitle>
        <CardDescription>Preferências ao enviar mensagens no atendimento.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
          <div className="flex items-start gap-3">
            <UserRound className="mt-0.5 size-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Exibir nome do atendente</p>
              <p className="text-xs text-muted-foreground">
                Marca por padrão a opção de incluir seu nome na mensagem enviada ao cliente. Pode ser
                alterado a cada mensagem no compositor.
              </p>
            </div>
          </div>
          <Switch
            checked={showAgentName}
            onCheckedChange={setShowAgentName}
            aria-label="Exibir nome do atendente"
          />
        </div>
      </CardContent>
    </Card>
  );
}
