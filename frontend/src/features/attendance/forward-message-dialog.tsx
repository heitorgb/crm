import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { conversationLabel } from './attendance-utils';
import { useConversations, useForwardConversationMessage } from './queries';

interface Props {
  sourceConversationId: string;
  messageId: string;
  onClose: () => void;
}

export function ForwardMessageDialog({ sourceConversationId, messageId, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const conversations = useConversations({ perPage: 100, search });
  const forward = useForwardConversationMessage();

  const send = async () => {
    setError(null);
    try {
      await forward.mutateAsync({ id: sourceConversationId, messageId, conversationIds: selected });
      onClose();
    } catch {
      setError('Não foi possível encaminhar a mensagem.');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Encaminhar mensagem</DialogTitle></DialogHeader>
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar conversa" aria-label="Buscar conversa" />
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {conversations.data?.data.map((conversation) => (
            <label key={conversation.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-hover">
              <input type="checkbox" checked={selected.includes(conversation.id)}
                onChange={(event) => setSelected((current) => event.target.checked
                  ? [...current, conversation.id].slice(0, 20)
                  : current.filter((id) => id !== conversation.id))} />
              <span className="min-w-0 truncate text-sm">{conversationLabel(conversation)}</span>
            </label>
          ))}
          {conversations.data?.data.length === 0 ? <p className="py-3 text-center text-sm text-muted-foreground">Nenhuma conversa encontrada</p> : null}
        </div>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={selected.length === 0 || forward.isPending} onClick={() => void send()}>
            Encaminhar {selected.length > 0 ? `(${selected.length})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
