import { useEffect, useState } from 'react';
import { ListTodo } from 'lucide-react';
import { getQueues } from '../lib/api.js';

const QUEUE_LABELS = {
  scan: 'Scan issue',
  fix: 'Fix issue',
  pr: 'Make PR',
  invite: 'Invitation email',
};

function timeAgo(value) {
  if (!value) return '—';
  const ms = Date.now() - Number(value);
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(Number(value)).toLocaleString();
}

function openBoard() {
  try {
    const token = localStorage.getItem('pulse_auth_token') || '';
    document.cookie = `pulse_auth=${encodeURIComponent(token)}; path=/`;
  } catch {}
  window.open('/queues/ui', '_blank', 'noopener,noreferrer');
}

export function JobsPage({ refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [queueName, setQueueName] = useState('scan');

  const load = () => getQueues()
    .then(setData)
    .catch((err) => setError(err.message));

  useEffect(() => {
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [refreshKey]);

  const selected = data?.queues?.find((item) => item.name === queueName) || data?.queues?.[0];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Jobs</h1>
          <p className="mt-1 text-sm text-zinc-500">BullMQ background jobs for scan, fix, pull requests, and invitation emails.</p>
        </div>
        {data?.enabled && (
          <button type="button" onClick={openBoard} className="h-10 w-full rounded-lg bg-orange-500 px-4 text-sm font-medium text-ink-950 sm:w-auto">
            Open queue dashboard
          </button>
        )}
      </div>

      {error && <div className="mb-4 text-sm text-red-300">{error}</div>}

      <div className="mb-6 flex flex-wrap gap-3 text-sm">
        <span className={`rounded-full px-3 py-1 ${data?.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-zinc-400'}`}>
          ISQUEUEENABLE={String(Boolean(data?.enabled))}
        </span>
        <span className={`rounded-full px-3 py-1 ${data?.ready ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-zinc-400'}`}>
          {data?.ready ? 'Redis connected' : data?.enabled ? 'Redis not connected — jobs run inline' : 'Jobs run inline'}
        </span>
        {data?.redis && <span className="rounded-full bg-white/5 px-3 py-1 font-mono text-xs text-zinc-400">{data.redis}</span>}
      </div>
      {data?.redisError && <div className="mb-4 text-sm text-red-300">{data.redisError}</div>}

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(data?.queues || Object.keys(QUEUE_LABELS).map((name) => ({ name, counts: {} }))).map((queue) => (
          <button
            key={queue.name}
            type="button"
            onClick={() => setQueueName(queue.name)}
            className={`rounded-2xl border p-4 text-left ${queueName === queue.name ? 'border-orange-400/40 bg-orange-500/10' : 'border-white/5 bg-ink-900'}`}
          >
            <div className="text-sm font-medium text-white">{QUEUE_LABELS[queue.name] || queue.name}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-400">
              <span>Waiting {queue.counts?.waiting ?? 0}</span>
              <span>Active {queue.counts?.active ?? 0}</span>
              <span>Completed {queue.counts?.completed ?? 0}</span>
              <span>Failed {queue.counts?.failed ?? 0}</span>
            </div>
          </button>
        ))}
      </div>

      <section className="overflow-x-auto rounded-2xl border border-white/5">
        <div className="flex items-center gap-2 bg-ink-900 px-4 py-3 text-sm font-medium">
          <ListTodo size={16} /> {QUEUE_LABELS[selected?.name] || 'Jobs'}
        </div>
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-ink-900 text-[11px] uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-2">Job</th>
              <th className="px-4 py-2">State</th>
              <th className="px-4 py-2">Target</th>
              <th className="px-4 py-2">When</th>
            </tr>
          </thead>
          <tbody>
            {(selected?.jobs || []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-zinc-500">No jobs in this queue yet.</td>
              </tr>
            )}
            {(selected?.jobs || []).map((job) => (
              <tr key={`${job.queue}-${job.id}`} className="border-t border-white/5">
                <td className="px-4 py-3 font-mono text-xs">{job.name} #{job.id}</td>
                <td className="px-4 py-3 capitalize">{job.state}</td>
                <td className="px-4 py-3 text-xs text-zinc-400">
                  {job.data?.to || job.data?.issueId || '—'}
                  {job.failedReason ? <div className="mt-1 text-red-300">{job.failedReason}</div> : null}
                </td>
                <td className="px-4 py-3 text-zinc-500">{timeAgo(job.finishedOn || job.processedOn || job.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
