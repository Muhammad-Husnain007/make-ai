const levelClass = {
  fatal: 'bg-red-500/15 text-red-300 border-red-500/30',
  error: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  warning: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
  info: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  debug: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
};

export function Badge({ level }) {
  return (
    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${levelClass[level] || levelClass.error}`}>
      {level || 'error'}
    </span>
  );
}
