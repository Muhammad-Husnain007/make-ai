import { useEffect, useState } from 'react';
import { GitBranch, GitPullRequest, Mail, Send } from 'lucide-react';
import { getProjects } from '../lib/api.js';
import { usePulseLive } from '../hooks/usePulseLive.js';

function pickProject(list = []) {
  return list.find((item) => item.github_connected) || list.find((item) => item.notify_email || item.github_repo) || null;
}

export function ClientInfo() {
  const [project, setProject] = useState(null);

  const load = () => getProjects()
    .then((data) => setProject(pickProject(data.projects)))
    .catch(() => setProject(null));

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, []);

  usePulseLive((payload) => {
    if (!payload?.project) return;
    setProject((current) => {
      if (!current || current.id === payload.project.id) return payload.project;
      return current;
    });
  });

  const rows = [
    { k: 'Connected repo', v: project?.github_connected ? project.github_repo : 'not connected', icon: GitPullRequest },
    { k: 'Base branch', v: project?.github_base_branch || '—', icon: GitBranch },
    { k: 'Email', v: project?.notify_email || '—', icon: Mail },
    { k: 'Send PR via email', v: project?.send_email_enabled ? 'on' : 'off', icon: Send },
  ];

  return (
    <section className="rounded-2xl border border-white/8 bg-ink-900 p-4 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">Client connection</h2>
      <p className="mt-1 mb-6 max-w-3xl text-sm text-zinc-500">This is what the client app last registered. Change the client `.env` and restart that app — this card updates without a Pulse restart.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.k} className="rounded-2xl border border-white/8 bg-black/25 px-5 py-4">
            <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-500">
              <row.icon size={14} />
              {row.k}
            </div>
            <div className="break-all font-mono text-base text-zinc-100">{row.v}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
