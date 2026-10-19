import { useState } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { WebhookIntegrationWithSecret } from '@/types/webhooks';

interface WebhookSecretDialogProps {
  webhook: WebhookIntegrationWithSecret | null;
  onOpenChange: (open: boolean) => void;
}

export function WebhookSecretDialog({ webhook, onOpenChange }: WebhookSecretDialogProps) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    if (!webhook) {
      return;
    }
    try {
      await navigator.clipboard.writeText(webhook.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog open={Boolean(webhook)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            Credencial do webhook
          </DialogTitle>
          <DialogDescription>
            Copie e guarde agora. Por segurança, a credencial não será exibida novamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Input readOnly value={webhook?.secret ?? ''} className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={() => void copy()} aria-label="Copiar credencial">
              {copied ? <Check className="text-success" /> : <Copy />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Envie a credencial no cabeçalho <code>Authorization: Bearer &lt;credencial&gt;</code> ou
            em <code>x-webhook-secret</code>.
          </p>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
