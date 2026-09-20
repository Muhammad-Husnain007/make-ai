export function StatCard({ label, value, icon, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition ${active ? 'border-orange-400/40 bg-orange-500/10' : 'border-white/8 bg-ink-900 hover:border-white/20'}`}
    >
      <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-500">{icon} {label}</div>
      <div className="text-3xl font-semibold tracking-tight">{value}</div>
    </button>
  );
}
