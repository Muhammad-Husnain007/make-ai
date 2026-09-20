import { Link } from 'react-router-dom';
import { timeAgo } from '../lib/time.js';
import { Badge } from '../components/Badge.jsx';

export function LivePage({ events }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Live tail</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-500">Incoming production events, newest first.</p>
      <div className="space-y-2">
        {events.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-zinc-500">Waiting for the next crash…</div>}
        {events.map((item) => (
          <Link key={item.event.id} to={`/issues/${item.issue.id}`} className="flex items-start justify-between gap-4 rounded-xl border border-white/8 bg-ink-900 px-4 py-3 hover:border-orange-400/30">
            <div>
              <div className="flex items-center gap-2"><Badge level={item.issue.level} /><span className="font-medium">{item.event.message}</span></div>
              <div className="mt-1 font-mono text-[11px] text-zinc-500">{item.event.url || item.issue.culprit}</div>
            </div>
            <div className="text-xs text-zinc-500">{timeAgo(item.event.timestamp)}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
