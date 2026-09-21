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

          <Route
            path="/vendas/leads"
            element={<PlaceholderPage title="Leads" description="Qualificação e acompanhamento de leads." />}
          />
          <Route
            path="/vendas/funil"
            element={<PlaceholderPage title="Funil" description="Etapas do pipeline comercial." />}
          />
          <Route
            path="/vendas/negocios"
            element={<PlaceholderPage title="Negócios" description="Negociações em andamento." />}
          />

          <Route
            path="/clientes/clientes"
            element={<PlaceholderPage title="Clientes" description="Base de clientes da organização." />}
          />
          <Route
            path="/clientes/contatos"
            element={<PlaceholderPage title="Contatos" description="Contatos vinculados aos clientes." />}
          />

          <Route
            path="/atendimento/conversas"
            element={<PlaceholderPage title="Conversas" description="Atendimentos de WhatsApp." />}
          />
          <Route
            path="/atendimento/tickets"
            element={<PlaceholderPage title="Tickets" description="Chamados de atendimento." />}
          />

          <Route
            path="/tarefas"
            element={<PlaceholderPage title="Tarefas" description="Atividades do time." />}
          />
          <Route
            path="/relatorios"
            element={<PlaceholderPage title="Relatórios" description="Indicadores e relatórios." />}
          />

          <Route path="/settings/qualification-bot" element={<QualificationBotPage />} />
          <Route path="/settings/lead-digest" element={<LeadDigestPage />} />
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
