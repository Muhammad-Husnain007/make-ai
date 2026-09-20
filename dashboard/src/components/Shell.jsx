import { NavLink, useLocation } from 'react-router-dom';
import { AlertTriangle, Radio, Settings2, ShieldAlert } from 'lucide-react';

export function Shell({ children, liveCount }) {
  const location = useLocation();
  const issuesActive = ['/', '/fixed', '/pulls', '/merged', '/closed'].includes(location.pathname) || location.pathname.startsWith('/issues/');
  return (
    <div className="min-h-screen bg-ink-950 text-zinc-100">
      <div className="flex min-h-screen">
        <aside className="w-60 shrink-0 border-r border-white/5 bg-ink-900 px-4 py-5">
          <div className="mb-8 flex items-center gap-3 px-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500 text-ink-950 shadow-[0_0_24px_rgba(249,115,22,.35)]">
              <ShieldAlert size={18} />
            </span>
            <div>
              <div className="text-sm font-bold tracking-tight">Pulse</div>
              <div className="text-[11px] text-zinc-500">Error command center</div>
            </div>
          </div>
          <nav className="space-y-1 text-sm">
            <NavLink to="/" className={() => `flex items-center gap-2 rounded-lg px-3 py-2 ${issuesActive ? 'bg-white/8 text-white' : 'text-zinc-400 hover:bg-white/4 hover:text-white'}`}>
              <AlertTriangle size={16} /> Issues
            </NavLink>
            <NavLink to="/live" className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2 ${isActive ? 'bg-white/8 text-white' : 'text-zinc-400 hover:bg-white/4 hover:text-white'}`}>
              <Radio size={16} /> Live
              {liveCount > 0 && <span className="ml-auto rounded-full bg-emerald-500/20 px-2 text-[10px] text-emerald-300">{liveCount}</span>}
            </NavLink>
            <NavLink to="/setup" className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2 ${isActive ? 'bg-white/8 text-white' : 'text-zinc-400 hover:bg-white/4 hover:text-white'}`}>
              <Settings2 size={16} /> Setup / SDK
            </NavLink>
          </nav>
          <div className="mt-10 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-3 text-[11px] text-emerald-200/90">
            <div className="mb-1 flex items-center gap-2 font-semibold"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Realtime on</div>
            New production errors stream in without refresh.
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
