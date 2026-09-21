import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { getAdminCompany, patchAdminCompany } from '../lib/api.js';

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function Field({ label, value, large }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-black/20 px-5 py-4">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-2 font-semibold tracking-tight text-zinc-100 ${large ? 'text-3xl' : 'text-lg'}`}>{value || '—'}</div>
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
    return <div className="flex flex-1 items-center p-8 text-sm text-zinc-500">Loading…</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-6">
      <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/5 bg-ink-900 p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link to="/companies" className="text-sm text-orange-300 hover:underline">Back to companies</Link>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{company?.name || 'Company'}</h1>
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
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${company.paused ? 'left-0.5' : 'left-[22px]'}`} />
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
          </div>
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
