import './env.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Server } from 'socket.io';
import { listPullStates, runFixAgent, shouldRunAgent } from '@pulse/agent';
import { applyPullStates, createProject, getIssue, getProject, getProjectByKey, ingestEvent, listGithubProjects, listIssues, listProjects, saveAgentResult, saveClientSettings, serializeProject, setAgentStatus, setIssueStatus, stats, updateProject } from './store.js';
import { getUserByToken, loginUser, logoutToken, readBearerToken, registerUser, requestRegisterOtp, requestResetOtp, resetPassword, verifyRegisterOtp, verifyResetOtp } from './auth.js';
import { acceptInvite, adminOverview, canAccessProject, getAdminCompany, getInvite, inviteCompany, inviteMember, isCompanyPaused, listAdminCompanies, listTeam, resendInvite, roomsForProject, roomsForUser, scopeFromUser, setCompanyPaused } from './org.js';
import './db.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

await app.register(cors, { origin: true });
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(rateLimit, {
  max: 180,
  timeWindow: '1 minute',
});
app.decorateRequest('user', null);

app.addContentTypeParser('text/plain', { parseAs: 'string' }, (req, body, done) => {
  try {
    done(null, JSON.parse(body || '{}'));
  } catch (error) {
    done(error);
  }
});

const agentStore = { getIssue, getProject, saveAgentResult, setAgentStatus };

function dashboardOrigin(req) {
  return process.env.DASHBOARD_URL || req.headers.origin || 'http://127.0.0.1:5173';
}

function projectFilter(user, projectId) {
  const scope = scopeFromUser(user);
  if (scope.all) return { projectId: projectId || undefined, projectIds: undefined };
  const ids = scope.projectIds || [];
  if (projectId) return { projectIds: ids.includes(projectId) ? [projectId] : [] };
  return { projectIds: ids };
}

function emitToProject(project, event, payload) {
  for (const room of roomsForProject(project)) {
    app.io?.to(room).emit(event, payload);
  }
}

function queueAgent(issue, event, force = false, project = null) {
  if (isCompanyPaused(project?.company_id)) return;
  setImmediate(() => {
    runFixAgent({
      issue,
      event,
      logger: app.log,
      io: app.io,
      force,
      project,
      store: agentStore,
    }).catch((error) => {
      app.log.error({ err: error }, 'Pulse AI agent failed');
    });
  });
}

let lastPullSync = 0;
async function syncPullStatuses() {
  if (Date.now() - lastPullSync < 20000) return;
  lastPullSync = Date.now();
  try {
    const pulls = [];
    for (const project of listGithubProjects()) {
      pulls.push(...await listPullStates({
        githubToken: project.github_token,
        githubRepo: project.github_repo,
        githubBaseBranch: project.github_base_branch,
      }));
    }
    applyPullStates(pulls);
  } catch (error) {
    app.log.warn({ err: error }, 'Unable to refresh pull request statuses');
  }
}

app.addHook('preHandler', async (req, reply) => {
  const path = (req.url || '').split('?')[0];
  if (!path.startsWith('/api/')) return;
  if (path === '/api/auth/login' || path.startsWith('/api/auth/register') || path.startsWith('/api/auth/reset')) return;
  if (req.method === 'GET' && /^\/api\/invites\/[^/]+$/.test(path)) return;
  const user = getUserByToken(readBearerToken(req));
  if (!user) return reply.code(401).send({ error: 'Sign in required' });
  req.user = user;
});

const authLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

app.post('/api/auth/register/otp', authLimit, async (req, reply) => {
  try {
    return await requestRegisterOtp(req.body || {});
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.post('/api/auth/register/otp/verify', authLimit, async (req, reply) => {
  try {
    return verifyRegisterOtp(req.body || {});
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.post('/api/auth/register', authLimit, async (req, reply) => {
  try {
    return reply.code(201).send(await registerUser(req.body || {}));
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.post('/api/auth/login', authLimit, async (req, reply) => {
  try {
    return await loginUser(req.body || {});
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.post('/api/auth/reset/otp', authLimit, async (req, reply) => {
  try {
    return await requestResetOtp(req.body || {});
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.post('/api/auth/reset/otp/verify', authLimit, async (req, reply) => {
  try {
    return verifyResetOtp(req.body || {});
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.post('/api/auth/reset', authLimit, async (req, reply) => {
  try {
    return await resetPassword(req.body || {});
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.get('/api/auth/me', async (req) => ({ user: req.user }));

app.post('/api/auth/logout', async (req) => {
  logoutToken(readBearerToken(req));
  return { ok: true };
});

app.get('/api/invites/:token', async (req, reply) => {
  const invite = getInvite(req.params.token);
  if (!invite) return reply.code(404).send({ error: 'Invitation not found' });
  return { invite };
});

app.post('/api/invites/:token/accept', async (req, reply) => {
  try {
    return { user: acceptInvite(req.params.token, req.user) };
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.get('/api/team', async (req) => listTeam(req.user));

app.get('/api/admin/overview', async (req, reply) => {
  try {
    return adminOverview(req.user);
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.get('/api/admin/companies', async (req, reply) => {
  try {
    return { companies: listAdminCompanies(req.user) };
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.get('/api/admin/companies/:id', async (req, reply) => {
  try {
    return { company: getAdminCompany(req.user, req.params.id) };
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.patch('/api/admin/companies/:id', async (req, reply) => {
  try {
    return { company: setCompanyPaused(req.user, req.params.id, req.body?.paused) };
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.post('/api/team/companies/invite', authLimit, async (req, reply) => {
  try {
    return await inviteCompany({
      actor: req.user,
      companyName: req.body?.companyName ?? req.body?.name,
      email: req.body?.email,
      address: req.body?.address,
      origin: dashboardOrigin(req),
    });
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.post('/api/team/members/invite', authLimit, async (req, reply) => {
  try {
    return await inviteMember({
      actor: req.user,
      email: req.body?.email,
      canInvite: req.body?.canInvite,
      origin: dashboardOrigin(req),
    });
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.post('/api/team/invites/:id/resend', authLimit, async (req, reply) => {
  try {
    return await resendInvite({
      actor: req.user,
      inviteId: req.params.id,
      origin: dashboardOrigin(req),
    });
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.get('/health', async () => ({
  ok: true,
  service: 'pulse-api',
  agent: {
    gemini: Boolean(process.env.GEMINI_API_KEY),
    smtp: Boolean(process.env.SMTP_USER || process.env.GMAIL_USER),
  },
}));

app.get('/api/projects', async (req) => ({ projects: listProjects(scopeFromUser(req.user)) }));

app.post('/api/projects', async (req, reply) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : 'New project';
  const notifyEmail = typeof req.body?.notifyEmail === 'string' ? req.body.notifyEmail : req.body?.notify_email;
  try {
    return reply.code(201).send({ project: createProject(name, notifyEmail) });
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.patch('/api/projects/:id', async (req, reply) => {
  try {
    const project = updateProject(req.params.id, {
      name: req.body?.name,
      notifyEmail: req.body?.notifyEmail ?? req.body?.notify_email,
    });
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return { project };
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.get('/api/issues', async (req) => {
  syncPullStatuses().catch(() => {});
  const { projectId, status, environment, q, limit } = req.query || {};
  return { issues: listIssues({ ...projectFilter(req.user, projectId), status, environment, q, limit }) };
});

app.get('/api/issues/:id', async (req, reply) => {
  const issue = getIssue(req.params.id);
  if (!issue || !canAccessProject(req.user, issue.project_id)) return reply.code(404).send({ error: 'Issue not found' });
  return { issue };
});

app.patch('/api/issues/:id', async (req, reply) => {
  const current = getIssue(req.params.id);
  if (!current || !canAccessProject(req.user, current.project_id)) return reply.code(404).send({ error: 'Issue not found' });
  const issue = setIssueStatus(req.params.id, req.body?.status);
  if (!issue) return reply.code(400).send({ error: 'Unable to update issue' });
  emitToProject(getProject(issue.project_id), 'pulse:issue', issue);
  return { issue };
});

app.post('/api/issues/:id/agent', async (req, reply) => {
  const issue = getIssue(req.params.id);
  if (!issue || !canAccessProject(req.user, issue.project_id)) return reply.code(404).send({ error: 'Issue not found' });
  const project = getProject(issue.project_id);
  if (isCompanyPaused(project?.company_id)) return reply.code(403).send({ error: 'This company is paused.' });
  const event = issue.events?.[0] || {
    stack: '',
    url: '',
    environment: 'production',
    level: issue.level,
    message: issue.title,
  };
  queueAgent(issue, event, true, getProject(issue.project_id));
  return { ok: true, queued: true, issue: { ...issue, agent_status: 'running' } };
});

app.get('/api/stats', async (req) => {
  syncPullStatuses().catch(() => {});
  const filter = projectFilter(req.user, req.query?.projectId);
  return { stats: stats(filter.projectId, filter.projectIds) };
});

app.put('/ingest/:projectKey/settings', async (req, reply) => {
  try {
    const project = saveClientSettings(req.params.projectKey, {
      name: req.body?.name,
      githubToken: req.body?.githubToken ?? req.body?.github_token,
      githubRepo: req.body?.githubRepo ?? req.body?.github_repo,
      githubBaseBranch: req.body?.githubBaseBranch ?? req.body?.github_base_branch,
      notifyEmail: req.body?.notifyEmail ?? req.body?.notify_email,
      isEnabledSendEmail: req.body?.isEnabledSendEmail ?? req.body?.ISENABLEDSENDEMAIL ?? req.body?.send_email_enabled,
    });
    const serialized = serializeProject(project);
    emitToProject(project, 'pulse:settings', serialized);
    return { ok: true, project: serialized };
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ ok: false, error: error.message });
  }
});

app.post('/ingest/:projectKey', {
  config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
}, async (req, reply) => {
  try {
    const project = getProjectByKey(req.params.projectKey);
    if (!project) return reply.code(401).send({ ok: false, error: 'Unknown project key' });
    if (isCompanyPaused(project.company_id)) {
      return reply.code(403).send({ ok: false, error: 'This company is paused.' });
    }
    const result = ingestEvent(req.params.projectKey, req.body);
    emitToProject(result.project, 'pulse:event', {
      issue: result.issue,
      event: result.event,
      projectId: result.project.id,
    });
    if (shouldRunAgent(result)) {
      queueAgent(result.issue, result.event, Boolean(result.reopened), result.project);
    }
    return reply.code(202).send({
      ok: true,
      id: result.event.id,
      issueId: result.issue.id,
      agentQueued: shouldRunAgent(result),
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return reply.code(status).send({ ok: false, error: error.message });
  }
});

const start = async () => {
  await app.ready();
  const io = new Server(app.server, {
    cors: { origin: true },
    path: '/realtime',
  });
  app.decorate('io', io);
  io.on('connection', (socket) => {
    const user = getUserByToken(socket.handshake.auth?.token || '');
    if (user) {
      for (const room of roomsForUser(user)) socket.join(room);
    }
    socket.emit('pulse:hello', { ok: true, ts: Date.now() });
  });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await app.listen({ port: PORT, host: HOST });
      app.log.info(`Pulse API http://${HOST}:${PORT}`);
      return;
    } catch (error) {
      const busy = error.code === 'EADDRINUSE' || /EADDRINUSE/.test(error.message || '');
      if (!busy || attempt === 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
};

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
