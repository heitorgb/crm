import {
  Bell,
  Building2,
  Headset,
  Menu,
  Palette,
  Smartphone,
  Sparkles,
  Users,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/common/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore } from '@/stores/auth-store';
import { AiSettingsTab } from '@/features/ai/ai-settings-tab';
import { AppearanceTab } from './appearance-tab';
import { AttendanceTab } from './attendance-tab';
import { NotificationsTab } from './notifications-tab';
import { CustomMenuTab } from '@/features/custom-menu/custom-menu-tab';
import { OrganizationTab } from './organization-tab';
import { TeamTab } from './team-tab';
import { WhatsAppTab } from './whatsapp-tab';

const settingsTabs = [
  'organization',
  'team',
  'appearance',
  'attendance',
  'notifications',
  'whatsapp',
  'menu',
  'ai',
] as const;

type SettingsTab = (typeof settingsTabs)[number];

function isSettingsTab(value: string | null): value is SettingsTab {
  return value !== null && (settingsTabs as readonly string[]).includes(value);
}

export function SettingsPage() {
  const role = useAuthStore((state) => state.session?.role);
  const canManage = role === 'OWNER' || role === 'ADMIN';

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: SettingsTab = isSettingsTab(tabParam) ? tabParam : 'organization';

  const handleTabChange = (value: string): void => {
    if (!isSettingsTab(value)) return;
    setSearchParams(value === 'organization' ? {} : { tab: value }, { replace: true });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Configurações"
        description="Organização, equipe, aparência, WhatsApp, menu personalizado e IA."
      />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="hidden h-auto flex-wrap lg:inline-flex">
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
          <TabsTrigger value="attendance">
            <Headset />
            Atendimento
          </TabsTrigger>
          <TabsTrigger value="notifications">
            <Bell />
            Notificações
          </TabsTrigger>
          <TabsTrigger value="whatsapp">
            <Smartphone />
            WhatsApp
          </TabsTrigger>
          <TabsTrigger value="menu">
            <Menu />
            Menu Personalizado
          </TabsTrigger>
          <TabsTrigger value="ai">
            <Sparkles />
            IA
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
        <TabsContent value="attendance">
          <AttendanceTab />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>
        <TabsContent value="whatsapp">
          <WhatsAppTab />
        </TabsContent>
        <TabsContent value="menu">
          <CustomMenuTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="ai">
          <AiSettingsTab canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
