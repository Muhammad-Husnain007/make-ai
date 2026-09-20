import { useEffect, useState } from 'react';
import { createProject, getProjects } from '../lib/api.js';

export function SetupPage() {
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState('Checkout API');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);

  const refresh = async () => {
    const data = await getProjects();
    const list = data.projects || [];
    setProjects(list);
    setSelected((current) => current || list[0] || null);
    return list;
  };

  useEffect(() => {
    refresh().catch(() => setProjects([]));
  }, []);

  const active = selected || projects[0];
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:5173';
  const localDsn = `http://127.0.0.1:8787/ingest/${active?.public_key || 'YOUR_PUBLIC_KEY'}`;
  const snippet = `npm install @pulse/sdk

# client .env
PULSE_DSN=${localDsn}
PULSE_NOTIFY_EMAIL=alerts@company.com
GITHUB_TOKEN=ghp_your_token
GITHUB_REPO=owner/repo
GITHUB_BASE_BRANCH=main

# package.json
"start": "node --import @pulse/sdk/register src/server.js"`;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Setup</h1>
      <p className="mt-1 mb-8 max-w-3xl text-sm text-zinc-500">Pulse is the SaaS. Create a project, copy the DSN into the client app, and let that app tell Pulse its GitHub repo, base branch, and PR email.</p>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/8 bg-ink-900 p-5 text-sm">
          <h2 className="mb-2 font-semibold">Local client</h2>
          <p className="mb-3 text-zinc-500">Point the client SDK at this Pulse API.</p>
          <code className="block break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-[12px] text-orange-200">{localDsn}</code>
        </div>
        <div className="rounded-2xl border border-white/8 bg-ink-900 p-5 text-sm">
          <h2 className="mb-2 font-semibold">Production client</h2>
          <p className="mb-3 text-zinc-500">Same project key, your Pulse host.</p>
          <code className="block break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-[12px] text-orange-200">https://pulse.yourdomain.com/ingest/{active?.public_key || 'YOUR_PUBLIC_KEY'}</code>
        </div>
      </div>

      <pre className="mb-8 overflow-auto rounded-2xl border border-white/8 bg-ink-900 p-5 font-mono text-[12px] leading-relaxed text-zinc-300">{snippet}</pre>

      <div className="rounded-2xl border border-white/8 bg-ink-900 p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Projects</h2>
            <p className="mt-1 text-xs text-zinc-500">Repo, branch, and PR inbox come from the client SDK on startup — Pulse does not own those keys.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" className="h-9 min-w-[180px] rounded-lg border border-white/10 bg-ink-800 px-3 text-sm" />
            <button
              onClick={async () => {
                try {
                  const created = await createProject(name);
                  const list = await refresh();
                  setSelected(created.project || list.find((item) => item.public_key === created.project?.public_key) || list[0]);
                  setStatus('Project created. Put the DSN in the client app.');
                } catch (error) {
                  setStatus(error.message);
                }
              }}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15"
            >
              Create project
            </button>
          </div>
        </div>
        {status && <div className="mb-3 text-xs text-emerald-300">{status}</div>}
        <div className="space-y-3 text-sm">
          {projects.map((project) => (
            <button
              type="button"
              key={project.id}
              onClick={() => setSelected(project)}
              className={`w-full rounded-xl border px-3 py-3 text-left ${selected?.id === project.id ? 'border-orange-400/40 bg-orange-500/5' : 'border-white/8 bg-black/20'}`}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-medium">{project.name}</span>
                <code className="font-mono text-[11px] text-orange-200">{project.public_key}</code>
              </div>
              <div className="grid gap-1 font-mono text-[11px] text-zinc-400">
                <div>GitHub: {project.github_connected ? project.github_repo : 'not connected by client'}</div>
                <div>Base branch: {project.github_base_branch || '—'}</div>
                <div>PR email: {project.notify_email || '—'}</div>
              </div>
              <div className="mt-2 break-all font-mono text-[11px] text-zinc-500">{`${origin}/ingest/${project.public_key}`}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
