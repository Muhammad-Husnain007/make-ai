import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Shell } from './components/Shell.jsx';
import { AuthProvider, useAuth } from './hooks/useAuth.jsx';
import { usePulseLive } from './hooks/usePulseLive.js';
import { HomePage } from './pages/HomePage.jsx';
import { InvitePage } from './pages/InvitePage.jsx';
import { IssueDetail } from './pages/IssueDetail.jsx';
import { IssuesPage } from './pages/IssuesPage.jsx';
import { PipelinesPage } from './pages/PipelinesPage.jsx';
import { JobsPage } from './pages/JobsPage.jsx';
import { LoginPage, RegisterPage, RegisterThanksPage } from './pages/AuthPages.jsx';
import { CompaniesPage } from './pages/CompaniesPage.jsx';
import { CompanyDetail } from './pages/CompanyDetail.jsx';
import { NotificationsPage } from './pages/NotificationsPage.jsx';
import { SetupPage } from './pages/SetupPage.jsx';
import { TeamPage } from './pages/TeamPage.jsx';
import { getAdminNotifications } from './lib/api.js';
import { accountPath, errorPath, invitationPath, routes } from './lib/routes.js';

function PreserveRedirect({ to }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}${location.hash}`} replace />;
}

function LegacyErrorRedirect() {
  const { id } = useParams();
  return <Navigate to={errorPath(id)} replace />;
}

function LegacyAccountRedirect() {
  const { id } = useParams();
  return <Navigate to={accountPath(id)} replace />;
}

function LegacyInviteRedirect() {
  const { token } = useParams();
  const location = useLocation();
  return <Navigate to={`${invitationPath(token)}${location.search}`} replace />;
}

function Protected({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4 text-sm text-zinc-500">Loading…</div>;
  if (!user) return <Navigate to={routes.signIn} replace />;
  return children;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  if (!user?.platformOwner) return <Navigate to={routes.home} replace />;
  return children;
}

function ClientOnly({ children }) {
  const { user } = useAuth();
  if (user?.platformOwner) return <Navigate to={routes.home} replace />;
  return children;
}

function AuthedApp() {
  const { user } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user?.platformOwner) {
      setUnread(0);
      return;
    }
    getAdminNotifications()
      .then((data) => setUnread(Number(data.unread || 0)))
      .catch(() => setUnread(0));
  }, [user, refreshKey]);

  usePulseLive(() => {
    setRefreshKey((value) => value + 1);
  });

  return (
    <Shell unread={unread}>
      <Routes>
        <Route path={routes.home} element={<HomePage refreshKey={refreshKey} />} />
        <Route path={routes.accounts} element={<AdminOnly><CompaniesPage /></AdminOnly>} />
        <Route path="/admin/accounts/:id" element={<AdminOnly><CompanyDetail /></AdminOnly>} />
        <Route path={routes.queues} element={<AdminOnly><JobsPage refreshKey={refreshKey} /></AdminOnly>} />
        <Route path={routes.alerts} element={<AdminOnly><NotificationsPage refreshKey={refreshKey} /></AdminOnly>} />
        <Route path={routes.errors} element={<ClientOnly><IssuesPage refreshKey={refreshKey} view="open" /></ClientOnly>} />
        <Route path={routes.errorsResolved} element={<ClientOnly><IssuesPage refreshKey={refreshKey} view="fixed" /></ClientOnly>} />
        <Route path="/errors/:id" element={<ClientOnly><IssueDetail /></ClientOnly>} />
        <Route path={routes.pullRequests} element={<ClientOnly><IssuesPage refreshKey={refreshKey} view="create-pull" /></ClientOnly>} />
        <Route path={routes.pullRequestsMerged} element={<ClientOnly><IssuesPage refreshKey={refreshKey} view="merge-pull" /></ClientOnly>} />
        <Route path={routes.pullRequestsClosed} element={<ClientOnly><IssuesPage refreshKey={refreshKey} view="closed-pull" /></ClientOnly>} />
        <Route path={routes.performance} element={<ClientOnly><IssuesPage refreshKey={refreshKey} view="performance" /></ClientOnly>} />
        <Route path={routes.pipelines} element={<ClientOnly><PipelinesPage refreshKey={refreshKey} /></ClientOnly>} />
        <Route path={routes.integrations} element={<ClientOnly><SetupPage /></ClientOnly>} />
        <Route path={routes.organization} element={<ClientOnly><TeamPage /></ClientOnly>} />
        <Route path="/companies/:id" element={<LegacyAccountRedirect />} />
        <Route path="/companies" element={<PreserveRedirect to={routes.accounts} />} />
        <Route path="/jobs" element={<PreserveRedirect to={routes.queues} />} />
        <Route path="/notifications" element={<PreserveRedirect to={routes.alerts} />} />
        <Route path="/open" element={<PreserveRedirect to={routes.errors} />} />
        <Route path="/fixed" element={<PreserveRedirect to={routes.errorsResolved} />} />
        <Route path="/issues/:id" element={<LegacyErrorRedirect />} />
        <Route path="/pulls" element={<PreserveRedirect to={routes.pullRequests} />} />
        <Route path="/merged" element={<PreserveRedirect to={routes.pullRequestsMerged} />} />
        <Route path="/closed" element={<PreserveRedirect to={routes.pullRequestsClosed} />} />
        <Route path="/performance" element={<PreserveRedirect to={routes.performance} />} />
        <Route path="/memory-leak" element={<PreserveRedirect to={routes.pipelines} />} />
        <Route path="/insights/memory-leaks" element={<PreserveRedirect to={routes.pipelines} />} />
        <Route path="/setup" element={<PreserveRedirect to={routes.integrations} />} />
        <Route path="/team" element={<PreserveRedirect to={routes.organization} />} />
      </Routes>
    </Shell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path={routes.signIn} element={<LoginPage />} />
        <Route path={routes.signUpPending} element={<RegisterThanksPage />} />
        <Route path={routes.signUp} element={<RegisterPage />} />
        <Route path="/invitations/:token" element={<InvitePage />} />
        <Route path="/login" element={<PreserveRedirect to={routes.signIn} />} />
        <Route path="/register/thanks" element={<PreserveRedirect to={routes.signUpPending} />} />
        <Route path="/register" element={<PreserveRedirect to={routes.signUp} />} />
        <Route path="/invite/:token" element={<LegacyInviteRedirect />} />
        <Route path="*" element={<Protected><AuthedApp /></Protected>} />
      </Routes>
    </AuthProvider>
  );
}
