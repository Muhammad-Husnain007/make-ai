import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { acceptInvite, getInvite } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.jsx';

export function InvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, ready, refresh } = useAuth();
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (token) sessionStorage.setItem('pulse_invite', token);
    getInvite(token)
      .then((data) => setInvite(data.invite))
      .catch((err) => setError(err.message));
  }, [token]);

  useEffect(() => {
    if (!ready || !user || !invite || invite.status !== 'pending') return;
    if (user.email !== invite.email) return;
    setBusy(true);
    acceptInvite(token)
      .then(async () => {
        sessionStorage.removeItem('pulse_invite');
        await refresh();
        navigate('/', { replace: true });
      })
      .catch((err) => {
        setError(err.message);
        setBusy(false);
      });
  }, [ready, user, invite, token, navigate, refresh]);

  const kindLabel = invite?.kind === 'company' ? 'company owner' : 'member';

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4 text-zinc-100">
      <div className="w-full max-w-md rounded-2xl border border-white/8 bg-ink-900 p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500 text-ink-950">
            <ShieldAlert size={18} />
          </span>
          <div>
            <div className="text-sm font-bold">Pulse invitation</div>
            <div className="text-[11px] text-zinc-500">{invite?.companyName || 'Company dashboard'}</div>
          </div>
        </div>
        {error && <p className="mb-4 text-sm text-red-300">{error}</p>}
        {!invite && !error && <p className="text-sm text-zinc-500">Loading invitation…</p>}
        {invite && (
          <>
            <p className="text-sm text-zinc-300">
              {invite.invitedByName} invited <span className="font-mono text-orange-200">{invite.email}</span> to become {kindLabel} of {invite.companyName}.
            </p>
            {invite.status !== 'pending' && (
              <p className="mt-3 text-sm text-zinc-500">This invitation is {invite.status}.</p>
            )}
            {invite.status === 'pending' && !user && (
              <div className="mt-6 grid gap-2">
                <Link to={`/register?invite=${token}&email=${encodeURIComponent(invite.email)}`} className="rounded-lg bg-orange-500 px-4 py-2.5 text-center text-sm font-medium text-ink-950">
                  Register and accept
                </Link>
                <Link to={`/login?invite=${token}&email=${encodeURIComponent(invite.email)}`} className="rounded-lg border border-white/10 px-4 py-2.5 text-center text-sm text-zinc-200">
                  Login and accept
                </Link>
              </div>
            )}
            {invite.status === 'pending' && user && user.email !== invite.email && (
              <p className="mt-4 text-sm text-zinc-500">You are signed in as {user.email}. Sign out and use {invite.email} to accept.</p>
            )}
            {busy && <p className="mt-4 text-sm text-zinc-500">Accepting invitation…</p>}
          </>
        )}
      </div>
    </div>
  );
}
