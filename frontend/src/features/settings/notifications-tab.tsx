import { Bell, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { playNotificationSound } from '@/lib/notification-sound';
import { useNotificationStore } from '@/stores/notification-store';

export function NotificationsTab() {
  const tabBadgeEnabled = useNotificationStore((state) => state.tabBadgeEnabled);
  const soundEnabled = useNotificationStore((state) => state.soundEnabled);
  const setTabBadgeEnabled = useNotificationStore((state) => state.setTabBadgeEnabled);
  const setSoundEnabled = useNotificationStore((state) => state.setSoundEnabled);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notificações</CardTitle>
        <CardDescription>Controle os avisos de novas mensagens no atendimento.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
          <div className="flex items-start gap-3">
            <Bell className="mt-0.5 size-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Contador de não lidas na aba</p>
              <p className="text-xs text-muted-foreground">
                Exibe o número de mensagens não lidas no título da aba do navegador.
              </p>
            </div>
          </div>
          <Switch
            checked={tabBadgeEnabled}
            onCheckedChange={setTabBadgeEnabled}
            aria-label="Contador de não lidas na aba"
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
          <div className="flex items-start gap-3">
            <Volume2 className="mt-0.5 size-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Som de notificação</p>
              <p className="text-xs text-muted-foreground">
                Toca um som ao receber uma nova mensagem.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => playNotificationSound()}>
              Ouvir
            </Button>
            <Switch
              checked={soundEnabled}
              onCheckedChange={setSoundEnabled}
              aria-label="Som de notificação"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
