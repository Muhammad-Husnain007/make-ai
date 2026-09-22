import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { getAdminCompany, patchAdminCompany } from '../lib/api.js';
import { timeAgo } from '../lib/time.js';

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function Field({ label, value, large }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-black/20 px-5 py-4">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-2 break-words font-semibold tracking-tight text-zinc-100 ${large ? 'text-2xl sm:text-3xl' : 'text-lg'}`}>{value || '—'}</div>
    </div>
  );
}

export function CompanyDetail() {
  const { id } = useParams();
  const [company, setCompany] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    getAdminCompany(id)
      .then((data) => setCompany(data.company))
      .catch((err) => setError(err.message));
  }, [id]);

  const onConfirm = async () => {
    if (!company || !confirm) return;
    setBusy(true);
    setError('');
    try {
      const data = await patchAdminCompany(company.id, { paused: confirm === 'pause' });
      setCompany(data.company);
      setConfirm(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!company && !error) {
    return <div className="flex flex-1 items-center p-4 text-sm text-zinc-500 sm:p-8">Loading…</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
      <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/5 bg-ink-900 p-4 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link to="/companies" className="text-sm text-orange-300 hover:underline">Back to companies</Link>
            <h1 className="mt-3 break-words text-2xl font-semibold tracking-tight sm:text-3xl">{company?.name || 'Company'}</h1>
            <p className="mt-1 text-sm text-zinc-500">Billing card — $0.05 for each pull request Pulse opens for this company.</p>
          </div>
          {company && (
            <label className="flex items-center gap-3 text-sm">
              <span className="text-zinc-400">{company.paused ? 'Paused' : 'Active'}</span>
              <button
                type="button"
                role="switch"
                aria-checked={!company.paused}
                onClick={() => setConfirm(company.paused ? 'resume' : 'pause')}
                className={`relative h-6 w-11 rounded-full transition ${company.paused ? 'bg-white/10' : 'bg-orange-500'}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#fff] transition ${company.paused ? 'left-0.5' : 'left-[22px]'}`} />
              </button>
            </label>
          )}
        </div>

        {error && <div className="mt-4 text-sm text-red-300">{error}</div>}

        {company && (
          <div className="mt-8 grid flex-1 content-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Name" value={company.name} />
            <Field label="Email" value={company.email || 'pending'} />
            <Field label="Address" value={company.address} />
            <Field label="Total pull requests" value={String(company.pullRequests)} large />
            <Field label="Per pull request" value={money(company.pricePerPull)} large />
            <Field label="Total cost" value={money(company.totalCost)} large />
            <Field label="Unread agent errors" value={String(company.unreadNotifications || 0)} />
          </div>
        )}

        {company?.notifications?.length > 0 && (
          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Agent errors</h2>
              <Link to={`/notifications?companyId=${company.id}`} className="text-xs text-orange-300 hover:underline">View all</Link>
            </div>
            <div className="space-y-3">
              {company.notifications.slice(0, 8).map((note) => (
                <div key={note.id} className={`rounded-xl border px-4 py-3 ${note.readAt ? 'border-white/5 bg-black/20' : 'border-orange-400/20 bg-orange-500/5'}`}>
                  <div className="text-sm font-medium text-zinc-100">{note.title}</div>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[12px] text-red-200">{note.message}</pre>
                  <div className="mt-2 text-[11px] text-zinc-500">{timeAgo(note.createdAt)}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </section>

      {confirm && (
        <ConfirmModal
          title={confirm === 'pause' ? 'Pause this company?' : 'Resume this company?'}
          body={confirm === 'pause'
            ? 'Error ingest and AI pull requests will stop until you resume this company.'
            : 'This company will start sending errors and receiving AI pull requests again.'}
          confirmLabel={confirm === 'pause' ? 'Pause company' : 'Resume company'}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={onConfirm}
        />
      )}
    </div>
  );
}
