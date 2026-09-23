const API = '';

function authHeaders(extra = {}) {
  const token = (() => {
    try {
      return localStorage.getItem('pulse_auth_token') || '';
    } catch {
      return '';
    }
  })();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

export async function api(path, options = {}) {
  const headers = authHeaders({ ...(options.headers || {}) });
  if (options.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/auth/login' && !path.startsWith('/api/auth/register') && !path.startsWith('/api/auth/reset') && !path.startsWith('/api/invites/')) {
    try { localStorage.removeItem('pulse_auth_token'); } catch {}
    if (!['/login', '/register'].includes(window.location.pathname) && !window.location.pathname.startsWith('/invite/') && window.location.pathname !== '/register/thanks') {
      window.location.assign('/login');
    }
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    if (data.inviteToken) err.inviteToken = data.inviteToken;
    if (data.needsRegister) err.needsRegister = true;
    throw err;
  }
  return data;
}

export const registerAccount = (body) => api('/api/auth/register', { method: 'POST', body });
export const requestRegisterOtp = (body) => api('/api/auth/register/otp', { method: 'POST', body });
export const verifyRegisterOtp = (body) => api('/api/auth/register/otp/verify', { method: 'POST', body });
export const loginAccount = (body) => api('/api/auth/login', { method: 'POST', body });
export const requestResetOtp = (body) => api('/api/auth/reset/otp', { method: 'POST', body });
export const verifyResetOtp = (body) => api('/api/auth/reset/otp/verify', { method: 'POST', body });
export const resetPassword = (body) => api('/api/auth/reset', { method: 'POST', body });
export const logoutAccount = () => api('/api/auth/logout', { method: 'POST', body: {} });
export const getMe = () => api('/api/auth/me');
export const getInvite = (token) => api(`/api/invites/${token}`);
export const acceptInvite = (token) => api(`/api/invites/${token}/accept`, { method: 'POST', body: {} });
export const declineInvite = (token) => api(`/api/invites/${token}/decline`, { method: 'POST', body: {} });
export const getTeam = () => api('/api/team');
export const getAdminOverview = () => api('/api/admin/overview');
export const getAdminCompanies = () => api('/api/admin/companies');
export const getAdminCompany = (id) => api(`/api/admin/companies/${id}`);
export const patchAdminCompany = (id, body) => api(`/api/admin/companies/${id}`, { method: 'PATCH', body });
export const inviteCompany = (body) => api('/api/team/companies/invite', { method: 'POST', body });
export const inviteMember = (body) => api('/api/team/members/invite', { method: 'POST', body });
export const resendInvite = (id) => api(`/api/team/invites/${id}/resend`, { method: 'POST', body: {} });
export const removeMember = (id) => api(`/api/team/members/${id}`, { method: 'DELETE' });
export const revokeInvite = (id) => api(`/api/team/invites/${id}`, { method: 'DELETE' });
export const getProjects = () => api('/api/projects');
export const createProject = (name, notifyEmail) => api('/api/projects', { method: 'POST', body: { name, notifyEmail } });
export const patchProject = (id, body) => api(`/api/projects/${id}`, { method: 'PATCH', body });
export const getIssues = (params = {}) => {
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, value]) => value && value !== 'all'))
  ).toString();
  return api(`/api/issues${query ? `?${query}` : ''}`);
};
export const getIssue = (id) => api(`/api/issues/${id}`);
export const patchIssue = (id, status) => api(`/api/issues/${id}`, { method: 'PATCH', body: { status } });
export const deleteIssue = (id) => api(`/api/issues/${id}`, { method: 'DELETE' });
export const runIssueAgent = (id) => api(`/api/issues/${id}/agent`, { method: 'POST', body: {} });
export const getStats = (projectId) => api(`/api/stats${projectId ? `?projectId=${projectId}` : ''}`);
export const getQueues = () => api('/api/queues');
export const getAdminNotifications = (companyId) => api(`/api/admin/notifications${companyId ? `?companyId=${companyId}` : ''}`);
export const markAdminNotificationRead = (id) => api(`/api/admin/notifications/${id}`, { method: 'PATCH', body: {} });
export const markAllAdminNotificationsRead = () => api('/api/admin/notifications/read-all', { method: 'POST', body: {} });

export function inviteMailMessage(mailed, resent = false) {
  if (mailed?.queued) return 'Invitation queued.';
  if (mailed?.ok) return resent ? 'Email resent. Check inbox and spam.' : 'Email sent.';
  return resent ? 'Email not sent. Use Copy link.' : 'Email not sent. Use Copy link on the invitation.';
}
