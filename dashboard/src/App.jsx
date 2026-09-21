import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell.jsx';
import { AuthProvider, useAuth } from './hooks/useAuth.jsx';
import { usePulseLive } from './hooks/usePulseLive.js';
import { HomePage } from './pages/HomePage.jsx';
import { InvitePage } from './pages/InvitePage.jsx';
import { IssueDetail } from './pages/IssueDetail.jsx';
import { IssuesPage } from './pages/IssuesPage.jsx';
import { LoginPage, RegisterPage } from './pages/AuthPages.jsx';
import { CompaniesPage } from './pages/CompaniesPage.jsx';
import { CompanyDetail } from './pages/CompanyDetail.jsx';
import { SetupPage } from './pages/SetupPage.jsx';
import { TeamPage } from './pages/TeamPage.jsx';

function Protected({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="flex min-h-screen items-center justify-center bg-ink-950 text-sm text-zinc-500">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  if (!user?.platformOwner) return <Navigate to="/" replace />;
  return children;
}

function ClientOnly({ children }) {
  const { user } = useAuth();
  if (user?.platformOwner) return <Navigate to="/" replace />;
  return children;
}

function AuthedApp() {
  const [refreshKey, setRefreshKey] = useState(0);
  usePulseLive(() => {
    setRefreshKey((value) => value + 1);
  });
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<HomePage refreshKey={refreshKey} />} />
        <Route path="/companies" element={<AdminOnly><CompaniesPage /></AdminOnly>} />
        <Route path="/companies/:id" element={<AdminOnly><CompanyDetail /></AdminOnly>} />
        <Route path="/open" element={<ClientOnly><IssuesPage refreshKey={refreshKey} view="open" /></ClientOnly>} />
        <Route path="/fixed" element={<ClientOnly><IssuesPage refreshKey={refreshKey} view="fixed" /></ClientOnly>} />
        <Route path="/pulls" element={<ClientOnly><IssuesPage refreshKey={refreshKey} view="create-pull" /></ClientOnly>} />
        <Route path="/merged" element={<ClientOnly><IssuesPage refreshKey={refreshKey} view="merge-pull" /></ClientOnly>} />
        <Route path="/closed" element={<ClientOnly><IssuesPage refreshKey={refreshKey} view="closed-pull" /></ClientOnly>} />
        <Route path="/performance" element={<ClientOnly><IssuesPage refreshKey={refreshKey} view="performance" /></ClientOnly>} />
        <Route path="/memory-leak" element={<ClientOnly><IssuesPage refreshKey={refreshKey} view="memory-leak" /></ClientOnly>} />
        <Route path="/issues/:id" element={<ClientOnly><IssueDetail /></ClientOnly>} />
        <Route path="/setup" element={<ClientOnly><SetupPage /></ClientOnly>} />
        <Route path="/team" element={<ClientOnly><TeamPage /></ClientOnly>} />
      </Routes>
    </Shell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="*" element={<Protected><AuthedApp /></Protected>} />
      </Routes>
    </AuthProvider>
  );
}
