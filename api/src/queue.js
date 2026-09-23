import { Queue, Worker } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import IORedis from 'ioredis';
import {
  canContinueToFix,
  canContinueToPr,
  finalizeAgent,
  fixIssue,
  loadGithubContext,
  makeFixPr,
  runFixAgent,
  scanIssue,
  sendInviteEmail,
  testFix,
} from '@pulse/agent';
import { parseBoolFlag } from './store.js';

export const QUEUE_KEYS = {
  scan: 'pulse-scan',
  fix: 'pulse-fix',
  test: 'pulse-test',
  pr: 'pulse-pr',
  invite: 'pulse-invite',
};

const JOB_OPTS = {
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 200 },
  attempts: 2,
  backoff: { type: 'exponential', delay: 8000 },
};

let queues = null;
let workers = [];
let queueReady = false;
let redisError = '';
const runtime = { logger: console, io: null, store: null };

export function isQueueEnabled() {
  return parseBoolFlag(process.env.ISQUEUEENABLE) === true;
}

export function redisUrl() {
  return String(process.env.REDIS_URL || '').trim();
}

function connectionSettings() {
  const raw = redisUrl();
  if (!raw) {
    throw new Error('REDIS_URL is required when ISQUEUEENABLE=true');
  }
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

function compactEvent(event) {
  if (!event) return {};
  return {
    id: event.id,
    stack: event.stack || '',
    url: event.url || '',
    extra: event.extra || {},
    release: event.release || event.release_name || '',
    release_name: event.release_name || event.release || '',
    environment: event.environment || '',
    level: event.level || '',
    message: event.message || '',
  };
}

function githubMeta(github) {
  return {
    ok: Boolean(github?.ok),
    repoFull: github?.repoFull || '',
    base: github?.base || '',
    reason: github?.reason || '',
    unmatchedReason: github?.unmatchedReason || '',
  };
}

function ensureQueues() {
  if (queues) return queues;
  const connection = connectionSettings();
  queues = {
    scan: new Queue(QUEUE_KEYS.scan, { connection }),
    fix: new Queue(QUEUE_KEYS.fix, { connection }),
    test: new Queue(QUEUE_KEYS.test, { connection }),
    pr: new Queue(QUEUE_KEYS.pr, { connection }),
    invite: new Queue(QUEUE_KEYS.invite, { connection }),
  };
  return queues;
}

function agentStore() {
  return runtime.store;
}

function loadIssueContext(issueId, projectId) {
  const store = agentStore();
  const issue = store.getIssue(issueId);
  if (!issue) throw new Error(`Issue ${issueId} not found`);
  const project = store.getProject(projectId || issue.project_id);
  return { issue, project, store };
}

async function runInlineAgent(issue, event, force, project) {
  return runFixAgent({
    issue,
    event,
    logger: runtime.logger,
    io: runtime.io,
    force,
    project,
    store: agentStore(),
  });
}

function failJob(job, error) {
  const { issueId, event, projectId } = job.data || {};
  if (!issueId) throw error;
  try {
    const { issue, project, store } = loadIssueContext(issueId, projectId);
    return finalizeAgent({
      issue,
      event,
      analysis: { summary: error.message, rootCause: '', solution: '', prTitle: '', prBody: '' },
      prUrl: '',
      agentError: error.message || 'Queue job failed',
      project,
      store,
      io: runtime.io,
      logger: runtime.logger,
    });
  } catch {
    throw error;
  }
}

async function handleScan(job) {
  try {
    const { issueId, event, force, projectId } = job.data;
    const { issue, project, store } = loadIssueContext(issueId, projectId);
    store.setAgentStatus(issue.id, 'running');
    const scan = await scanIssue({
      issue,
      event,
      project,
      logger: runtime.logger,
      store,
    });
    store.saveAgentPipeline(issue.id, {
      analysis: scan.analysis,
      agentError: scan.agentError,
      github: githubMeta(scan.github),
    });
    if (!canContinueToFix(scan)) {
      return finalizeAgent({
        issue,
        event,
        analysis: scan.analysis,
        prUrl: '',
        agentError: scan.agentError,
        project,
        store,
        io: runtime.io,
        logger: runtime.logger,
      });
    }
    await queues.fix.add('fix-issue', { issueId, event: compactEvent(event), projectId: project?.id, force }, JOB_OPTS);
    return { continued: 'fix', issueId };
  } catch (error) {
    await failJob(job, error);
    throw error;
  }
}

async function handleFix(job) {
  try {
    const { issueId, event, projectId } = job.data;
    const { issue, project, store } = loadIssueContext(issueId, projectId);
    const pipeline = store.getAgentPipeline(issue.id);
    const { github, githubConfig } = await loadGithubContext({ issue, event, project });
    const analysis = pipeline.analysis || {};
    const fix = await fixIssue({
      issue,
      analysis,
      github,
      agentError: pipeline.agentError || '',
    });
    store.saveAgentPipeline(issue.id, {
      analysis: fix.analysis,
      agentError: fix.agentError,
      github: githubMeta(github),
      githubConfig,
      files: fix.files,
    });
    if (!fix.files.length) {
      return finalizeAgent({
        issue,
        event,
        analysis: fix.analysis,
        prUrl: '',
        agentError: fix.agentError,
        project,
        store,
        io: runtime.io,
        logger: runtime.logger,
      });
    }
    await queues.test.add('test-issue', { issueId, event: compactEvent(event), projectId: project?.id }, JOB_OPTS);
    return { continued: 'test', issueId, files: fix.files.length };
  } catch (error) {
    await failJob(job, error);
    throw error;
  }
}

async function handleTest(job) {
  try {
    const { issueId, event, projectId } = job.data;
    const { issue, project, store } = loadIssueContext(issueId, projectId);
    const pipeline = store.getAgentPipeline(issue.id);
    const { github, githubConfig } = await loadGithubContext({ issue, event, project });
    const tested = await testFix({
      issue,
      event,
      files: pipeline.files || [],
      analysis: pipeline.analysis || {},
      github,
      githubConfig,
      agentError: pipeline.agentError || '',
      logger: runtime.logger,
    });
    store.saveAgentPipeline(issue.id, {
      analysis: tested.analysis,
      agentError: tested.agentError,
      github: githubMeta(github),
      githubConfig,
      files: tested.files,
      tests: tested.tests,
    });
    if (!canContinueToPr(tested)) {
      return finalizeAgent({
        issue,
        event,
        analysis: tested.analysis,
        prUrl: '',
        agentError: tested.agentError,
        project,
        store,
        io: runtime.io,
        logger: runtime.logger,
      });
    }
    await queues.pr.add('create-pr', { issueId, event: compactEvent(event), projectId: project?.id }, JOB_OPTS);
    return { continued: 'pr', issueId, files: tested.files.length };
  } catch (error) {
    await failJob(job, error);
    throw error;
  }
}

async function handlePr(job) {
  try {
    const { issueId, event, projectId } = job.data;
    const { issue, project, store } = loadIssueContext(issueId, projectId);
    const pipeline = store.getAgentPipeline(issue.id);
    const pr = await makeFixPr({
      issue,
      event,
      github: pipeline.github || { ok: false },
      githubConfig: {
        githubToken: project?.github_token,
        githubRepo: project?.github_repo,
        githubBaseBranch: project?.github_base_branch,
      },
      files: pipeline.files || [],
      analysis: pipeline.analysis || {},
      agentError: pipeline.agentError || '',
    });
    store.saveAgentPipeline(issue.id, {
      ...pipeline,
      analysis: pr.analysis,
      agentError: pr.agentError,
      prUrl: pr.prUrl,
    });
    return finalizeAgent({
      issue,
      event,
      analysis: pr.analysis,
      prUrl: pr.prUrl,
      agentError: pr.agentError,
      project,
      store,
      io: runtime.io,
      logger: runtime.logger,
    });
  } catch (error) {
    await failJob(job, error);
    throw error;
  }
}

async function handleInvite(job) {
  return sendInviteEmail(job.data);
}

export async function enqueueScan({ issue, event, force = false, project = null }) {
  if (!queueReady) {
    setImmediate(() => {
      runInlineAgent(issue, event, force, project).catch((error) => {
        runtime.logger?.error?.({ err: error }, 'Pulse AI agent failed');
      });
    });
    return { queued: false, inline: true, issueId: issue.id };
  }
  agentStore().setAgentStatus(issue.id, 'running');
  await queues.scan.add(
    'scan-issue',
    {
      issueId: issue.id,
      event: compactEvent(event),
      force,
      projectId: project?.id || issue.project_id,
    },
    JOB_OPTS,
  );
  return { queued: true, issueId: issue.id };
}

export async function enqueueInvite(payload) {
  if (!queueReady) {
    return sendInviteEmail(payload);
  }
  await queues.invite.add('send-invite', payload, JOB_OPTS);
  return { ok: true, queued: true, to: payload.to };
}

export async function startQueue({ logger, io, store }) {
  runtime.logger = logger || console;
  runtime.io = io || null;
  runtime.store = store;
  if (!isQueueEnabled()) {
    queueReady = false;
    logger?.info?.('Pulse queues off (ISQUEUEENABLE=false). Jobs run inline.');
    return { enabled: false, ready: false };
  }
  if (!redisUrl()) {
    queueReady = false;
    redisError = 'REDIS_URL is required when ISQUEUEENABLE=true';
    logger?.error?.(redisError);
    return { enabled: true, ready: false, error: redisError };
  }
  try {
    const probe = new IORedis(redisUrl(), { maxRetriesPerRequest: null, lazyConnect: true, connectTimeout: 4000 });
    await probe.connect();
    await probe.ping();
    await probe.quit().catch(() => {});
    const connection = connectionSettings();
    ensureQueues();
    workers = [
      new Worker(QUEUE_KEYS.scan, handleScan, { connection, concurrency: 2 }),
      new Worker(QUEUE_KEYS.fix, handleFix, { connection, concurrency: 2 }),
      new Worker(QUEUE_KEYS.test, handleTest, { connection, concurrency: 2 }),
      new Worker(QUEUE_KEYS.pr, handlePr, { connection, concurrency: 1 }),
      new Worker(QUEUE_KEYS.invite, handleInvite, { connection, concurrency: 4 }),
    ];
    for (const worker of workers) {
      worker.on('failed', (job, error) => {
        logger?.error?.({ err: error, queue: worker.name, jobId: job?.id }, 'Pulse queue job failed');
      });
    }
    queueReady = true;
    redisError = '';
    logger?.info?.(`Pulse queues on Redis ${redisUrl()}`);
    return { enabled: true, ready: true };
  } catch (error) {
    queueReady = false;
    redisError = error.message;
    logger?.error?.({ err: error }, 'Pulse queues failed to start; jobs will run inline');
    return { enabled: true, ready: false, error: error.message };
  }
}

function summarizeJobData(data = {}) {
  if (data.to) return { to: data.to, companyName: data.companyName, kind: data.kind };
  return { issueId: data.issueId, projectId: data.projectId, force: Boolean(data.force) };
}

function serializeJob(job, state, queueName) {
  return {
    id: String(job.id),
    name: job.name,
    queue: queueName,
    state,
    timestamp: job.timestamp,
    processedOn: job.processedOn || null,
    finishedOn: job.finishedOn || null,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason || '',
    data: summarizeJobData(job.data),
  };
}

export async function getQueueDashboard() {
  const enabled = isQueueEnabled();
  if (!enabled) {
    return {
      enabled: false,
      ready: false,
      redis: redisUrl(),
      redisError: '',
      queues: Object.keys(QUEUE_KEYS).map((name) => ({
        name,
        counts: { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 },
        jobs: [],
      })),
    };
  }
  if (!queueReady) {
    return {
      enabled: true,
      ready: false,
      redis: redisUrl(),
      redisError: redisError || 'Redis is not connected',
      queues: Object.keys(QUEUE_KEYS).map((name) => ({
        name,
        counts: { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 },
        jobs: [],
      })),
    };
  }
  const states = ['waiting', 'active', 'delayed', 'failed', 'completed'];
  const result = [];
  for (const [name, queue] of Object.entries(ensureQueues())) {
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
    const jobs = [];
    for (const state of states) {
      const batch = await queue.getJobs([state], 0, 15);
      for (const job of batch) jobs.push(serializeJob(job, state, name));
    }
    jobs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    result.push({ name, counts, jobs: jobs.slice(0, 30) });
  }
  return {
    enabled: true,
    ready: true,
    redis: redisUrl(),
    redisError: '',
    queues: result,
  };
}

export function registerQueueBoard(app, { authenticate } = {}) {
  if (!isQueueEnabled()) return;
  ensureQueues();
  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath('/queues/ui');
  createBullBoard({
    queues: Object.values(queues).map((queue) => new BullMQAdapter(queue)),
    serverAdapter,
  });
  if (authenticate) {
    app.addHook('onRequest', async (req, reply) => {
      const path = (req.url || '').split('?')[0];
      if (!path.startsWith('/queues')) return;
      return authenticate(req, reply);
    });
  }
  app.register(serverAdapter.registerPlugin(), { prefix: '/queues/ui' });
}

export function queueHealth() {
  return {
    enabled: isQueueEnabled(),
    ready: queueReady,
    redis: redisUrl(),
    error: redisError || undefined,
  };
}
