import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWhatsAppInstances } from '@/features/whatsapp/queries';
import { useAttendanceViewStore } from '@/stores/attendance-view-store';
import type { ConversationStatus } from '@/types/attendance';

export function AttendanceMobileOptions() {
  const search = useAttendanceViewStore((state) => state.search);
  const status = useAttendanceViewStore((state) => state.status);
  const instanceId = useAttendanceViewStore((state) => state.instanceId);
  const setSearch = useAttendanceViewStore((state) => state.setSearch);
  const setStatus = useAttendanceViewStore((state) => state.setStatus);
  const setInstanceId = useAttendanceViewStore((state) => state.setInstanceId);
  const resetFilters = useAttendanceViewStore((state) => state.resetFilters);
  const instancesQuery = useWhatsAppInstances({ perPage: 100 });
  const instances = instancesQuery.data?.data ?? [];

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Filtros
      </p>
      <Select value={instanceId} onValueChange={setInstanceId}>
        <SelectTrigger aria-label="Filtrar por WhatsApp">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">Todos os WhatsApps</SelectItem>
          {instances.map((instance) => (
            <SelectItem key={instance.id} value={instance.id}>
              {instance.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={status}
        onValueChange={(value) => setStatus(value as ConversationStatus | 'ALL')}
      >
        <SelectTrigger aria-label="Filtrar por status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">Todas</SelectItem>
          <SelectItem value="OPEN">Abertas</SelectItem>
          <SelectItem value="CLOSED">Encerradas</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={resetFilters}
        >
          Limpar filtros
        </Button>
      </div>
      {search ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          onClick={() => setSearch('')}
        >
          Limpar busca “{search}”
        </Button>
      ) : null}
    </div>
  );
}
