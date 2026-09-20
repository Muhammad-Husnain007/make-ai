export function Meta({ label, value }) {
  return (
    <div className="rounded-xl border border-white/8 bg-ink-900 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}
