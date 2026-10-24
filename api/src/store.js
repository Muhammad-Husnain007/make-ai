import { nanoid } from 'nanoid';
import { z } from 'zod';
import { AdminNotification, Company, Event, Issue, Project } from './db.js';
import { culpritFromStack, fingerprintEvent } from './fingerprint.js';
import { isPasswordKey, stripPasswordFields } from './safeJson.js';

const ingestSchema = z.object({
  type: z.string().max(120).optional(), message: z.string().min(1).max(4000), stack: z.string().max(20_000).optional(),
  level: z.enum(['fatal', 'error', 'warning', 'info', 'debug']).optional(), timestamp: z.string().datetime().optional(),
  url: z.string().max(2048).optional(), environment: z.string().max(40).optional(), release: z.string().max(80).optional(),
  user: z.record(z.any()).optional(), tags: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  breadcrumbs: z.array(z.record(z.any())).max(50).optional(), extra: z.record(z.any()).optional(), sdk: z.string().max(80).optional(),
});

const plain = (doc) => doc?.toObject ? doc.toObject() : doc;
const issueWithProject = async (id) => {
  const issue = plain(await Issue.findOne({ id }).lean());
  if (!issue) return null;
  const project = plain(await Project.findOne({ id: issue.project_id }).lean());
  return project ? { ...issue, notify_email: project.notify_email || '', project_name: project.name } : issue;
};

export async function setAgentStatus(id, status) {
  await Issue.updateOne({ id }, { $set: { agent_status: status } });
  return issueWithProject(id);
}

export async function saveAgentResult(id, { status, summary, solution, prUrl, emailedAt, emailedTo, agentError }) {
  const update = { agent_status: status || 'done', agent_summary: summary || '', agent_solution: solution || '', emailed_at: emailedAt || null, emailed_to: emailedTo || '', agent_error: agentError || '' };
  if (prUrl) Object.assign(update, { pr_url: prUrl, pr_merged: false, pr_closed: false, status: 'resolved' });
  await Issue.updateOne({ id }, { $set: update });
  return issueWithProject(id);
}

export async function saveAgentPipeline(id, payload) {
  await Issue.updateOne({ id }, { $set: { agent_pipeline: payload || {} } });
  return issueWithProject(id);
}

export async function getAgentPipeline(id) {
  const issue = await Issue.findOne({ id }, { agent_pipeline: 1 }).lean();
  return issue?.agent_pipeline || {};
}

function serializeNotification(row) {
  if (!row) return null;
  return { id: row.id, companyId: row.company_id || null, companyName: row.company_name || '', projectId: row.project_id || null, issueId: row.issue_id || null, title: row.title, message: row.message, readAt: row.read_at || null, createdAt: row.created_at };
}

export async function createAdminNotification({ companyId, projectId, issueId, title, message }) {
  const company = companyId ? await Company.findOne({ id: companyId }, { name: 1 }).lean() : null;
  const payload = { id: nanoid(), company_id: companyId || null, company_name: company?.name || '', project_id: projectId || null, issue_id: issueId || null, title: String(title || 'AI agent error').slice(0, 240), message: String(message || 'Unknown agent error').slice(0, 4000), created_at: new Date().toISOString(), read_at: null };
  if (issueId) {
    const { id: _id, ...updatePayload } = payload;
    const existing = await AdminNotification.findOneAndUpdate({ issue_id: issueId, read_at: null }, { $set: updatePayload }, { new: true, sort: { created_at: -1 } }).lean();
    if (existing) return serializeNotification(existing);
  }
  return serializeNotification(await AdminNotification.create(payload));
}

export function normalizeNotifyEmail(value) {
  const emails = String(value || '').split(/[,;\s]+/).map((item) => item.trim().toLowerCase()).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
  return [...new Set(emails)].join(', ');
}
export function parseBoolFlag(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^(true|1|yes|on)$/i.test(raw)) return true;
  if (/^(false|0|no|off)$/i.test(raw)) return false;
  return null;
}
export function normalizeGithubRepo(value) {
  const raw = String(value || '').trim().replace(/\.git$/i, '');
  const hosted = raw.match(/github\.com[:/]+([^/]+)\/([^/#?]+)/i);
  if (hosted) return `${hosted[1]}/${hosted[2]}`;
  return raw.replace(/^\/+|\/+$/g, '');
}
export function serializeProject(project) {
  if (!project) return null;
  return { id: project.id, name: project.name, public_key: project.public_key, created_at: project.created_at, notify_email: project.notify_email || '', github_repo: project.github_repo || '', github_base_branch: project.github_base_branch || '', github_connected: Boolean(project.github_token && project.github_repo), send_email_enabled: Boolean(project.send_email_enabled), company_id: project.company_id || null };
}

export async function listProjects(scope = { all: true }) {
  const query = scope.all ? {} : { id: { $in: scope.projectIds || [] } };
  if (!scope.all && !scope.projectIds?.length) return [];
  return (await Project.find(query).sort({ created_at: -1 }).lean()).map(serializeProject);
}
export async function listGithubProjects() { return Project.find({ github_token: { $exists: true, $ne: '' }, github_repo: { $exists: true, $ne: '' } }).sort({ created_at: -1 }).lean(); }
export async function listGithubProjectsForScope(scope = { all: true }) {
  if (scope.all) return listGithubProjects();
  if (!scope.projectIds?.length) return [];
  return Project.find({ id: { $in: scope.projectIds }, github_token: { $exists: true, $ne: '' }, github_repo: { $exists: true, $ne: '' } }).lean();
}
export async function createProject(name, notifyEmail, companyId = null) {
  const project = { id: nanoid(), name: String(name || 'New project').trim().slice(0, 80) || 'New project', public_key: `pk_live_${nanoid(18)}`, created_at: new Date().toISOString(), notify_email: normalizeNotifyEmail(notifyEmail) || '', company_id: companyId || null };
  await Project.create(project);
  return serializeProject(project);
}
export async function getProject(id) { return plain(await Project.findOne({ id }).lean()) || null; }
export async function getProjectByKey(publicKey) { return plain(await Project.findOne({ public_key: publicKey }).lean()) || null; }

export async function saveClientSettings(publicKey, input = {}) {
  const project = await Project.findOne({ public_key: publicKey }).lean();
  if (!project) { const err = new Error('Unknown project key'); err.statusCode = 401; throw err; }
  const nextName = input.name ? String(input.name).trim().slice(0, 80) || project.name : project.name;
  let nextEmail = project.notify_email || '';
  if (input.notifyEmail != null && String(input.notifyEmail).trim() !== '') {
    nextEmail = normalizeNotifyEmail(input.notifyEmail);
    if (!nextEmail) { const err = new Error('Client PR email is invalid. Set PULSE_NOTIFY_EMAIL in the client app.'); err.statusCode = 400; throw err; }
  }
  const nextToken = input.githubToken != null && String(input.githubToken).trim() !== '' ? String(input.githubToken).trim() : project.github_token || '';
  const nextRepo = normalizeGithubRepo(input.githubRepo != null && String(input.githubRepo).trim() !== '' ? input.githubRepo : project.github_repo || '');
  const nextBranch = input.githubBaseBranch != null && String(input.githubBaseBranch).trim() !== '' ? String(input.githubBaseBranch).trim() : project.github_base_branch || '';
  if (nextRepo && !nextRepo.includes('/')) { const err = new Error('GITHUB_REPO must be owner/name or a github.com URL'); err.statusCode = 400; throw err; }
  const parsedSend = parseBoolFlag(input.isEnabledSendEmail ?? input.sendEmailEnabled ?? input.send_email_enabled);
  await Project.updateOne({ id: project.id }, { $set: { name: nextName, notify_email: nextEmail, github_token: nextToken, github_repo: nextRepo, github_base_branch: nextBranch, send_email_enabled: parsedSend == null ? Boolean(project.send_email_enabled) : parsedSend } });
  return getProject(project.id);
}
export async function updateProject(id, { name, notifyEmail } = {}) {
  const project = await Project.findOne({ id }).lean();
  if (!project) return null;
  const nextName = name != null ? String(name).trim().slice(0, 80) || project.name : project.name;
  let nextEmail = project.notify_email || '';
  if (notifyEmail != null) { nextEmail = normalizeNotifyEmail(notifyEmail); if (!nextEmail) { const err = new Error('Enter a valid email for PR alerts'); err.statusCode = 400; throw err; } }
  await Project.updateOne({ id }, { $set: { name: nextName, notify_email: nextEmail } });
  return serializeProject(await getProject(id));
}

export async function applyPullStates(pulls = []) {
  const byUrl = new Map(pulls.filter((p) => p?.url).map((p) => [String(p.url).replace(/\/$/, ''), p]));
  const issues = await Issue.find({ pr_url: { $exists: true, $ne: '' } }, { id: 1, pr_url: 1 }).lean();
  const ops = [];
  for (const issue of issues) {
    const pull = byUrl.get(String(issue.pr_url).replace(/\/$/, ''));
    if (pull) ops.push({ updateOne: { filter: { id: issue.id }, update: { $set: { pr_merged: Boolean(pull.merged), pr_closed: Boolean(pull.closed || pull.merged), ...(pull.merged ? { status: 'resolved' } : {}) } } } });
  }
  if (ops.length) await Issue.bulkWrite(ops);
  await Issue.updateMany({ status: 'open', pr_merged: true }, { $set: { status: 'resolved', pr_closed: true } });
  await Issue.updateMany({ status: 'open', agent_status: 'done', pr_url: { $exists: true, $ne: '' } }, { $set: { status: 'resolved' } });
}

function issueQuery({ projectId, projectIds, status, environment, q } = {}) {
  const query = {};
  if (projectId) query.project_id = projectId; else if (projectIds) query.project_id = { $in: projectIds };
  if (status === 'fixed' || status === 'resolved') Object.assign(query, { agent_status: 'done', pr_url: { $exists: true, $ne: '' } });
  else if (status === 'create-pull') Object.assign(query, { pr_url: { $exists: true, $ne: '' }, pr_merged: { $ne: true }, pr_closed: { $ne: true } });
  else if (status === 'merge-pull') query.pr_merged = true;
  else if (status === 'closed-pull') query.pr_closed = true;
  else if (status === 'open') Object.assign(query, { status: 'open', $nor: [{ agent_status: 'done', pr_url: { $exists: true, $ne: '' } }] });
  else if (status === 'performance') query.$or = [{ title: /timeout|slow|latency|performance/i }, { culprit: /timeout/i }];
  else if (status && status !== 'all') query.status = status;
  if (q) query.$and = [...(query.$and || []), { $or: [{ title: new RegExp(escapeRegExp(q), 'i') }, { culprit: new RegExp(escapeRegExp(q), 'i') }] }];
  return query;
}
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export async function listIssues(options = {}) {
  await Issue.updateMany({ status: 'open', agent_status: 'done', pr_url: { $exists: true, $ne: '' } }, { $set: { status: 'resolved' } });
  const query = issueQuery(options);
  if (options.projectIds && !options.projectIds.length) return [];
  if (options.environment) {
    const projectIssues = await Event.distinct('issue_id', { environment: options.environment });
    query.id = { $in: projectIssues };
  }
  const issues = await Issue.find(query).sort({ last_seen: -1 }).limit(Math.min(Number(options.limit) || 80, 200)).lean();
  return issues;
}
function eventUserKey(user = {}) { return String(user.id || user.email || (user.ip ? `anon:${user.ip}` : '')).trim(); }
async function distinctUserCount(issueId) {
  const events = await Event.find({ issue_id: issueId }, { user: 1 }).lean();
  return new Set(events.map((event) => eventUserKey(event.user)).filter(Boolean)).size;
}
function serializeEvent(event) {
  return { ...event, user: stripPasswordFields(event.user || {}), tags: event.tags || {}, breadcrumbs: event.breadcrumbs || [], extra: stripPasswordFields(event.extra || {}), release: event.release_name };
}
export async function getIssue(id) {
  const issue = await issueWithProject(id);
  if (!issue) return null;
  const events = (await Event.find({ issue_id: id }).sort({ timestamp: -1 }).limit(40).lean()).map(serializeEvent);
  const allEvents = await Event.find({ issue_id: id }, { user: 1, timestamp: 1 }).lean();
  const users = new Map();
  for (const event of allEvents) {
    const key = eventUserKey(event.user);
    if (!key) continue;
    const previous = users.get(key) || { id: key, email: event.user?.email || '', events: 0, lastSeen: event.timestamp };
    previous.events += 1;
    if (event.timestamp > previous.lastSeen) previous.lastSeen = event.timestamp;
    if (!previous.email && event.user?.email) previous.email = event.user.email;
    users.set(key, previous);
  }
  const affectedUsers = [...users.values()].sort((a, b) => b.events - a.events || b.lastSeen.localeCompare(a.lastSeen)).slice(0, 50);
  await Issue.updateOne({ id }, { $set: { user_count: users.size } });
  const since = new Date(Date.now() - 86400000).toISOString();
  const recent = await Event.find({ issue_id: id, timestamp: { $gte: since } }, { timestamp: 1 }).sort({ timestamp: 1 }).lean();
  const hours = new Map();
  for (const event of recent) { const hour = `${event.timestamp.slice(0, 13)}:00:00.000Z`; hours.set(hour, (hours.get(hour) || 0) + 1); }
  return { ...(await issueWithProject(id)), events, hourly: [...hours].map(([hour, count]) => ({ hour, count })), affectedUsers, user_count: users.size };
}
export async function setIssueStatus(id, status) {
  if (!['open', 'resolved', 'ignored'].includes(status)) return null;
  await Issue.updateOne({ id }, { $set: { status } });
  return issueWithProject(id);
}
export async function deleteIssue(id) {
  const issue = await issueWithProject(id);
  if (!issue) return null;
  await Promise.all([Event.deleteMany({ issue_id: id }), AdminNotification.deleteMany({ issue_id: id }), Issue.deleteOne({ id })]);
  return issue;
}

export async function stats(projectId, projectIds) {
  await Issue.updateMany({ status: 'open', agent_status: 'done', pr_url: { $exists: true, $ne: '' } }, { $set: { status: 'resolved' } });
  if (projectIds && !projectIds.length) return { openIssues: 0, fixedIssues: 0, createPull: 0, mergePull: 0, closedPull: 0, events24h: 0, users24h: 0, series: [], byLevel: [] };
  const scope = projectId ? { project_id: projectId } : projectIds ? { project_id: { $in: projectIds } } : {};
  const issueRows = await Issue.find(scope).lean();
  const since = new Date(Date.now() - 86400000).toISOString();
  const events = await Event.find({ ...scope, timestamp: { $gte: since } }).lean();
  const seriesMap = new Map();
  const userIds = new Set();
  for (const event of events) {
    const hour = `${event.timestamp.slice(0, 13)}:00:00.000Z`;
    seriesMap.set(hour, (seriesMap.get(hour) || 0) + 1);
    const key = eventUserKey(event.user);
    if (key) userIds.add(key);
  }
  const open = issueRows.filter((i) => i.status === 'open' && !(i.agent_status === 'done' && i.pr_url)).length;
  const byLevelMap = new Map();
  for (const issue of issueRows.filter((i) => i.status === 'open' && !(i.agent_status === 'done' && i.pr_url))) byLevelMap.set(issue.level, (byLevelMap.get(issue.level) || 0) + 1);
  return {
    openIssues: open,
    fixedIssues: issueRows.filter((i) => i.agent_status === 'done' && i.pr_url).length,
    createPull: issueRows.filter((i) => i.pr_url && !i.pr_merged && !i.pr_closed).length,
    mergePull: issueRows.filter((i) => i.pr_merged).length,
    closedPull: issueRows.filter((i) => i.pr_closed).length,
    events24h: events.length,
    users24h: userIds.size,
    series: [...seriesMap].sort(([a], [b]) => a.localeCompare(b)).map(([hour, count]) => ({ hour, count })),
    byLevel: [...byLevelMap].map(([level, count]) => ({ level, count })),
  };
}

function normalizeEventUser(user) {
  const raw = user && typeof user === 'object' ? user : {};
  const id = String(raw.id || raw._id || '').trim();
  const email = String(raw.email || '').trim();
  const ip = String(raw.ip || '').trim();
  const stable = id || email || (ip ? `anon:${ip}` : '');
  const cleaned = {};
  for (const [key, value] of Object.entries(raw)) if (!isPasswordKey(key)) cleaned[key] = value;
  return stripPasswordFields({ ...cleaned, id: stable, email, ip });
}
export async function ingestEvent(publicKey, rawBody) {
  const project = await getProjectByKey(publicKey);
  if (!project) { const err = new Error('Unknown project key'); err.statusCode = 401; throw err; }
  const parsed = ingestSchema.safeParse(rawBody);
  if (!parsed.success) { const err = new Error(parsed.error.issues[0]?.message || 'Invalid event'); err.statusCode = 400; throw err; }
  const body = parsed.data; const seen = body.timestamp || new Date().toISOString(); const type = body.type || 'Error'; const level = body.level || 'error';
  const fingerprint = fingerprintEvent({ type, message: body.message, stack: body.stack });
  const culprit = culpritFromStack(body.stack); const title = `${type}: ${body.message}`.slice(0, 240); const user = normalizeEventUser(body.user);
  let issue = await Issue.findOne({ project_id: project.id, fingerprint }).lean();
  let isNew = !issue; let reopened = issue?.status === 'resolved';
  if (!issue) {
    try { issue = await Issue.create({ id: nanoid(), project_id: project.id, fingerprint, title, culprit, type, level, status: 'open', count: 1, user_count: user.id ? 1 : 0, first_seen: seen, last_seen: seen }); issue = plain(issue); }
    catch (error) {
      if (error.code !== 11000) throw error;
      issue = await Issue.findOne({ project_id: project.id, fingerprint }).lean();
      isNew = false;
      reopened = issue?.status === 'resolved';
      if (issue) {
        const update = { $inc: { count: 1 }, $set: { last_seen: seen, title, culprit } };
        if (level === 'fatal') update.$set.level = level;
        if (reopened) update.$set.status = 'open';
        issue = await Issue.findOneAndUpdate({ id: issue.id }, update, { new: true }).lean();
      }
    }
  } else {
    const update = { $inc: { count: 1 }, $set: { last_seen: seen, title, culprit } };
    if (level === 'fatal') update.$set.level = level;
    if (reopened) update.$set.status = 'open';
    issue = await Issue.findOneAndUpdate({ id: issue.id }, update, { new: true }).lean();
  }
  const event = { id: nanoid(), issue_id: issue.id, project_id: project.id, timestamp: seen, level, message: body.message, type, stack: body.stack || '', url: body.url || '', environment: body.environment || 'production', release_name: body.release || '', user, tags: body.tags || {}, breadcrumbs: body.breadcrumbs || [], extra: stripPasswordFields(body.extra || {}), sdk: body.sdk || '@pulse/sdk' };
  await Event.create(event);
  const userCount = await distinctUserCount(issue.id);
  await Issue.updateOne({ id: issue.id }, { $set: { user_count: userCount } });
  const updated = await issueWithProject(issue.id);
  return { project, issue: updated, event: serializeEvent(event), isNew, reopened };
}
