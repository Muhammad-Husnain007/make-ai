import './env.js';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Server } from 'socket.io';
import { listPullStates, presentIssue, runFixAgent, shouldRunAgent } from '@pulse/agent';
import { applyPullStates, createAdminNotification, createProject, deleteIssue, getAgentPipeline, getIssue, getProject, getProjectByKey, ingestEvent, listGithubProjects, listGithubProjectsForScope, listIssues, listProjects, saveAgentPipeline, saveAgentResult, saveClientSettings, serializeProject, setAgentStatus, setIssueStatus, stats, updateProject } from './store.js';
import { getUserByToken, loginUser, logoutToken, readBearerToken, registerUser, requestRegisterOtp, requestResetOtp, resetPassword, verifyRegisterOtp, verifyResetOtp } from './auth.js';
import { acceptInvite, adminOverview, canAccessProject, declineInvite, getAdminCompany, getInvite, inviteCompany, inviteMember, isCompanyPaused, isPlatformOwner, listAdminCompanies, listAdminNotifications, listTeam, markAdminNotificationRead, markAllAdminNotificationsRead, removeMember, resendInvite, revokeInvite, roomsForProject, roomsForUser, scopeFromUser, setCompanyPaused } from './org.js';
import { stripPasswordFields } from './safeJson.js';
import { connectDb, disconnectDb } from './db.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const dashboardDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dashboard', 'dist');

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

app.addHook('onSend', async (req, reply, payload) => {
  if (typeof payload !== 'string') return payload;
  const contentType = String(reply.getHeader('content-type') || '');
  if (!contentType.includes('application/json')) return payload;
  try {
    return JSON.stringify(stripPasswordFields(JSON.parse(payload)));
  } catch {
    return payload;
  }
});

app.addContentTypeParser('text/plain', { parseAs: 'string' }, (req, body, done) => {
  try {
    done(null, JSON.parse(body || '{}'));
  } catch (error) {
    done(error);
  }
});

const agentStore = { getIssue, getProject, saveAgentResult, setAgentStatus, saveAgentPipeline, getAgentPipeline, createAdminNotification };

function dashboardOrigin(req) {
  const fromEnv = String(process.env.DASHBOARD_URL || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const headerOrigin = String(req.headers.origin || '').replace(/\/$/, '');
  if (headerOrigin) return headerOrigin;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

async function projectFilter(user, projectId) {
  const scope = await scopeFromUser(user);
  if (scope.all) return { projectId: projectId || undefined, projectIds: undefined };
  const ids = scope.projectIds || [];
  if (projectId) return { projectIds: ids.includes(projectId) ? [projectId] : [] };
  return { projectIds: ids };
}

function presentForUser(user, issue) {
  return presentIssue(issue, { admin: isPlatformOwner(user?.email) });
}

async function forceLogoutSockets(userId) {
  const io = app.io;
  if (!io || !userId) return;
  const room = `user:${userId}`;
  io.to(room).emit('pulse:forced-logout', { reason: 'removed' });
  const sockets = await io.in(room).fetchSockets();
  for (const socket of sockets) socket.disconnect(true);
}

function emitToProject(project, event, payload) {
  for (const room of roomsForProject(project)) {
    app.io?.to(room).emit(event, payload);
  }
}

function emitIssueRooms(project, issue) {
  app.io?.to('platform').emit('pulse:issue', presentIssue(issue, { admin: true }));
  if (project?.company_id) {
    app.io.to(`company:${project.company_id}`).emit('pulse:issue', presentIssue(issue, { admin: false }));
  }
}

function emitIssueDeleted(project, issueId) {
  const payload = { id: issueId, deleted: true };
  app.io?.to('platform').emit('pulse:issue', payload);
  if (project?.company_id) {
    app.io.to(`company:${project.company_id}`).emit('pulse:issue', payload);
  }
}

async function startAgent(issue, event, force = false, project = null) {
  if (await isCompanyPaused(project?.company_id)) return;
  setImmediate(() => runFixAgent({
    issue,
    event,
    logger: app.log,
    io: app.io,
    force,
    project,
    store: agentStore,
  }).catch(async (error) => {
    app.log.error({ err: error }, 'Pulse AI agent failed');
    try {
      const message = error?.message || 'AI fix failed unexpectedly. Click Run AI fix to try again.';
      const failed = await agentStore.saveAgentResult(issue.id, {
        status: 'failed',
        summary: 'AI fix failed. Click Run AI fix to try again.',
        solution: message,
        agentError: message,
      });
      if (failed) emitIssue(app.io, failed, project || await getProject(failed.project_id));
    } catch (saveError) {
      app.log.error({ err: saveError }, 'Pulse AI agent failure state could not be saved');
    }
  }));
}

let lastPullSync = 0;
async function syncPullStatuses() {
  if (Date.now() - lastPullSync < 20000) return;
  lastPullSync = Date.now();
  try {
    const pulls = [];
    for (const project of await listGithubProjects()) {
      pulls.push(...await listPullStates({
        githubToken: project.github_token,
        githubRepo: project.github_repo,
        githubBaseBranch: project.github_base_branch,
      }));
    }
    await applyPullStates(pulls);
  } catch (error) {
    app.log.warn({ err: error }, 'Unable to refresh pull request statuses');
  }
}

app.addHook('preHandler', async (req, reply) => {
  const path = (req.url || '').split('?')[0];
  if (!path.startsWith('/api/')) return;
  if (path === '/api/auth/login' || path.startsWith('/api/auth/register') || path.startsWith('/api/auth/reset')) return;
  if (req.method === 'GET' && /^\/api\/invites\/[^/]+$/.test(path)) return;
  if (req.method === 'POST' && /^\/api\/invites\/[^/]+\/(accept|decline)$/.test(path)) {
    req.user = await getUserByToken(readBearerToken(req));
    return;
  }
  const user = await getUserByToken(readBearerToken(req));
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
    return await verifyRegisterOtp(req.body || {});
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
    return reply.code(error.statusCode || 400).send({
      error: error.message,
      ...(error.inviteToken ? { inviteToken: error.inviteToken } : {}),
    });
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
  await logoutToken(readBearerToken(req));
  return { ok: true };
});

app.get('/api/invites/:token', async (req, reply) => {
  const invite = await getInvite(req.params.token);
  if (!invite) return reply.code(404).send({ error: 'Invitation not found' });
  return { invite };
});

app.post('/api/invites/:token/accept', async (req, reply) => {
  try {
    return { user: await acceptInvite(req.params.token, req.user || null) };
  } catch (error) {
    return reply.code(error.statusCode || 400).send({
      error: error.message,
      ...(error.needsRegister ? { needsRegister: true } : {}),
    });
  }
});

app.post('/api/invites/:token/decline', async (req, reply) => {
  try {
    return { invite: await declineInvite(req.params.token) };
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.get('/api/team', async (req) => listTeam(req.user));

app.get('/api/admin/notifications', async (req, reply) => {
  try {
    return await listAdminNotifications(req.user, { companyId: req.query?.companyId });
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.post('/api/admin/notifications/read-all', async (req, reply) => {
  try {
    return await markAllAdminNotificationsRead(req.user);
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.patch('/api/admin/notifications/:id', async (req, reply) => {
  try {
    return await markAdminNotificationRead(req.user, req.params.id);
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.get('/api/admin/overview', async (req, reply) => {
  try {
    return await adminOverview(req.user);
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.get('/api/admin/companies', async (req, reply) => {
  try {
    return { companies: await listAdminCompanies(req.user) };
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.get('/api/admin/companies/:id', async (req, reply) => {
  try {
    return { company: await getAdminCompany(req.user, req.params.id) };
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.patch('/api/admin/companies/:id', async (req, reply) => {
  try {
    return { company: await setCompanyPaused(req.user, req.params.id, req.body?.paused) };
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

app.delete('/api/team/members/:id', async (req, reply) => {
  try {
    const result = await removeMember({ actor: req.user, userId: req.params.id });
    await forceLogoutSockets(result.userId);
    return result;
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.delete('/api/team/invites/:id', async (req, reply) => {
  try {
    return await revokeInvite({ actor: req.user, inviteId: req.params.id });
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.get('/health', async () => ({
  ok: true,
  service: 'pulse-api',
  agent: {
    gemini: Boolean(process.env.AI_API_KEY),
    smtp: Boolean(process.env.SMTP_USER || process.env.GMAIL_USER),
  },
}));

app.get('/api/projects', async (req) => ({ projects: await listProjects(await scopeFromUser(req.user)) }));

app.post('/api/projects', async (req, reply) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : 'New project';
  const notifyEmail = typeof req.body?.notifyEmail === 'string' ? req.body.notifyEmail : req.body?.notify_email;
  try {
    return reply.code(201).send({ project: await createProject(name, notifyEmail) });
  } catch (error) {
    return reply.code(error.statusCode || 400).send({ error: error.message });
  }
});

app.patch('/api/projects/:id', async (req, reply) => {
  try {
    const project = await updateProject(req.params.id, {
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
  const issues = await listIssues({ ...await projectFilter(req.user, projectId), status, environment, q, limit });
  return { issues: issues.map((issue) => presentForUser(req.user, issue)) };
});

app.get('/api/pipelines', async (req) => {
  if (req.user?.platformOwner) return { pipelines: [], configuredRepos: 0 };
  const projects = await listGithubProjectsForScope(await scopeFromUser(req.user));
  const results = await Promise.all(projects.map(async (project) => {
    const [owner, repo] = String(project.github_repo || '').split('/');
    if (!owner || !repo) return { pipelines: [], unavailableRepo: project.github_repo || project.name };
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${project.github_token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    try {
      const [workflowsResponse, runsResponse] = await Promise.all([
        fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows?per_page=100`, { headers }),
        fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?per_page=100`, { headers }),
      ]);
      if (!workflowsResponse.ok || !runsResponse.ok) return { pipelines: [], unavailableRepo: project.github_repo };
      const [workflowData, runData] = await Promise.all([workflowsResponse.json(), runsResponse.json()]);
      const runsByWorkflow = new Map();
      for (const run of runData.workflow_runs || []) {
        if (!runsByWorkflow.has(run.workflow_id)) runsByWorkflow.set(run.workflow_id, run);
      }
      const pipelines = (workflowData.workflows || []).map((workflow) => {
        const run = runsByWorkflow.get(workflow.id);
        return {
          id: `${project.id}:${workflow.id}`,
          name: workflow.name || 'GitHub Actions workflow',
          repo: project.github_repo,
          project: project.name,
          state: workflow.state || 'unknown',
          status: run?.status || 'idle',
          conclusion: run?.conclusion || '',
          branch: run?.head_branch || '',
          commit: run?.display_title || '',
          updatedAt: run?.updated_at || workflow.updated_at || '',
          url: run?.html_url || workflow.html_url || `https://github.com/${owner}/${repo}/actions`,
        };
      });
      return { pipelines };
    } catch {
      return { pipelines: [], unavailableRepo: project.github_repo };
    }
  }));
  return {
    pipelines: results.flatMap((result) => result.pipelines),
    unavailableRepos: results.flatMap((result) => result.unavailableRepo || []),
    configuredRepos: projects.length,
  };
});

app.get('/api/issues/:id', async (req, reply) => {
  const issue = await getIssue(req.params.id);
  if (!issue || !await canAccessProject(req.user, issue.project_id)) return reply.code(404).send({ error: 'Issue not found' });
  return { issue: presentForUser(req.user, issue) };
});

app.patch('/api/issues/:id', async (req, reply) => {
  const current = await getIssue(req.params.id);
  if (!current || !await canAccessProject(req.user, current.project_id)) return reply.code(404).send({ error: 'Issue not found' });
  const issue = await setIssueStatus(req.params.id, req.body?.status);
  if (!issue) return reply.code(400).send({ error: 'Unable to update issue' });
  emitIssueRooms(await getProject(issue.project_id), issue);
  return { issue: presentForUser(req.user, issue) };
});

app.delete('/api/issues/:id', async (req, reply) => {
  const current = await getIssue(req.params.id);
  if (!current || !await canAccessProject(req.user, current.project_id)) return reply.code(404).send({ error: 'Issue not found' });
  const removed = await deleteIssue(req.params.id);
  if (!removed) return reply.code(404).send({ error: 'Issue not found' });
  emitIssueDeleted(await getProject(removed.project_id), removed.id);
  return { ok: true, id: removed.id };
});

app.post('/api/issues/:id/agent', async (req, reply) => {
  const issue = await getIssue(req.params.id);
  if (!issue || !await canAccessProject(req.user, issue.project_id)) return reply.code(404).send({ error: 'Issue not found' });
  const project = await getProject(issue.project_id);
  if (await isCompanyPaused(project?.company_id)) return reply.code(403).send({ error: 'This company is paused.' });
  const event = issue.events?.[0] || {
    stack: '',
    url: '',
    environment: 'production',
    level: issue.level,
    message: issue.title,
  };
  startAgent(issue, event, true, project).catch((error) => app.log.error({ err: error }, 'Pulse AI agent failed to start'));
  return { ok: true, started: true, issue: presentForUser(req.user, { ...issue, agent_status: 'running' }) };
});

app.get('/api/stats', async (req) => {
  syncPullStatuses().catch(() => {});
  const filter = await projectFilter(req.user, req.query?.projectId);
  return { stats: await stats(filter.projectId, filter.projectIds) };
});

app.put('/ingest/:projectKey/settings', async (req, reply) => {
  try {
    const project = await saveClientSettings(req.params.projectKey, {
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
    const project = await getProjectByKey(req.params.projectKey);
    if (!project) return reply.code(401).send({ ok: false, error: 'Unknown project key' });
    if (await isCompanyPaused(project.company_id)) {
      return reply.code(403).send({ ok: false, error: 'This company is paused.' });
    }
    const result = await ingestEvent(req.params.projectKey, req.body);
    emitToProject(result.project, 'pulse:event', {
      issue: result.issue,
      event: result.event,
      projectId: result.project.id,
    });
    const willRun = shouldRunAgent(result, result.project);
    if (willRun) {
      startAgent(result.issue, result.event, Boolean(result.reopened), result.project).catch((error) => app.log.error({ err: error }, 'Pulse AI agent failed to start'));
    }
    return reply.code(202).send({
      ok: true,
      id: result.event.id,
      issueId: result.issue.id,
      agentStarted: willRun,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return reply.code(status).send({ ok: false, error: error.message });
  }
});

function dashboardMime(filePath) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  }[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

app.setNotFoundHandler((req, reply) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return reply.code(404).send({ error: 'Not found' });
  }
  const urlPath = decodeURIComponent(String(req.url || '/').split('?')[0]);
  if (
    urlPath.startsWith('/api')
    || urlPath.startsWith('/ingest')
    || urlPath.startsWith('/health')
    || urlPath.startsWith('/realtime')
  ) {
    return reply.code(404).send({ error: 'Not found' });
  }
  const distRoot = path.resolve(dashboardDist);
  const requested = path.resolve(distRoot, urlPath.replace(/^\/+/, ''));
  if (!requested.startsWith(distRoot)) {
    return reply.code(404).send({ error: 'Not found' });
  }
  const index = path.join(distRoot, 'index.html');
  const target = existsSync(requested) && statSync(requested).isFile() ? requested : index;
  if (!existsSync(target)) {
    return reply.code(404).send({ error: 'Dashboard build missing. Run npm run build first.' });
  }
  reply.type(dashboardMime(target));
  return reply.send(createReadStream(target));
});

const start = async () => {
  await connectDb();
  await app.ready();
  const io = new Server(app.server, {
    cors: { origin: true },
    path: '/realtime',
  });
  app.decorate('io', io);
  io.on('connection', async (socket) => {
    const user = await getUserByToken(socket.handshake.auth?.token || '');
    if (user) {
      socket.join(`user:${user.id}`);
      for (const room of await roomsForUser(user)) socket.join(room);
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
  disconnectDb().catch(() => {});
  process.exit(1);
});
