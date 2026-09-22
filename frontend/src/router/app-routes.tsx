import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PageLoader } from '@/components/common/page-loader';
import { AppLayout } from '@/components/layout/app-layout';
import { LoginPage } from '@/features/auth/login-page';
import { PlaceholderPage } from '@/features/placeholder/placeholder-page';
import { ProtectedRoute } from './protected-route';

const DashboardPage = lazy(() =>
  import('@/features/dashboard/dashboard-page').then((module) => ({ default: module.DashboardPage })),
);
const QualificationBotPage = lazy(() =>
  import('@/features/settings/qualification-bot-page').then((module) => ({
    default: module.QualificationBotPage,
  })),
);
const LeadDigestPage = lazy(() =>
  import('@/features/settings/lead-digest-page').then((module) => ({
    default: module.LeadDigestPage,
  })),
);
const CustomerListPage = lazy(() =>
  import('@/features/customers/customer-list-page').then((module) => ({
    default: module.CustomerListPage,
  })),
);
const CustomerDetailPage = lazy(() =>
  import('@/features/customers/customer-detail-page').then((module) => ({
    default: module.CustomerDetailPage,
  })),
);
const ContactListPage = lazy(() =>
  import('@/features/contacts/contact-list-page').then((module) => ({
    default: module.ContactListPage,
  })),
);
const TagsPage = lazy(() =>
  import('@/features/tags/tags-page').then((module) => ({ default: module.TagsPage })),
);
const LeadListPage = lazy(() =>
  import('@/features/leads/lead-list-page').then((module) => ({ default: module.LeadListPage })),
);
const KanbanPage = lazy(() =>
  import('@/features/deals/kanban-page').then((module) => ({ default: module.KanbanPage })),
);
const DealsListPage = lazy(() =>
  import('@/features/deals/deals-list-page').then((module) => ({ default: module.DealsListPage })),
);
const TasksPage = lazy(() =>
  import('@/features/tasks/tasks-page').then((module) => ({ default: module.TasksPage })),
);
const PipelineSettingsPage = lazy(() =>
  import('@/features/pipelines/pipeline-settings-page').then((module) => ({
    default: module.PipelineSettingsPage,
  })),
);
const AttendancePage = lazy(() =>
  import('@/features/attendance/attendance-page').then((module) => ({
    default: module.AttendancePage,
  })),
);
const TicketsPage = lazy(() =>
  import('@/features/tickets/tickets-page').then((module) => ({ default: module.TicketsPage })),
);
const WhatsAppPage = lazy(() =>
  import('@/features/whatsapp/whatsapp-page').then((module) => ({ default: module.WhatsAppPage })),
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
          <Route path="/dashboard" element={<DashboardPage />} />

          <Route path="/vendas/leads" element={<LeadListPage />} />
          <Route path="/vendas/funil" element={<KanbanPage />} />
          <Route path="/vendas/negocios" element={<DealsListPage />} />

          <Route path="/clientes/clientes" element={<CustomerListPage />} />
          <Route path="/clientes/clientes/:id" element={<CustomerDetailPage />} />
          <Route path="/clientes/contatos" element={<ContactListPage />} />
          <Route path="/clientes/tags" element={<TagsPage />} />

          <Route path="/atendimento/conversas" element={<AttendancePage />} />
          <Route path="/atendimento/tickets" element={<TicketsPage />} />
          <Route path="/atendimento/whatsapp" element={<WhatsAppPage />} />

          <Route path="/tarefas" element={<TasksPage />} />
          <Route
            path="/relatorios"
            element={<PlaceholderPage title="Relatórios" description="Indicadores e relatórios." />}
          />

          <Route path="/settings/qualification-bot" element={<QualificationBotPage />} />
          <Route path="/settings/lead-digest" element={<LeadDigestPage />} />
          <Route path="/settings/pipelines" element={<PipelineSettingsPage />} />
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
