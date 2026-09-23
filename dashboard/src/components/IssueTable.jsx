import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { deleteIssue } from '../lib/api.js';
import { errorPath } from '../lib/routes.js';
import { timeAgo } from '../lib/time.js';
import { issueStatus } from '../lib/issueStatus.js';
import { ConfirmModal } from './ConfirmModal.jsx';
import { PullLink } from './PullLink.jsx';
import { StatusPill } from './StatusPill.jsx';

export function IssueTable({ issues, empty = 'No issues yet.', onDeleted }) {
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onConfirm = async () => {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      await deleteIssue(pending.id);
      onDeleted?.(pending.id);
      setPending(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/8">
      {error && <div className="border-b border-white/8 px-4 py-3 text-sm text-red-300">{error}</div>}
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-ink-900 text-[11px] uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="px-4 py-3">Issue</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3" title="How many users this issue happened for">Users</th>
            <th className="px-4 py-3">Last seen</th>
            <th className="px-4 py-3 text-right"> </th>
          </tr>
        </thead>
        <tbody>
          {issues === null && (
            <tr><td colSpan={5} className="px-4 py-12 text-center text-zinc-500">Loading issues…</td></tr>
          )}
          {issues && issues.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-12 text-center text-zinc-500">{empty}</td></tr>
          )}
          {(issues || []).map((issue) => (
            <tr key={issue.id} className="border-t border-white/5 bg-ink-900/40 hover:bg-white/[.03]">
              <td className="px-4 py-3">
                <Link to={errorPath(issue.id)} className="block">
                  <div className="font-medium text-zinc-100">{issue.title}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-zinc-500">{issue.culprit || issue.fingerprint}</div>
                </Link>
                <PullLink url={issue.pr_url} className="mt-1 font-mono text-[11px]" />
              </td>
              <td className="px-4 py-3"><StatusPill status={issueStatus(issue)} /></td>
              <td className="px-4 py-3 font-mono text-zinc-100" title="Users affected">
                {Number(issue.user_count || 0)}
              </td>
              <td className="px-4 py-3 text-zinc-400">{timeAgo(issue.last_seen)}</td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => { setError(''); setPending(issue); }}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
                  aria-label={`Delete ${issue.title}`}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pending && (
        <ConfirmModal
          danger
          title="Delete issue"
          body={`Delete “${pending.title}”? Events for this issue will be removed. This cannot be undone.`}
          confirmLabel="Delete issue"
          busy={busy}
          onConfirm={onConfirm}
          onCancel={() => { if (!busy) setPending(null); }}
        />
      )}
    </div>
  );
}
