import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { ThemeToggle } from '../components/ThemeToggle.jsx';
import { acceptInvite, declineInvite, getInvite } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.jsx';

export function InvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, ready, refresh, logout } = useAuth();
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (token) sessionStorage.setItem('pulse_invite', token);
    getInvite(token)
      .then((data) => setInvite(data.invite))
      .catch((err) => setError(err.message));
  }, [token]);

  const kindLabel = invite?.kind === 'company' ? 'company owner' : 'member';

  const onAccept = async () => {
    if (!invite || invite.status !== 'pending') return;
    setBusy('accept');
    setError('');
    try {
      const latest = (await getInvite(token)).invite;
      setInvite(latest);
      if (latest.status !== 'pending') return;
      if (user && user.email !== latest.email) {
        setError(`You are signed in as ${user.email}. Sign out and use ${latest.email} to accept.`);
        return;
      }
      try {
        await acceptInvite(token);
      } catch (err) {
        if (err.needsRegister) {
          sessionStorage.setItem('pulse_invite', token);
          navigate(`/register?invite=${token}&email=${encodeURIComponent(latest.email)}`, { replace: true });
          return;
        }
        throw err;
      }
      sessionStorage.removeItem('pulse_invite');
      if (user) {
        await refresh();
        navigate('/', { replace: true });
        return;
      }
      navigate(`/login?email=${encodeURIComponent(latest.email)}`, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const onDecline = async () => {
    if (!invite || invite.status !== 'pending') return;
    setBusy('decline');
    setError('');
    try {
      const data = await declineInvite(token);
      sessionStorage.removeItem('pulse_invite');
      setInvite(data.invite);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-ink-950 px-4 py-8 text-zinc-100">
      <div className="absolute right-4 top-4 sm:right-8 sm:top-8">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md rounded-2xl border border-white/8 bg-ink-900 p-5 sm:p-6">
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
            {invite.status === 'pending' && user && user.email !== invite.email && (
              <p className="mt-4 text-sm text-zinc-500">
                You are signed in as {user.email}. Sign out and use {invite.email} to accept.
              </p>
            )}
            {invite.status === 'pending' && (!user || user.email === invite.email) && (
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={Boolean(busy) || !ready}
                  onClick={onAccept}
                  className="h-11 rounded-lg bg-orange-500 px-4 text-sm font-medium text-ink-950 disabled:opacity-50"
                >
                  {busy === 'accept' ? 'Please wait…' : 'Accept'}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy) || !ready}
                  onClick={onDecline}
                  className="h-11 rounded-lg border border-white/10 px-4 text-sm text-zinc-200 disabled:opacity-50"
                >
                  {busy === 'decline' ? 'Please wait…' : 'Decline'}
                </button>
              </div>
            )}
            {invite.status === 'pending' && user && user.email !== invite.email && (
              <button
                type="button"
                onClick={async () => {
                  await logout();
                  navigate(`/invite/${token}`, { replace: true });
                }}
                className="mt-4 text-sm text-orange-300 hover:underline"
              >
                Sign out
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
