export function Row({ k, v }) {
  return (
    <div className="border-b border-white/5 py-2 text-xs last:border-0">
      <div className="text-zinc-500">{k}</div>
      <div className="mt-0.5 break-all font-mono text-zinc-300">{v || '—'}</div>
    </div>
  );
}
