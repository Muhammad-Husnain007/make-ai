import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ChevronRight, DollarSign, GitPullRequest, Mail, PauseCircle } from 'lucide-react';
import { getAdminOverview, getStats } from '../lib/api.js';
import { CATEGORY_VIEWS, ISSUE_VIEWS } from '../lib/views.js';
import { StatCard } from '../components/StatCard.jsx';
import { useAuth } from '../hooks/useAuth.jsx';

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function AdminHome({ refreshKey }) {
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);

  useEffect(() => {
    getAdminOverview().then(setOverview).catch(() => setOverview(null));
  }, [refreshKey]);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Pulse admin</h1>
      <p className="mt-1 mb-8 text-sm text-zinc-500">Platform overview for companies, pull-request billing, and account status.</p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Companies" value={overview?.companies ?? '—'} icon={<Building2 size={16} />} onClick={() => navigate('/companies')} />
        <StatCard label="Active companies" value={overview?.activeCompanies ?? '—'} icon={<Building2 size={16} />} />
        <StatCard label="Paused companies" value={overview?.pausedCompanies ?? '—'} icon={<PauseCircle size={16} />} />
        <StatCard label="Total pull requests" value={overview?.pullRequests ?? '—'} icon={<GitPullRequest size={16} />} />
        <StatCard label="Revenue" value={overview ? money(overview.revenue) : '—'} icon={<DollarSign size={16} />} />
        <StatCard label="Pending invites" value={overview?.pendingInvites ?? '—'} icon={<Mail size={16} />} onClick={() => navigate('/companies')} />
      </div>
      <p className="mt-6 text-sm text-zinc-500">Each pull request is billed at {overview ? money(overview.pricePerPull) : '$0.05'}.</p>
    </div>
  );
}

export function HomePage({ refreshKey }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (user?.platformOwner) return;
    getStats().then((data) => setStats(data.stats)).catch(() => setStats(null));
  }, [refreshKey, user?.platformOwner]);

  if (user?.platformOwner) return <AdminHome refreshKey={refreshKey} />;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Pulse</h1>
      <p className="mt-1 mb-8 text-sm text-zinc-500">Open issues, pull requests, performance, and memory leaks from connected clients.</p>
      {!user?.platformOwner && !user?.company && (
        <div className="mb-8 rounded-2xl border border-orange-400/20 bg-orange-500/5 p-5 text-sm text-zinc-300">
          Waiting for a Pulse invitation. The Pulse owner sends a company invite to your email. After you accept, you own that dashboard and can invite your members.
        </div>
      )}

      <div className="mb-10">
        <h2 className="mb-4 text-sm font-semibold">Open issues</h2>
        <div className="grid grid-cols-4 gap-4">
          {ISSUE_VIEWS.map((item) => (
            <StatCard
              key={item.id}
              label={item.label}
              value={stats?.[item.stat] ?? '—'}
              icon={<item.icon size={16} />}
              onClick={() => navigate(item.to)}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-4">
        {CATEGORY_VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate(item.to)}
            className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-ink-900 px-6 py-8 text-left transition hover:border-white/20"
          >
            <div className="flex items-start gap-4">
              <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/5 text-zinc-200">
                <item.icon size={22} />
              </span>
              <div>
                <div className="text-lg font-semibold tracking-tight">{item.label}</div>
                <p className="mt-1 text-sm text-zinc-500">{item.blurb}</p>
              </div>
            </div>
            <ChevronRight size={20} className="shrink-0 text-zinc-500" />
          </button>
        ))}
      </div>
    </div>
  );
}
