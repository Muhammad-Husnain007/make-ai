import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getIssues, getStats } from '../lib/api.js';
import { DROPDOWN_VIEWS, ISSUE_VIEWS, CATEGORY_VIEWS, viewPath } from '../lib/views.js';
import { IssueTable } from '../components/IssueTable.jsx';
import { StatCard } from '../components/StatCard.jsx';

export function IssuesPage({ refreshKey, view = 'open' }) {
  const navigate = useNavigate();
  const [issues, setIssues] = useState(null);
  const [stats, setStats] = useState(null);
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [loadError, setLoadError] = useState('');
  const currentView = CATEGORY_VIEWS.find((item) => item.id === view)
    || DROPDOWN_VIEWS.find((item) => item.id === view)
    || ISSUE_VIEWS[0];
  const isCategory = CATEGORY_VIEWS.some((item) => item.id === view);

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

  return (
    <div className="p-8">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{currentView.label}</h1>
          <p className="mt-1 text-sm text-zinc-500">{currentView.blurb || 'Grouped production exceptions, live-updated.'}</p>
        </div>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or culprit" className="h-10 w-64 rounded-lg border border-white/10 bg-ink-800 px-3 text-sm outline-none focus:border-orange-400/50" />
          {!isCategory && (
          <select value={view} onChange={(e) => navigate(viewPath(e.target.value))} className="h-10 rounded-lg border border-white/10 bg-ink-800 px-3 text-sm">
            {DROPDOWN_VIEWS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label} ({stats?.[item.stat] ?? 0})
              </option>
            ))}
          </select>
          )}
        </div>
      </div>

      {!isCategory && (
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
      )}

      <IssueTable issues={issues} empty={loadError || currentView.empty} />
    </div>
  );
}
