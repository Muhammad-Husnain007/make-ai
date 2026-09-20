const API = '';

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

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
export const runIssueAgent = (id) => api(`/api/issues/${id}/agent`, { method: 'POST', body: {} });
export const getStats = (projectId) => api(`/api/stats${projectId ? `?projectId=${projectId}` : ''}`);
