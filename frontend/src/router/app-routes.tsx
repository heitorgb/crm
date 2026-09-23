import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PageLoader } from '@/components/common/page-loader';
import { AppLayout } from '@/components/layout/app-layout';
import { LoginPage } from '@/features/auth/login-page';
import { PlaceholderPage } from '@/features/placeholder/placeholder-page';
import { ProtectedRoute } from './protected-route';

const AttendancePage = lazy(() =>
  import('@/features/attendance/attendance-page').then((module) => ({
    default: module.AttendancePage,
  })),
);
const WhatsAppPage = lazy(() =>
  import('@/features/whatsapp/whatsapp-page').then((module) => ({ default: module.WhatsAppPage })),
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

          <Route path="/contatos" element={<ContactListPage />} />
          <Route path="/contatos/:id" element={<ContactDetailPage />} />

          <Route
            path="/configuracoes"
            element={<PlaceholderPage title="Configurações" description="Configurações do CRM." />}
          />
        </Route>

        <Route path="/" element={<Navigate to="/atendimento/conversas" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
