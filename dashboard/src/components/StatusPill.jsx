const statusClass = {
  pending: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
  resolved: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  merged: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

export function StatusPill({ status }) {
  const value = status === 'resolved' || status === 'merged' ? status : 'pending';
  return (
    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClass[value]}`}>
      {value}
    </span>
  );
}
