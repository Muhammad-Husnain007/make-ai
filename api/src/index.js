import './env.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Server } from 'socket.io';
import { listPullStates, runFixAgent, shouldRunAgent } from '@pulse/agent';
import { applyPullStates, createProject, getIssue, getProject, ingestEvent, listIssues, listProjects, saveAgentResult, setAgentStatus, setIssueStatus, stats, updateProject } from './store.js';
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

app.addContentTypeParser('text/plain', { parseAs: 'string' }, (req, body, done) => {
  try {
    done(null, JSON.parse(body || '{}'));
  } catch (error) {
    done(error);
  }
});

const agentStore = { getIssue, getProject, saveAgentResult, setAgentStatus };

function queueAgent(issue, event, force = false, project = null) {
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
    applyPullStates(await listPullStates());
  } catch (error) {
    app.log.warn({ err: error }, 'Unable to refresh pull request statuses');
  }
}

app.get('/health', async () => ({
  ok: true,
  service: 'pulse-api',
  agent: {
    gemini: Boolean(process.env.GEMINI_API_KEY),
    github: Boolean(process.env.GITHUB_TOKEN),
    smtp: Boolean(process.env.SMTP_USER || process.env.GMAIL_USER),
    mailTo: process.env.MAIL_TO || 'mh8169951@gmail.com',
    sendPrViaEmail: !/^(false|0|no|off)$/i.test(String(process.env.SENDPRVIAEMAIL ?? 'true').trim()),
  },
}));

app.get('/api/projects', async () => ({ projects: listProjects() }));

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
  await syncPullStatuses();
  const { projectId, status, environment, q, limit } = req.query || {};
  return { issues: listIssues({ projectId, status, environment, q, limit }) };
});

app.get('/api/issues/:id', async (req, reply) => {
  const issue = getIssue(req.params.id);
  if (!issue) return reply.code(404).send({ error: 'Issue not found' });
  return { issue };
});

app.patch('/api/issues/:id', async (req, reply) => {
  const issue = setIssueStatus(req.params.id, req.body?.status);
  if (!issue) return reply.code(400).send({ error: 'Unable to update issue' });
  app.io.emit('pulse:issue', issue);
  return { issue };
});

app.post('/api/issues/:id/agent', async (req, reply) => {
  const issue = getIssue(req.params.id);
  if (!issue) return reply.code(404).send({ error: 'Issue not found' });
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
  await syncPullStatuses();
  return { stats: stats(req.query?.projectId) };
});

app.post('/ingest/:projectKey', {
  config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
}, async (req, reply) => {
  try {
    const result = ingestEvent(req.params.projectKey, req.body);
    app.io.emit('pulse:event', {
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
    socket.emit('pulse:hello', { ok: true, ts: Date.now() });
  });
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Pulse API http://${HOST}:${PORT}`);
};

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
