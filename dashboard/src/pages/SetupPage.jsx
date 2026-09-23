import { useEffect, useState } from 'react';
import { getProjects } from '../lib/api.js';
import { usePulseLive } from '../hooks/usePulseLive.js';
import { ClientInfo } from '../components/ClientInfo.jsx';

function pickProject(list = []) {
  return list.find((item) => item.github_connected) || list.find((item) => item.notify_email || item.github_repo) || null;
}

function publicOrigin() {
  const fromEnv = String(import.meta.env.VITE_PUBLIC_URL || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/$/, '');
  }
  return '';
}

export function SetupPage() {
  const [project, setProject] = useState(null);

  const load = () => getProjects()
    .then((data) => setProject(pickProject(data.projects)))
    .catch(() => setProject(null));

  useEffect(() => { load(); }, []);
  usePulseLive((payload) => {
    if (payload?.project) setProject(payload.project);
  });

  const origin = publicOrigin();
  const dsn = `${origin || 'https://your-pulse-host'}/ingest/${project?.public_key || 'YOUR_PUBLIC_KEY'}`;
  const snippet = `npm install @pulse/sdk

# client .env
PULSE_DSN=${dsn}
PULSE_ENVIRONMENT=production
PULSE_NOTIFY_EMAIL=alerts@company.com
GITHUB_TOKEN=ghp_your_token
GITHUB_REPO=owner/repo
GITHUB_BASE_BRANCH=main
ISENABLEDSENDEMAIL=true

# package.json
"start": "node --import @pulse/sdk/register src/server.js"`;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Setup</h1>
      <p className="mt-1 mb-6 max-w-3xl text-sm text-zinc-500 sm:mb-8">Pulse is the SaaS. Copy the DSN into the client app, and let that app tell Pulse its GitHub repo, base branch, and PR email.</p>

      <div className="mb-6 rounded-2xl border border-white/8 bg-ink-900 p-5 text-sm">
        <h2 className="mb-2 font-semibold">Client DSN</h2>
        <p className="mb-3 text-zinc-500">Point the client SDK at this Pulse host.</p>
        <code className="block break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-[12px] text-orange-200">{dsn}</code>
      </div>

      <pre className="mb-8 overflow-auto rounded-2xl border border-white/8 bg-ink-900 p-4 font-mono text-[12px] leading-relaxed text-zinc-300 sm:p-5">{snippet}</pre>

      <ClientInfo />
    </div>
  );
}
