import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getAdminNotifications, markAdminNotificationRead, markAllAdminNotificationsRead } from '../lib/api.js';
import { timeAgo } from '../lib/time.js';

export function NotificationsPage({ refreshKey }) {
  const [searchParams] = useSearchParams();
  const companyId = searchParams.get('companyId') || '';
  const [data, setData] = useState({ notifications: [], unread: 0 });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => getAdminNotifications(companyId)
    .then(setData)
    .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, [companyId, refreshKey]);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Notifications</h1>
          <p className="mt-1 text-sm text-zinc-500">AI agent errors are hidden from clients and sent here, per company.</p>
        </div>
        {data.unread > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await markAllAdminNotificationsRead();
                await load();
              } catch (err) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
            className="h-10 w-full rounded-lg border border-white/10 px-4 text-sm text-zinc-300 hover:bg-white/5 disabled:opacity-50 sm:w-auto"
          >
            Mark all read
          </button>
        )}
      </div>

      {error && <div className="mb-4 text-sm text-red-300">{error}</div>}

      <div className="overflow-x-auto rounded-2xl border border-white/5">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-ink-900 text-[11px] uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Issue</th>
              <th className="px-4 py-3">Error</th>
              <th className="px-4 py-3">When</th>
            </tr>
          </thead>
          <tbody>
            {data.notifications.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-zinc-500">No agent errors yet.</td>
              </tr>
            )}
            {data.notifications.map((note) => (
              <tr
                key={note.id}
                className={`border-t border-white/5 ${note.readAt ? 'bg-ink-900/20' : 'bg-orange-500/5'}`}
              >
                <td className="px-4 py-3">
                  {note.companyId ? (
                    <Link to={`/companies/${note.companyId}`} className="text-orange-300 hover:underline">
                      {note.companyName || 'Company'}
                    </Link>
                  ) : (
                    <span className="text-zinc-400">{note.companyName || 'Unknown company'}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-200">{note.title}</td>
                <td className="px-4 py-3">
                  <pre className="max-w-xl whitespace-pre-wrap break-words font-mono text-[12px] text-red-200">{note.message}</pre>
                  {!note.readAt && (
                    <button
                      type="button"
                      className="mt-2 text-xs text-zinc-400 hover:text-white"
                      onClick={async () => {
                        try {
                          await markAdminNotificationRead(note.id);
                          await load();
                        } catch (err) {
                          setError(err.message);
                        }
                      }}
                    >
                      Mark read
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-500">{timeAgo(note.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
