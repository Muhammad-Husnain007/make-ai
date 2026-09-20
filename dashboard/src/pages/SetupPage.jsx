import { useEffect, useState } from 'react';
import { createProject, getProjects, patchProject } from '../lib/api.js';

export function SetupPage() {
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState('Checkout API');
  const [notifyEmail, setNotifyEmail] = useState('mh8169951@gmail.com');
  const [drafts, setDrafts] = useState({});
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);

  const refresh = async () => {
    const data = await getProjects();
    const list = data.projects || [];
    setProjects(list);
    setDrafts(Object.fromEntries(list.map((project) => [project.id, project.notify_email || ''])));
    setSelected((current) => current || list[0] || null);
    return list;
  };

  useEffect(() => {
    refresh().catch(() => setProjects([]));
  }, []);

  const active = selected || projects[0];
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:5173';
  const localDsn = `http://127.0.0.1:8787/ingest/${active?.public_key || 'YOUR_PUBLIC_KEY'}`;
  const dashboardDsn = `${origin}/ingest/${active?.public_key || 'YOUR_PUBLIC_KEY'}`;
  const snippet = `npm install @pulse/sdk

# .env
PULSE_DSN=${localDsn}

# package.json
"start": "node --import @pulse/sdk/register src/server.js"`;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Setup</h1>
      <p className="mt-1 mb-8 max-w-3xl text-sm text-zinc-500">Add Pulse to any local or production app with the project DSN. When an error arrives, the AI agent patches the client GitHub base branch, opens a PR with those changes, and emails that PR.</p>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/8 bg-ink-900 p-5 text-sm">
          <h2 className="mb-2 font-semibold">Local app</h2>
          <p className="mb-3 text-zinc-500">Keep Pulse API on this machine. Point the SDK at localhost.</p>
          <code className="block break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-[12px] text-orange-200">{localDsn}</code>
        </div>
        <div className="rounded-2xl border border-white/8 bg-ink-900 p-5 text-sm">
          <h2 className="mb-2 font-semibold">Production app</h2>
          <p className="mb-3 text-zinc-500">Deploy Pulse, then replace the host. Same project key works.</p>
          <code className="block break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-[12px] text-orange-200">https://pulse.yourdomain.com/ingest/{active?.public_key || 'YOUR_PUBLIC_KEY'}</code>
        </div>
      </div>

      <pre className="mb-8 overflow-auto rounded-2xl border border-white/8 bg-ink-900 p-5 font-mono text-[12px] leading-relaxed text-zinc-300">{snippet}</pre>

      <div className="rounded-2xl border border-white/8 bg-ink-900 p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Projects, DSN keys, PR email</h2>
            <p className="mt-1 text-xs text-zinc-500">Each project has its own DSN and the inbox that receives the AI fix / PR email. Comma-separated emails are allowed.</p>
          </div>
          <button
            onClick={async () => {
              try {
                const created = await createProject(name, notifyEmail);
                const list = await refresh();
                setSelected(created.project || list.find((item) => item.public_key === created.project?.public_key) || list[0]);
                setStatus('Project created');
              } catch (error) {
                setStatus(error.message);
              }
            }}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15"
          >
            Create project
          </button>
        </div>
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" className="h-9 w-full rounded-lg border border-white/10 bg-ink-800 px-3 text-sm" />
          <input value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} placeholder="PR alert email" className="h-9 w-full rounded-lg border border-white/10 bg-ink-800 px-3 text-sm" />
        </div>
        {status && <div className="mb-3 text-xs text-emerald-300">{status}</div>}
        <div className="space-y-3 text-sm">
          {projects.map((project) => (
            <div
              key={project.id}
              className={`rounded-xl border px-3 py-3 ${selected?.id === project.id ? 'border-orange-400/40 bg-orange-500/5' : 'border-white/8 bg-black/20'}`}
            >
              <button type="button" onClick={() => setSelected(project)} className="mb-2 flex w-full items-center justify-between text-left">
                <span className="font-medium">{project.name}</span>
                <code className="font-mono text-[11px] text-orange-200">{project.public_key}</code>
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-zinc-500">PR email</span>
                <input
                  value={drafts[project.id] ?? project.notify_email ?? ''}
                  onChange={(e) => setDrafts((current) => ({ ...current, [project.id]: e.target.value }))}
                  onClick={(e) => e.stopPropagation()}
                  className="h-8 min-w-[240px] flex-1 rounded-lg border border-white/10 bg-ink-800 px-3 text-xs"
                  placeholder="you@company.com"
                />
                <button
                  onClick={async (event) => {
                    event.stopPropagation();
                    try {
                      const data = await patchProject(project.id, { notifyEmail: drafts[project.id] });
                      await refresh();
                      setSelected(data.project);
                      setStatus(`PR emails for ${data.project.name} go to ${data.project.notify_email}`);
                    } catch (error) {
                      setStatus(error.message);
                    }
                  }}
                  className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-ink-950 hover:bg-orange-400"
                >
                  Save email
                </button>
              </div>
              <div className="mt-2 break-all font-mono text-[11px] text-zinc-500">Dashboard ingest: {dashboardDsn.replace(active?.public_key || '', project.public_key)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
