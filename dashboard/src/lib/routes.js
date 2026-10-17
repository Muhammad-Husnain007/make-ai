export const routes = {
  home: '/',
  signIn: '/sign-in',
  signUp: '/sign-up',
  signUpPending: '/sign-up/pending',
  errors: '/errors',
  errorsResolved: '/errors/resolved',
  pullRequests: '/pull-requests',
  pullRequestsMerged: '/pull-requests/merged',
  pullRequestsClosed: '/pull-requests/closed',
  performance: '/insights/performance',
  pipelines: '/insights/pipelines',
  integrations: '/integrations',
  organization: '/organization',
  accounts: '/admin/accounts',
  queues: '/admin/queues',
  alerts: '/admin/alerts',
};

export function invitationPath(token) {
  return `/invitations/${token}`;
}

export function errorPath(id) {
  return `/errors/${id}`;
}

export function accountPath(id) {
  return `/admin/accounts/${id}`;
}

export function signInPath({ email } = {}) {
  return email ? `${routes.signIn}?email=${encodeURIComponent(email)}` : routes.signIn;
}

export function signUpPath({ invite, email } = {}) {
  const params = new URLSearchParams();
  if (invite) params.set('invite', invite);
  if (email) params.set('email', email);
  const query = params.toString();
  return query ? `${routes.signUp}?${query}` : routes.signUp;
}

export function alertsPath(companyId) {
  return companyId ? `${routes.alerts}?companyId=${encodeURIComponent(companyId)}` : routes.alerts;
}

export function isPublicPath(pathname) {
  return pathname === routes.signIn
    || pathname === routes.signUp
    || pathname === routes.signUpPending
    || pathname === '/login'
    || pathname === '/register'
    || pathname === '/register/thanks'
    || pathname.startsWith('/invitations/')
    || pathname.startsWith('/invite/');
}

export function isErrorsSection(pathname) {
  return pathname === routes.errors
    || pathname.startsWith(`${routes.errors}/`)
    || pathname.startsWith(routes.pullRequests);
}
