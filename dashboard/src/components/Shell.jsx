import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Building2, Gauge, LogOut, MemoryStick, Settings2, ShieldAlert, Users } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.jsx';

export function Shell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const homeActive = location.pathname === '/';
  const issuesActive = ['/open', '/fixed', '/pulls', '/merged', '/closed'].includes(location.pathname) || location.pathname.startsWith('/issues/');
  const admin = Boolean(user?.platformOwner);
  return (
    <div className="min-h-screen bg-ink-950 text-zinc-100">
      <div className="flex min-h-screen">
        <aside className="flex w-60 shrink-0 flex-col border-r border-white/5 bg-ink-900 px-4 py-5">
          <NavLink to="/" className="mb-8 flex items-center gap-3 px-2">
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500 text-ink-950 shadow-[0_0_24px_rgba(249,115,22,.35)] ${homeActive ? 'ring-2 ring-orange-200/40' : ''}`}>
              <ShieldAlert size={18} />
            </span>
            <div>
              <div className="text-sm font-bold tracking-tight">Pulse</div>
              <div className="text-[11px] text-zinc-500">{admin ? 'Platform admin' : 'Error command center'}</div>
            </div>
          </NavLink>
          <nav className="space-y-1 text-sm">
            {admin ? (
              <NavLink to="/companies" className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2 ${isActive || location.pathname.startsWith('/companies/') ? 'bg-white/8 text-white' : 'text-zinc-400 hover:bg-white/4 hover:text-white'}`}>
                <Building2 size={16} /> Companies
              </NavLink>
            ) : (
              <>
                <NavLink to="/open" className={() => `flex items-center gap-2 rounded-lg px-3 py-2 ${issuesActive ? 'bg-white/8 text-white' : 'text-zinc-400 hover:bg-white/4 hover:text-white'}`}>
                  <AlertTriangle size={16} /> Issues
                </NavLink>
                <NavLink to="/performance" className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2 ${isActive ? 'bg-white/8 text-white' : 'text-zinc-400 hover:bg-white/4 hover:text-white'}`}>
                  <Gauge size={16} /> Performance optimization
                </NavLink>
                <NavLink to="/memory-leak" className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2 ${isActive ? 'bg-white/8 text-white' : 'text-zinc-400 hover:bg-white/4 hover:text-white'}`}>
                  <MemoryStick size={16} /> Memory leak
                </NavLink>
                <NavLink to="/setup" className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2 ${isActive ? 'bg-white/8 text-white' : 'text-zinc-400 hover:bg-white/4 hover:text-white'}`}>
                  <Settings2 size={16} /> Setup / SDK
                </NavLink>
                <NavLink to="/team" className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2 ${isActive ? 'bg-white/8 text-white' : 'text-zinc-400 hover:bg-white/4 hover:text-white'}`}>
                  <Users size={16} /> Team
                </NavLink>
              </>
            )}
          </nav>
          <div className="mt-auto border-t border-white/5 pt-4">
            <div className="px-3 text-sm font-medium text-zinc-200">{user?.name}</div>
            <div className="truncate px-3 font-mono text-[11px] text-zinc-500">{user?.email}</div>
            <div className="mb-3 px-3 text-[11px] text-zinc-500">
              {user?.platformOwner ? 'Pulse owner' : user?.company ? `${user.company.name} · ${user.company.role}` : 'No company yet'}
            </div>
            <button
              type="button"
              onClick={async () => {
                await logout();
                navigate('/login', { replace: true });
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-white/4 hover:text-white"
            >
              <LogOut size={16} /> Logout
            </button>
          </div>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
