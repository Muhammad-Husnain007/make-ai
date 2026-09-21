import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAdminCompanies, getTeam, inviteCompany, resendInvite } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.jsx';

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function copy(value) {
  navigator.clipboard?.writeText(value).catch(() => {});
}

export function CompaniesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [invites, setInvites] = useState([]);
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [list, team] = await Promise.all([getAdminCompanies(), getTeam()]);
    setCompanies(list.companies || []);
    setInvites(team.invites || []);
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  const onInvite = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const result = await inviteCompany({ companyName, email, address });
      setCompanyName('');
      setEmail('');
      setAddress('');
      setStatus(result.mailed?.ok ? 'Email sent.' : 'Email not sent. Use Copy link on the invitation.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!user?.platformOwner) return null;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
      <p className="mt-1 mb-8 max-w-3xl text-sm text-zinc-500">Invite a company by email. That person becomes owner of their dashboard. Click a company for billing and pause controls.</p>

      <form onSubmit={onInvite} className="mb-8 space-y-3 rounded-2xl border border-white/5 bg-ink-900 p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name" className="h-11 rounded-lg border border-white/10 bg-ink-800 px-3 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Owner email" className="h-11 rounded-lg border border-white/10 bg-ink-800 px-3 text-sm" />
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address (optional)" className="h-11 rounded-lg border border-white/10 bg-ink-800 px-3 text-sm" />
        </div>
        <button disabled={busy} className="h-11 rounded-lg bg-orange-500 px-4 text-sm font-medium text-ink-950 disabled:opacity-50">
          {busy ? 'Sending…' : 'Send invitation'}
        </button>
      </form>

      {error && <div className="mb-4 text-sm text-red-300">{error}</div>}
      {status && <div className="mb-4 text-sm text-emerald-300">{status}</div>}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">All companies</h2>
        <div className="overflow-hidden rounded-2xl border border-white/5">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-900 text-[11px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Pull requests</th>
                <th className="px-4 py-3">Cost</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {companies.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-500">No companies yet.</td></tr>
              )}
              {companies.map((company) => (
                <tr
                  key={company.id}
                  onClick={() => navigate(`/companies/${company.id}`)}
                  className="cursor-pointer border-t border-white/5 hover:bg-white/4"
                >
                  <td className="px-4 py-3">{company.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">{company.email || 'pending'}</td>
                  <td className="px-4 py-3">{company.pullRequests}</td>
                  <td className="px-4 py-3">{money(company.totalCost)}</td>
                  <td className="px-4 py-3 capitalize">{company.paused ? 'paused' : 'active'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Invitations</h2>
        <div className="overflow-hidden rounded-2xl border border-white/5">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-900 text-[11px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {invites.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-zinc-500">No invitations yet.</td></tr>
              )}
              {invites.map((invite) => (
                <tr key={invite.id} className="border-t border-white/5">
                  <td className="px-4 py-3 font-mono text-xs">{invite.email}</td>
                  <td className="px-4 py-3">{invite.companyName}</td>
                  <td className="px-4 py-3 capitalize">{invite.status}</td>
                  <td className="px-4 py-3">
                    {invite.status === 'pending' && (
                      <div className="flex gap-3">
                        <button type="button" onClick={() => copy(invite.inviteUrl)} className="text-xs text-orange-300 hover:underline">Copy link</button>
                        <button
                          type="button"
                          onClick={async () => {
                            setBusy(true);
                            setError('');
                            setStatus('');
                            try {
                              const result = await resendInvite(invite.id);
                              setStatus(result.mailed?.ok ? 'Email resent. Check inbox and spam.' : 'Email not sent. Use Copy link.');
                            } catch (err) {
                              setError(err.message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="text-xs text-zinc-400 hover:text-white"
                        >
                          Resend email
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
