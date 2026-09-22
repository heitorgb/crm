import { CheckCircle2, Loader2, QrCode, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { WhatsAppConnectionTicket, WhatsAppInstance } from '@/types/whatsapp';
import { useWhatsAppInstanceStatus } from './queries';

interface ConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instance: WhatsAppInstance | null;
  ticket: WhatsAppConnectionTicket | null;
  regenerating: boolean;
  onRegenerate: () => void;
}

export function ConnectDialog({
  open,
  onOpenChange,
  instance,
  ticket,
  regenerating,
  onRegenerate,
}: ConnectDialogProps) {
  const statusQuery = useWhatsAppInstanceStatus(instance?.id, open);
  const connected = statusQuery.data?.status === 'CONNECTED';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar {instance?.name ?? 'WhatsApp'}</DialogTitle>
          <DialogDescription>
            Abra o WhatsApp no celular, vá em Aparelhos conectados e leia o QR code.
          </DialogDescription>
        </DialogHeader>

        {connected ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="size-10 text-success" aria-hidden />
            <p className="text-sm font-medium text-foreground">WhatsApp conectado com sucesso.</p>
            <p className="text-xs text-muted-foreground">
              O bot já pode receber e responder mensagens nesta instância.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-2">
            {ticket?.qrCodeBase64 ? (
              <img
                src={ticket.qrCodeBase64}
                alt="QR code de conexão do WhatsApp"
                className="size-56 rounded-md border border-border bg-white p-2"
              />
            ) : ticket ? (
              <div className="w-full space-y-2 rounded-md border border-border p-4 text-center">
                <QrCode className="mx-auto size-5 text-muted-foreground" aria-hidden />
                <p className="text-xs text-muted-foreground">Código de pareamento</p>
                <p className="font-mono text-lg font-semibold tracking-widest text-foreground">
                  {ticket.pairingCode ?? ticket.code ?? '—'}
                </p>
              </div>
            ) : (
              <Skeleton className="size-56" />
            )}

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {statusQuery.isFetching ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Aguardando conexão…
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          {!connected ? (
            <Button onClick={onRegenerate} disabled={regenerating}>
              {regenerating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Gerar novo QR
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
