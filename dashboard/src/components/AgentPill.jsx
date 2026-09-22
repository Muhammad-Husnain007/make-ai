const agentClass = {
  running: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  done: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  failed: 'bg-red-500/15 text-red-300 border-red-500/30',
  maintenance: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
  idle: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
};

export function AgentPill({ status }) {
  const value = status || 'idle';
  return (
    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${agentClass[value] || agentClass.idle}`}>
      {value === 'running' ? 'AI fixing' : value === 'done' ? 'AI done' : value === 'failed' ? 'AI failed' : value === 'maintenance' ? 'Maintenance' : 'AI idle'}
    </span>
  );
}
