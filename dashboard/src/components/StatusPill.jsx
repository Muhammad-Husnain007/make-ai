const statusClass = {
  open: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  resolved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  ignored: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
};

export function StatusPill({ status }) {
  const value = status || 'open';
  return (
    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClass[value] || statusClass.open}`}>
      {value}
    </span>
  );
}
