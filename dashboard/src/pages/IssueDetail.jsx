import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Bot, GitPullRequest, Mail, Trash2 } from 'lucide-react';
import { getIssue, patchIssue, deleteIssue, runIssueAgent } from '../lib/api.js';
import { routes } from '../lib/routes.js';
import { timeAgo } from '../lib/time.js';
import { usePulseLive } from '../hooks/usePulseLive.js';
import { AgentPill } from '../components/AgentPill.jsx';
import { Badge } from '../components/Badge.jsx';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { Meta } from '../components/Meta.jsx';
import { PullLink } from '../components/PullLink.jsx';
import { Row } from '../components/Row.jsx';
import { StatusPill } from '../components/StatusPill.jsx';
import { issueStatus } from '../lib/issueStatus.js';

export function IssueDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [issue, setIssue] = useState(null);
  const [running, setRunning] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => getIssue(id).then((data) => setIssue(data.issue)).catch(() => setIssue(null));
  useEffect(() => { load(); }, [id]);
  usePulseLive((payload) => {
    const next = payload?.issue;
    if (!next || next.id !== id) return;
    if (next.deleted) {
      navigate(routes.errors, { replace: true });
      return;
    }
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

  if (!issue) return <div className="p-4 text-zinc-500 sm:p-8">Loading issue…</div>;
  const latest = issue.events?.[0];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <button onClick={() => navigate(routes.errors)} className="mb-5 text-sm text-zinc-500 hover:text-white">← All errors</button>
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2"><Badge level={issue.level} /><AgentPill status={issue.agent_status} /><StatusPill status={issueStatus(issue)} /></div>
          <h1 className="max-w-3xl break-words text-xl font-semibold tracking-tight sm:text-2xl">{issue.title}</h1>
          <p className="mt-2 break-all font-mono text-xs text-zinc-500">{issue.culprit}</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {['open', 'resolved', 'ignored'].map((status) => (
            <button
              key={status}
              onClick={async () => { await patchIssue(issue.id, status); load(); }}
              className={`rounded-lg border px-3 py-2 text-xs capitalize sm:flex-none flex-1 ${issue.status === status ? 'border-orange-400/40 bg-orange-500/15 text-orange-200' : 'border-white/10 text-zinc-400 hover:bg-white/5'}`}
            >
              {status}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setError(''); setConfirmDelete(true); }}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-red-400/30 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10 sm:flex-none"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </div>
      {error && <div className="mb-4 text-sm text-red-300">{error}</div>}

      <div className="mb-6 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <Meta label="Users affected" value={Number(issue.user_count || issue.affectedUsers?.length || 0)} />
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
              ? 'AI is testing a fix, then opening a pull request…'
              : issue.agent_status === 'maintenance'
                ? 'This issue is currently under maintenance. A pull request will appear here when it is ready.'
                : 'No pull request yet. The GitHub PR URL appears here as soon as the agent opens one.'}
          </p>
        )}
      </section>

      <section className="mb-5 rounded-2xl border border-orange-400/20 bg-orange-500/5 p-5">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
            className="w-full rounded-lg border border-orange-400/30 px-3 py-1.5 text-xs text-orange-200 hover:bg-orange-500/10 disabled:opacity-50 sm:w-auto"
          >
            {issue.agent_status === 'running' || running ? 'Testing fix…' : 'Run AI fix'}
          </button>
        </div>
        <p className="mb-3 text-sm text-zinc-400">
          {issue.agent_status === 'maintenance'
            ? 'This issue is currently under maintenance. Pulse is working on a fix.'
            : issue.agent_summary || 'New error/fatal issues trigger the agent automatically. It writes a fix, tests it, opens a PR on the client GitHub base branch, and emails the address the client registered.'}
        </p>
        {issue.agent_status === 'maintenance' ? (
          <div className="mb-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            This issue is currently under maintenance. You will see the pull request here when it is ready.
          </div>
        ) : (
          <>
            {/Secret files you must update/i.test(issue.agent_solution || '') ? (
              <div className="mb-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                Pulse will not read or commit secret files. Apply those local changes yourself; source-file fixes still go out as a pull request when they exist.
              </div>
            ) : null}
            {issue.agent_solution ? (
              <pre className="mb-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/30 p-3 font-mono text-[12px] text-orange-100/90">{issue.agent_solution}</pre>
            ) : null}
          </>
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.3fr_.7fr]">
        <section className="min-w-0 rounded-2xl border border-white/8 bg-ink-900 p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-semibold">Stack trace</h2>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-orange-100/90">{latest?.stack || 'No stack captured.'}</pre>
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
          <div className="rounded-2xl border border-white/8 bg-ink-900 p-5 text-sm">
            <h2 className="mb-3 text-sm font-semibold">Affected users</h2>
            {(issue.affectedUsers || []).length === 0 ? (
              <p className="text-sm text-zinc-500">No user identities captured for this issue yet.</p>
            ) : (
              (issue.affectedUsers || []).map((person) => (
                <Row
                  key={person.id}
                  k={person.email || person.id}
                  v={`${person.events} ${person.events === 1 ? 'event' : 'events'}`}
                />
              ))
            )}
          </div>
        </section>
      </div>
      {confirmDelete && (
        <ConfirmModal
          danger
          title="Delete issue"
          body={`Delete “${issue.title}”? Events for this issue will be removed. This cannot be undone.`}
          confirmLabel="Delete issue"
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            setError('');
            try {
              await deleteIssue(issue.id);
              navigate(routes.errors, { replace: true });
            } catch (err) {
              setError(err.message);
              setConfirmDelete(false);
            } finally {
              setBusy(false);
            }
          }}
          onCancel={() => { if (!busy) setConfirmDelete(false); }}
        />
      )}
    </div>
  );
}
