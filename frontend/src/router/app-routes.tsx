import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PageLoader } from '@/components/common/page-loader';
import { AppLayout } from '@/components/layout/app-layout';
import { LoginPage } from '@/features/auth/login-page';
import { ModuleRoute } from '@/features/modules/module-route';
import { ModuleUnavailablePage } from '@/features/modules/module-unavailable-page';
import { MODULE_KEYS } from '@/types/modules';
import { ProtectedRoute } from './protected-route';
import { PlatformAdminRoute } from './platform-admin-route';

const AttendancePage = lazy(() =>
  import('@/features/attendance/attendance-page').then((module) => ({
    default: module.AttendancePage,
  })),
);
const AdminTenantsPage = lazy(() =>
  import('@/features/admin/admin-tenants-page').then((module) => ({
    default: module.AdminTenantsPage,
  })),
);
const AdminTenantDetailPage = lazy(() =>
  import('@/features/admin/tenant-detail-page').then((module) => ({
    default: module.AdminTenantDetailPage,
  })),
);
const ContactListPage = lazy(() =>
  import('@/features/contacts/contact-list-page').then((module) => ({
    default: module.ContactListPage,
  })),
);
const ContactDetailPage = lazy(() =>
  import('@/features/contacts/contact-detail-page').then((module) => ({
    default: module.ContactDetailPage,
  })),
);
const NotFoundPage = lazy(() =>
  import('@/features/not-found/not-found-page').then((module) => ({
    default: module.NotFoundPage,
  })),
);
const ProfilePage = lazy(() =>
  import('@/features/profile/profile-page').then((module) => ({ default: module.ProfilePage })),
);
const SettingsPage = lazy(() =>
  import('@/features/settings/settings-page').then((module) => ({ default: module.SettingsPage })),
);
const BillingPage = lazy(() =>
  import('@/features/billing/billing-page').then((module) => ({ default: module.BillingPage })),
);
const ScheduledMessagesPage = lazy(() =>
  import('@/features/scheduled-messages/scheduled-messages-page').then((module) => ({
    default: module.ScheduledMessagesPage,
  })),
);
const WebhooksPage = lazy(() =>
  import('@/features/webhooks/webhooks-page').then((module) => ({ default: module.WebhooksPage })),
);

export function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route
            path="/atendimento/conversas"
            element={
              <ModuleRoute moduleKey={MODULE_KEYS.ATTENDANCE}>
                <AttendancePage />
              </ModuleRoute>
            }
          />
          <Route
            path="/atendimento/whatsapp"
            element={<Navigate to="/configuracoes?tab=whatsapp" replace />}
          />
          <Route
            path="/mensagens-agendadas"
            element={
              <ModuleRoute moduleKey={MODULE_KEYS.ATTENDANCE}>
                <ScheduledMessagesPage />
              </ModuleRoute>
            }
          />

          <Route
            path="/admin/tenants"
            element={
              <PlatformAdminRoute>
                <AdminTenantsPage />
              </PlatformAdminRoute>
            }
          />
          <Route
            path="/admin/tenants/:id"
            element={
              <PlatformAdminRoute>
                <AdminTenantDetailPage />
              </PlatformAdminRoute>
            }
          />

          <Route
            path="/contatos"
            element={
              <ModuleRoute moduleKey={MODULE_KEYS.CONTACTS}>
                <ContactListPage />
              </ModuleRoute>
            }
          />
          <Route
            path="/contatos/:id"
            element={
              <ModuleRoute moduleKey={MODULE_KEYS.CONTACTS}>
                <ContactDetailPage />
              </ModuleRoute>
            }
          />

          <Route
            path="/cobrancas"
            element={
              <ModuleRoute moduleKey={MODULE_KEYS.BILLING_CHARGES}>
                <BillingPage />
              </ModuleRoute>
            }
          />

          <Route
            path="/integracoes/webhooks"
            element={
              <ModuleRoute moduleKey={MODULE_KEYS.WEBHOOKS}>
                <WebhooksPage />
              </ModuleRoute>
            }
          />

          <Route path="/indisponivel" element={<ModuleUnavailablePage />} />

          <Route path="/perfil" element={<ProfilePage />} />
          <Route path="/configuracoes" element={<SettingsPage />} />
        </Route>

        <Route path="/" element={<Navigate to="/atendimento/conversas" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
