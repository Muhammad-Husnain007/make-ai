import { Link } from 'react-router-dom';
import { timeAgo } from '../lib/time.js';
import { PullLink } from './PullLink.jsx';
import { StatusPill } from './StatusPill.jsx';

export function IssueTable({ issues, empty = 'No issues yet.' }) {
  return (
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
            <tr><td colSpan={4} className="px-4 py-12 text-center text-zinc-500">{empty}</td></tr>
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
  );
}
