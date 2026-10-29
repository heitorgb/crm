import { AlertTriangle, CheckCircle2, Loader2, QrCode, RefreshCw } from 'lucide-react';
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
  const status = statusQuery.data?.status;
  const reason = statusQuery.data?.reason ?? null;
  const connected = status === 'CONNECTED';
  const refused = status === 'ERROR';
  const expired = status === 'DISCONNECTED' && !statusQuery.isFetching;
  const qrCode = ticket?.qrCodeBase64 ?? null;
  const pairingCode = ticket?.pairingCode ?? ticket?.code ?? null;

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
              Esta instância já pode receber e enviar mensagens.
            </p>
          </div>
        ) : refused ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <AlertTriangle className="size-10 text-danger" aria-hidden />
            <p className="text-sm font-medium text-foreground">
              Não foi possível concluir a conexão.
            </p>
            <p className="text-xs text-muted-foreground">
              {reason === 428 || reason === 500
                ? 'O limite de QR codes desta tentativa foi atingido. Gere um novo QR code para tentar novamente.'
                : 'A Evolution API recusou a sessão. Gere um novo QR code para tentar novamente.'}
            </p>
          </div>
        ) : expired && (qrCode || pairingCode) ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <AlertTriangle className="size-10 text-warning" aria-hidden />
            <p className="text-sm font-medium text-foreground">O QR code expirou.</p>
            <p className="text-xs text-muted-foreground">
              A tentativa de conexão foi encerrada. Gere um novo QR code e escaneie novamente.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-2">
            {qrCode ? (
              <img
                key={ticket?.updatedAt ?? ticket?.code ?? qrCode}
                src={qrCode}
                alt="QR code de conexão do WhatsApp"
                className="size-56 rounded-md border border-border bg-white p-2"
              />
            ) : pairingCode ? (
              <div className="w-full space-y-2 rounded-md border border-border p-4 text-center">
                <QrCode className="mx-auto size-5 text-muted-foreground" aria-hidden />
                <p className="text-xs text-muted-foreground">Código de pareamento</p>
                <p className="font-mono text-lg font-semibold tracking-widest text-foreground">
                  {pairingCode}
                </p>
              </div>
            ) : (
              <Skeleton className="size-56" />
            )}

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {statusQuery.isFetching ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Aguardando conexão…
            </div>
            {ticket?.updatedAt ? (
              <p className="text-xs text-muted-foreground">
                O código é renovado automaticamente enquanto esta janela estiver aberta.
              </p>
            ) : null}
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
