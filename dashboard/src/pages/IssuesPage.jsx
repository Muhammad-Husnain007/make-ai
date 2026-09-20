import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getIssues, getStats } from '../lib/api.js';
import { timeAgo } from '../lib/time.js';
import { DROPDOWN_VIEWS, ISSUE_VIEWS, viewPath } from '../lib/views.js';
import { PullLink } from '../components/PullLink.jsx';
import { StatCard } from '../components/StatCard.jsx';
import { StatusPill } from '../components/StatusPill.jsx';

export function IssuesPage({ refreshKey, view = 'open' }) {
  const navigate = useNavigate();
  const [issues, setIssues] = useState(null);
  const [stats, setStats] = useState(null);
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [loadError, setLoadError] = useState('');
  const currentView = DROPDOWN_VIEWS.find((item) => item.id === view) || ISSUE_VIEWS[0];

  useEffect(() => {
    const timer = setTimeout(() => setQDebounced(q), 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getIssues({ status: view, q: qDebounced }),
      getStats(),
    ]).then(([issueData, statsData]) => {
      if (cancelled) return;
      setIssues(issueData.issues || []);
      setStats(statsData.stats);
      setLoadError('');
    }).catch((error) => {
      if (cancelled) return;
      setIssues([]);
      setLoadError(error.message);
    });
    return () => { cancelled = true; };
  }, [view, qDebounced, refreshKey]);

  useEffect(() => {
    const timer = setInterval(() => {
      getIssues({ status: view, q: qDebounced }).then((data) => setIssues(data.issues || [])).catch(() => {});
      getStats().then((data) => setStats(data.stats)).catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [view, qDebounced]);

  const chartData = useMemo(() => (stats?.series || []).map((row) => ({
    hour: row.hour.slice(11, 16),
    count: row.count,
  })), [stats]);

  return (
    <div className="p-8">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{currentView.label}</h1>
          <p className="mt-1 text-sm text-zinc-500">Grouped production exceptions, live-updated.</p>
        </div>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or culprit" className="h-10 w-64 rounded-lg border border-white/10 bg-ink-800 px-3 text-sm outline-none focus:border-orange-400/50" />
          <select value={view} onChange={(e) => navigate(viewPath(e.target.value))} className="h-10 rounded-lg border border-white/10 bg-ink-800 px-3 text-sm">
            {DROPDOWN_VIEWS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} ({stats?.[item.stat] ?? 0})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-4 gap-4">
        {ISSUE_VIEWS.map((item) => (
          <StatCard
            key={item.id}
            label={item.label}
            value={stats?.[item.stat] ?? '—'}
            icon={<item.icon size={16} />}
            active={item.id === view}
            onClick={() => navigate(item.to)}
          />
        ))}
      </div>

      <div className="mb-6 h-40 rounded-2xl border border-white/8 bg-ink-900 p-4">
        <div className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">Event volume · 24h</div>
        <ResponsiveContainer width="100%" height="85%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f97316" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="hour" stroke="#52525b" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis hide />
            <Tooltip contentStyle={{ background: '#161821', border: '1px solid #27272a', borderRadius: 12, fontSize: 12 }} />
            <Area type="monotone" dataKey="count" stroke="#fb923c" fill="url(#fill)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/8">
        <table className="w-full text-left text-sm">
          <thead className="bg-ink-900 text-[11px] uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3">Issue</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Users</th>
              <th className="px-4 py-3">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {issues === null && (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-zinc-500">Loading issues…</td></tr>
            )}
            {issues && issues.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-zinc-500">{loadError || currentView.empty}</td></tr>
            )}
            {(issues || []).map((issue) => (
              <tr key={issue.id} className="border-t border-white/5 bg-ink-900/40 hover:bg-white/[.03]">
                <td className="px-4 py-3">
                  <Link to={`/issues/${issue.id}`} className="block">
                    <div className="font-medium text-zinc-100">{issue.title}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-zinc-500">{issue.culprit || issue.fingerprint}</div>
                  </Link>
                  <PullLink url={issue.pr_url} className="mt-1 font-mono text-[11px]" />
                </td>
                <td className="px-4 py-3"><StatusPill status={issue.status} /></td>
                <td className="px-4 py-3 font-mono text-zinc-300">{issue.user_count}</td>
                <td className="px-4 py-3 text-zinc-400">{timeAgo(issue.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
