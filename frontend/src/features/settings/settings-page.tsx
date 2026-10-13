import { Bell, Building2, Palette, Users } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore } from '@/stores/auth-store';
import { AppearanceTab } from './appearance-tab';
import { NotificationsTab } from './notifications-tab';
import { OrganizationTab } from './organization-tab';
import { TeamTab } from './team-tab';

export function SettingsPage() {
  const role = useAuthStore((state) => state.session?.role);
  const canManage = role === 'OWNER' || role === 'ADMIN';

  return (
    <div className="space-y-5">
      <PageHeader title="Configurações" description="Organização, equipe e aparência." />

      <Tabs defaultValue="organization">
        <TabsList>
          <TabsTrigger value="organization">
            <Building2 />
            Organização
          </TabsTrigger>
          <TabsTrigger value="team">
            <Users />
            Equipe
          </TabsTrigger>
          <TabsTrigger value="appearance">
            <Palette />
            Aparência
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell />
            Notificações
          </TabsTrigger>
        </TabsList>

        <TabsContent value="organization">
          <OrganizationTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="team">
          <TeamTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="appearance">
          <AppearanceTab />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
