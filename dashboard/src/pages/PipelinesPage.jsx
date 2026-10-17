import { useEffect, useState } from 'react';
import { ExternalLink, GitBranch } from 'lucide-react';
import { getPipelines } from '../lib/api.js';

function runLabel(pipeline) {
  if (pipeline.status === 'idle') return 'No runs yet';
  if (pipeline.status && pipeline.status !== 'completed') return pipeline.status.replaceAll('_', ' ');
  return pipeline.conclusion || pipeline.status || 'Unknown';
}

function runColor(pipeline) {
  if (pipeline.status === 'idle') return 'text-zinc-400';
  if (pipeline.status !== 'completed') return 'text-sky-300';
  if (pipeline.conclusion === 'success') return 'text-emerald-300';
  if (pipeline.conclusion === 'failure' || pipeline.conclusion === 'timed_out') return 'text-red-300';
  return 'text-amber-300';
}

export function PipelinesPage({ refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = () => getPipelines().then((next) => {
      if (cancelled) return;
      setData(next);
      setError('');
    }).catch((err) => {
      if (cancelled) return;
      setError(err.message);
      setData({ pipelines: [], configuredRepos: 0 });
    });
    load();
    const timer = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [refreshKey]);

  const pipelines = data?.pipelines || [];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">CI/CD pipelines</h1>
        <p className="mt-1 text-sm text-zinc-500">GitHub Actions workflows and their latest run status from connected repositories.</p>
      </div>
      {error && <div className="mb-4 rounded-xl border border-red-400/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">{error}</div>}
      {data?.configuredRepos === 0 && (
        <div className="mb-4 rounded-xl border border-white/8 bg-ink-900 px-4 py-3 text-sm text-zinc-400">
          Connect a GitHub repository in Integrations to detect its workflows.
        </div>
      )}
      {data?.unavailableRepos?.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-400/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
          Could not read GitHub Actions for {data.unavailableRepos.join(', ')}. Check that the connected token can read repository Actions.
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-white/8">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-ink-900 text-[11px] uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3">Workflow</th>
              <th className="px-4 py-3">Repository</th>
              <th className="px-4 py-3">Latest run</th>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {!data && !error && <tr><td colSpan={6} className="px-4 py-12 text-center text-zinc-500">Loading workflows…</td></tr>}
            {data && pipelines.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-zinc-500">{data.configuredRepos ? 'No GitHub Actions workflows found in the connected repositories.' : 'No connected GitHub repositories.'}</td></tr>}
            {pipelines.map((pipeline) => (
              <tr key={pipeline.id} className="border-t border-white/5 bg-ink-900/40">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 font-medium text-zinc-100"><GitBranch size={15} className="text-zinc-500" />{pipeline.name}</div>
                  <div className="mt-0.5 pl-[23px] text-xs text-zinc-500">{pipeline.project}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-400">{pipeline.repo}</td>
                <td className={`px-4 py-3 capitalize ${runColor(pipeline)}`}>{runLabel(pipeline)}{pipeline.commit && <div className="mt-0.5 max-w-xs truncate text-xs text-zinc-500">{pipeline.commit}</div>}</td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-400">{pipeline.branch || '—'}</td>
                <td className="px-4 py-3 text-zinc-400">{pipeline.updatedAt ? new Date(pipeline.updatedAt).toLocaleString() : '—'}</td>
                <td className="px-4 py-3 text-right"><a href={pipeline.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-white">Open <ExternalLink size={13} /></a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
