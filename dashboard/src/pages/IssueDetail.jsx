import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Bot, GitPullRequest, Mail } from 'lucide-react';
import { getIssue, patchIssue, runIssueAgent } from '../lib/api.js';
import { timeAgo } from '../lib/time.js';
import { usePulseLive } from '../hooks/usePulseLive.js';
import { AgentPill } from '../components/AgentPill.jsx';
import { Badge } from '../components/Badge.jsx';
import { Meta } from '../components/Meta.jsx';
import { PullLink } from '../components/PullLink.jsx';
import { Row } from '../components/Row.jsx';

export function IssueDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [issue, setIssue] = useState(null);
  const [running, setRunning] = useState(false);

  const load = () => getIssue(id).then((data) => setIssue(data.issue)).catch(() => setIssue(null));
  useEffect(() => { load(); }, [id]);
  usePulseLive((payload) => {
    const next = payload?.issue;
    if (!next || next.id !== id) return;
    setIssue((current) => {
      if (!current) return next;
      return {
        ...current,
        ...next,
        events: next.events?.length ? next.events : current.events,
        hourly: next.hourly || current.hourly,
      };
    });
  });

  if (!issue) return <div className="p-8 text-zinc-500">Loading issue…</div>;
  const latest = issue.events?.[0];

  return (
    <div className="p-8">
      <button onClick={() => navigate('/')} className="mb-5 text-sm text-zinc-500 hover:text-white">← All issues</button>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2"><Badge level={issue.level} /><AgentPill status={issue.agent_status} /><span className="text-xs text-zinc-500">{issue.status}</span></div>
          <h1 className="max-w-3xl text-2xl font-semibold tracking-tight">{issue.title}</h1>
          <p className="mt-2 font-mono text-xs text-zinc-500">{issue.culprit}</p>
        </div>
        <div className="flex gap-2">
          {['open', 'resolved', 'ignored'].map((status) => (
            <button
              key={status}
              onClick={async () => { await patchIssue(issue.id, status); load(); }}
              className={`rounded-lg border px-3 py-2 text-xs capitalize ${issue.status === status ? 'border-orange-400/40 bg-orange-500/15 text-orange-200' : 'border-white/10 text-zinc-400 hover:bg-white/5'}`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-4 gap-3 text-sm">
        <Meta label="Events" value={issue.count} />
        <Meta label="Users" value={issue.user_count} />
        <Meta label="First seen" value={timeAgo(issue.first_seen)} />
        <Meta label="Last seen" value={timeAgo(issue.last_seen)} />
      </div>

      <section className="mb-5 rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><GitPullRequest size={16} /> Pull request</h2>
        {issue.pr_url ? (
          <PullLink url={issue.pr_url} className="font-mono text-sm" />
        ) : (
          <p className="text-sm text-zinc-500">
            {issue.agent_status === 'running'
              ? 'AI is opening a pull request…'
              : 'No pull request yet. The GitHub PR URL appears here as soon as the agent opens one.'}
          </p>
        )}
      </section>

      <section className="mb-5 rounded-2xl border border-orange-400/20 bg-orange-500/5 p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Bot size={16} /> AI agent</h2>
          <button
            disabled={running || issue.agent_status === 'running'}
            onClick={async () => {
              setRunning(true);
              try {
                const data = await runIssueAgent(issue.id);
                if (data?.issue) {
                  setIssue((current) => ({
                    ...current,
                    ...data.issue,
                    events: current.events,
                    hourly: current.hourly,
                  }));
                }
              } finally {
                setRunning(false);
              }
            }}
            className="rounded-lg border border-orange-400/30 px-3 py-1.5 text-xs text-orange-200 hover:bg-orange-500/10 disabled:opacity-50"
          >
            {issue.agent_status === 'running' || running ? 'Finding fix…' : 'Run AI fix'}
          </button>
        </div>
        <p className="mb-3 text-sm text-zinc-400">{issue.agent_summary || 'New error/fatal issues trigger the agent automatically. It writes a fix on the client GitHub base branch, opens a PR, and emails the address the client registered.'}</p>
        {issue.agent_solution && (
          <pre className="mb-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-black/30 p-3 font-mono text-[12px] text-orange-100/90">{issue.agent_solution}</pre>
        )}
        <div className="flex flex-wrap gap-4 text-xs text-zinc-400">
          {issue.pr_url && <PullLink url={issue.pr_url} className="text-xs" />}
          <span className="inline-flex items-center gap-1">
            <Mail size={14} />
            PR alerts: {issue.emailed_to || issue.notify_email || 'not set'}
            {issue.emailed_at ? ` · sent ${timeAgo(issue.emailed_at)}` : ''}
          </span>
        </div>
      </section>

      <div className="grid grid-cols-[1.3fr_.7fr] gap-5">
        <section className="rounded-2xl border border-white/8 bg-ink-900 p-5">
          <h2 className="mb-3 text-sm font-semibold">Stack trace</h2>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-orange-100/90">{latest?.stack || 'No stack captured.'}</pre>
        </section>
        <section className="space-y-5">
          <div className="rounded-2xl border border-white/8 bg-ink-900 p-5 text-sm">
            <h2 className="mb-3 text-sm font-semibold">Context</h2>
            <Row k="Pull request" v={issue.pr_url ? <PullLink url={issue.pr_url} className="text-xs" /> : null} />
            <Row k="URL" v={latest?.url} />
            <Row k="Environment" v={latest?.environment} />
            <Row k="Release" v={latest?.release} />
            <Row k="User" v={latest?.user?.email || latest?.user?.id || 'anonymous'} />
            <Row k="SDK" v={latest?.sdk} />
          </div>
        </section>
      </div>
    </div>
  );
}
