import { useEffect, useState } from 'react';
import { ConfirmModal } from '../components/ConfirmModal.jsx';
import { getTeam, inviteCompany, inviteMailMessage, inviteMember, removeMember, resendInvite, revokeInvite } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.jsx';

function copy(value) {
  navigator.clipboard?.writeText(value).catch(() => {});
}

export function TeamPage() {
  const { user } = useAuth();
  const [team, setTeam] = useState({ companies: [], invites: [], members: [] });
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [canInvite, setCanInvite] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const isOwner = user?.company?.role === 'owner';
  const canManageMembers = Boolean(user?.canInviteMembers);

  const load = () => getTeam().then(setTeam).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);

  const onInvite = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const result = user.canInviteCompanies
        ? await inviteCompany({ companyName, email })
        : await inviteMember({ email, canInvite });
      setEmail('');
      setCompanyName('');
      setCanInvite(false);
      setStatus(inviteMailMessage(result.mailed));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      if (confirm.type === 'member') {
        await removeMember(confirm.member.id);
        setStatus(`${confirm.member.email} was removed and signed out.`);
      } else {
        await revokeInvite(confirm.invite.id);
        setStatus(`Invitation to ${confirm.invite.email} was cancelled.`);
      }
      setConfirm(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!user?.canInviteCompanies && !user?.company) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Team</h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-500">Pulse will email you an invitation when a company dashboard is created for you. After you accept, you become the owner and can invite your members.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{user.canInviteCompanies ? 'Companies' : 'Team'}</h1>
      <p className="mt-1 mb-6 max-w-3xl text-sm text-zinc-500 sm:mb-8">
        {user.canInviteCompanies
          ? 'You own Pulse. Invite a company by email — that person becomes owner of their dashboard and can invite their own members.'
          : `You own ${user.company?.name || 'this company'}. Invite members to this dashboard.`}
      </p>

      {(user.canInviteCompanies || user.canInviteMembers) && (
        <form onSubmit={onInvite} className="mb-8 space-y-3 rounded-2xl border border-white/8 bg-ink-900 p-5">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            {user.canInviteCompanies && (
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name" className="h-11 rounded-lg border border-white/10 bg-ink-800 px-3 text-sm" />
            )}
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" className="h-11 rounded-lg border border-white/10 bg-ink-800 px-3 text-sm" />
            <button disabled={busy} className="h-11 w-full rounded-lg bg-orange-500 px-4 text-sm font-medium text-ink-950 disabled:opacity-50 sm:w-auto">
              {busy ? 'Sending…' : 'Send invitation'}
            </button>
          </div>
          {isOwner && !user.canInviteCompanies && (
            <label className="flex items-start gap-3 text-sm text-zinc-300">
              <input type="checkbox" checked={canInvite} onChange={(e) => setCanInvite(e.target.checked)} className="mt-1" />
              <span>This member can also invite other members.</span>
            </label>
          )}
        </form>
      )}

      {error && <div className="mb-4 text-sm text-red-300">{error}</div>}
      {status && <div className="mb-4 text-sm text-emerald-300">{status}</div>}

      {user.canInviteCompanies && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold">Companies</h2>
          <div className="overflow-x-auto rounded-2xl border border-white/8">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="bg-ink-900 text-[11px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Members</th>
                </tr>
              </thead>
              <tbody>
                {team.companies.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-zinc-500">No companies yet.</td></tr>
                )}
                {team.companies.map((company) => (
                  <tr key={company.id} className="border-t border-white/5">
                    <td className="px-4 py-3">{company.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">{company.owner_email || 'pending'}</td>
                    <td className="px-4 py-3">{company.member_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {user.company && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold">Members</h2>
          <div className="overflow-x-auto rounded-2xl border border-white/8">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-ink-900 text-[11px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Can invite members</th>
                  {canManageMembers && <th className="px-4 py-3"></th>}
                </tr>
              </thead>
              <tbody>
                {team.members.map((member) => {
                  const canRemove = canManageMembers && member.role !== 'owner' && member.id !== user.id;
                  return (
                    <tr key={member.id} className="border-t border-white/5">
                      <td className="px-4 py-3">{member.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-400">{member.email}</td>
                      <td className="px-4 py-3 capitalize">{member.role}</td>
                      <td className="px-4 py-3">{member.role === 'owner' || member.can_invite ? 'yes' : 'no'}</td>
                      {canManageMembers && (
                        <td className="px-4 py-3">
                          {canRemove && (
                            <button
                              type="button"
                              onClick={() => setConfirm({ type: 'member', member })}
                              className="text-xs text-red-300 hover:underline"
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Invitations</h2>
        <div className="overflow-x-auto rounded-2xl border border-white/8">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-ink-900 text-[11px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Can invite members</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {team.invites.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-500">No invitations yet.</td></tr>
              )}
              {team.invites.map((invite) => (
                <tr key={invite.id} className="border-t border-white/5">
                  <td className="px-4 py-3 font-mono text-xs">{invite.email}</td>
                  <td className="px-4 py-3">{invite.companyName}</td>
                  <td className="px-4 py-3">{invite.kind === 'company' || invite.canInvite ? 'yes' : 'no'}</td>
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
                              setStatus(inviteMailMessage(result.mailed, true));
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
                        {canManageMembers && invite.kind === 'member' && (
                          <button
                            type="button"
                            onClick={() => setConfirm({ type: 'invite', invite })}
                            className="text-xs text-red-300 hover:underline"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {confirm && (
        <ConfirmModal
          danger
          title={confirm.type === 'member' ? 'Remove member' : 'Cancel invitation'}
          body={
            confirm.type === 'member'
              ? `Remove ${confirm.member.email} from this company? They will be signed out immediately.`
              : `Cancel the invitation to ${confirm.invite.email}? They will no longer be able to join with that link.`
          }
          confirmLabel={confirm.type === 'member' ? 'Remove' : 'Cancel invitation'}
          busy={busy}
          onConfirm={onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
