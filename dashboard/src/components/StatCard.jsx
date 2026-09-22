export function StatCard({ label, value, icon, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-3 text-left transition sm:p-4 ${active ? 'border-orange-400/40 bg-orange-500/10' : 'border-white/8 bg-ink-900 hover:border-white/20'}`}
    >
      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-zinc-500 sm:mb-3">{icon} {label}</div>
      <div className="text-2xl font-semibold tracking-tight sm:text-3xl">{value}</div>
    </button>
  );
}
