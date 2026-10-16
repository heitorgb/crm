import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PageLoader } from '@/components/common/page-loader';
import { AppLayout } from '@/components/layout/app-layout';
import { LoginPage } from '@/features/auth/login-page';
import { ProtectedRoute } from './protected-route';

const AttendancePage = lazy(() =>
  import('@/features/attendance/attendance-page').then((module) => ({
    default: module.AttendancePage,
  })),
);
const WhatsAppPage = lazy(() =>
  import('@/features/whatsapp/whatsapp-page').then((module) => ({ default: module.WhatsAppPage })),
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
          <Route path="/atendimento/conversas" element={<AttendancePage />} />
          <Route path="/atendimento/whatsapp" element={<WhatsAppPage />} />

          <Route path="/admin/tenants" element={<AdminTenantsPage />} />
          <Route path="/admin/tenants/:id" element={<AdminTenantDetailPage />} />

          <Route path="/contatos" element={<ContactListPage />} />
          <Route path="/contatos/:id" element={<ContactDetailPage />} />

          <Route path="/cobrancas" element={<BillingPage />} />

          <Route path="/perfil" element={<ProfilePage />} />
          <Route path="/configuracoes" element={<SettingsPage />} />
        </Route>

        <Route path="/" element={<Navigate to="/atendimento/conversas" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
