import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Bell, Building2, CheckCircle2, Gauge, GitBranch, LogOut, Menu, Settings2, ShieldAlert, Users, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.jsx';
import { getProjects } from '../lib/api.js';
import { isErrorsSection, routes } from '../lib/routes.js';
import { ConfirmModal } from './ConfirmModal.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';

export function Shell({ children, unread = 0 }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [toast, setToast] = useState('');
  const [connectedToast, setConnectedToast] = useState(false);
  const homeActive = location.pathname === routes.home;
  const issuesActive = isErrorsSection(location.pathname);
  const admin = Boolean(user?.platformOwner);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!user || user.platformOwner) return undefined;
    let cancelled = false;
    let timer;
    getProjects().then(({ projects = [] }) => {
      if (cancelled || !projects.some((project) => project.github_connected)) return;
      setConnectedToast(true);
      timer = window.setTimeout(() => setConnectedToast(false), 5000);
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [user?.email]);

  const confirmSignOut = async () => {
    setLoggingOut(true);
    await logout();
    navigate(routes.signIn, {
      replace: true,
      state: { toast: 'You have been logged out successfully.' },
    });
  };

  const linkClass = (active) => `flex items-center gap-2 rounded-lg px-3 py-2 ${active ? 'bg-white/8 text-white' : 'text-zinc-400 hover:bg-white/4 hover:text-white'}`;

  return (
    <div className="min-h-screen bg-ink-950 text-zinc-100">
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-white/5 bg-ink-900 px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="rounded-lg p-2 text-zinc-300 hover:bg-white/5"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <NavLink to={routes.home} className="flex min-w-0 items-center gap-2">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-ink-950 ${homeActive ? 'ring-2 ring-orange-200/40' : ''}`}>
            <ShieldAlert size={16} />
          </span>
          <span className="truncate text-sm font-bold tracking-tight">Pulse</span>
        </NavLink>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {admin && (
            <NavLink
              to={routes.alerts}
              className={({ isActive }) => `relative rounded-lg p-2 ${isActive ? 'bg-white/8 text-white' : 'text-zinc-400 hover:bg-white/4 hover:text-white'}`}
              title="Notifications"
            >
              <Bell size={18} />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-orange-500 px-1 text-center text-[10px] font-bold leading-4 text-ink-950">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </NavLink>
          )}
        </div>
      </header>

      {menuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <div className="flex min-h-[calc(100dvh-57px)] lg:min-h-screen">
        <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 max-w-[85vw] flex-col border-r border-white/5 bg-ink-900 px-4 py-5 transition-transform duration-200 lg:static lg:z-0 lg:w-60 lg:max-w-none lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="mb-8 flex items-start justify-between gap-2">
            <NavLink to={routes.home} className="flex min-w-0 items-center gap-3 px-2">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-ink-950 shadow-[0_0_24px_rgba(249,115,22,.35)] ${homeActive ? 'ring-2 ring-orange-200/40' : ''}`}>
                <ShieldAlert size={18} />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-bold tracking-tight">Pulse</div>
                <div className="text-[11px] text-zinc-500">{admin ? 'Platform admin' : 'Error command center'}</div>
              </div>
            </NavLink>
            <div className="flex items-center">
              {admin && (
                <NavLink
                  to={routes.alerts}
                  className={({ isActive }) => `relative mt-1 hidden rounded-lg p-2 lg:inline-flex ${isActive ? 'bg-white/8 text-white' : 'text-zinc-400 hover:bg-white/4 hover:text-white'}`}
                  title="Notifications"
                >
                  <Bell size={18} />
                  {unread > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-orange-500 px-1 text-center text-[10px] font-bold leading-4 text-ink-950">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </NavLink>
              )}
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-white lg:hidden"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <nav className="space-y-1 overflow-y-auto text-sm">
            {admin ? (
              <>
                <NavLink to={routes.accounts} className={({ isActive }) => linkClass(isActive || location.pathname.startsWith(`${routes.accounts}/`))}>
                  <Building2 size={16} /> Accounts
                </NavLink>
              </>
            ) : (
              <>
                <NavLink to={routes.errors} className={() => linkClass(issuesActive)}>
                  <AlertTriangle size={16} /> Errors
                </NavLink>
                <NavLink to={routes.performance} className={({ isActive }) => linkClass(isActive || location.pathname.startsWith('/insights/performance'))}>
                  <Gauge size={16} /> Performance
                </NavLink>
                <NavLink to={routes.pipelines} className={({ isActive }) => linkClass(isActive)}>
                  <GitBranch size={16} /> CI/CD pipelines
                </NavLink>
                <NavLink to={routes.integrations} className={({ isActive }) => linkClass(isActive)}>
                  <Settings2 size={16} /> Integrations
                </NavLink>
                <NavLink to={routes.organization} className={({ isActive }) => linkClass(isActive)}>
                  <Users size={16} /> Organization
                </NavLink>
              </>
            )}
          </nav>
          <div className="mt-auto border-t border-white/5 pt-4">
            <div className="truncate px-3 text-sm font-medium text-zinc-200">{user?.name}</div>
            <div className="truncate px-3 font-mono text-[11px] text-zinc-500">{user?.email}</div>
            <div className="mb-3 truncate px-3 text-[11px] text-zinc-500">
              {user?.platformOwner ? 'Pulse owner' : user?.company ? `${user.company.name} · ${user.company.role}` : 'No company yet'}
            </div>
            <ThemeToggle labeled />
            <button
              type="button"
              onClick={() => setConfirmLogout(true)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-white/4 hover:text-white"
            >
              <LogOut size={16} /> Logout
            </button>
          </div>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">{children}</main>
      </div>
      {confirmLogout && (
        <ConfirmModal
          title="Log out of Pulse?"
          body="You will need to sign in again to access your dashboard."
          confirmLabel="Log out"
          busy={loggingOut}
          danger
          onConfirm={confirmSignOut}
          onCancel={() => {
            if (loggingOut) return;
            setConfirmLogout(false);
            setToast('Logout cancelled.');
          }}
        />
      )}
      {toast && (
        <div role="status" className="fixed bottom-5 right-5 z-[60] rounded-xl border border-white/10 bg-ink-900 px-4 py-3 text-sm text-zinc-100 shadow-2xl">
          {toast}
        </div>
      )}
      {connectedToast && (
        <div role="status" className="fixed bottom-5 left-5 z-[60] flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-ink-900 px-4 py-3 text-sm text-zinc-100 shadow-2xl">
          <CheckCircle2 size={18} className="text-emerald-400" />
          Woo! Connected to Pulse
        </div>
      )}
    </div>
  );
}
