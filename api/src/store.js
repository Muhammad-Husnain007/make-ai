import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from './db.js';
import { culpritFromStack, fingerprintEvent } from './fingerprint.js';

const ingestSchema = z.object({
  type: z.string().max(120).optional(),
  message: z.string().min(1).max(4000),
  stack: z.string().max(20_000).optional(),
  level: z.enum(['fatal', 'error', 'warning', 'info', 'debug']).optional(),
  timestamp: z.string().datetime().optional(),
  url: z.string().max(2048).optional(),
  environment: z.string().max(40).optional(),
  release: z.string().max(80).optional(),
  user: z.record(z.any()).optional(),
  tags: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  breadcrumbs: z.array(z.record(z.any())).max(50).optional(),
  extra: z.record(z.any()).optional(),
  sdk: z.string().max(80).optional(),
});

const stmts = {
  projectByKey: db.prepare('SELECT * FROM projects WHERE public_key = ?'),
  projectById: db.prepare('SELECT * FROM projects WHERE id = ?'),
  listProjects: db.prepare('SELECT * FROM projects ORDER BY created_at DESC'),
  insertProject: db.prepare('INSERT INTO projects (id, name, public_key, created_at, notify_email, company_id) VALUES (?, ?, ?, ?, ?, ?)'),
  updateProject: db.prepare('UPDATE projects SET name = ?, notify_email = ? WHERE id = ?'),
  updateClientSettings: db.prepare(`
    UPDATE projects
    SET name = ?, notify_email = ?, github_token = ?, github_repo = ?, github_base_branch = ?, send_email_enabled = ?
    WHERE id = ?
  `),
  findIssue: db.prepare('SELECT * FROM issues WHERE project_id = ? AND fingerprint = ?'),
  insertIssue: db.prepare(`
    INSERT INTO issues (id, project_id, fingerprint, title, culprit, type, level, status, count, user_count, first_seen, last_seen)
    VALUES (@id, @project_id, @fingerprint, @title, @culprit, @type, @level, 'open', 1, @user_count, @seen, @seen)
  `),
  bumpIssue: db.prepare(`
    UPDATE issues
    SET count = count + 1,
        last_seen = @seen,
        level = CASE WHEN @level = 'fatal' THEN 'fatal' ELSE level END,
        status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END,
        title = @title,
        culprit = @culprit
    WHERE id = @id
  `),
  insertEvent: db.prepare(`
    INSERT INTO events (
      id, issue_id, project_id, timestamp, level, message, type, stack, url,
      environment, release_name, user_json, tags_json, breadcrumbs_json, extra_json, sdk
    ) VALUES (
      @id, @issue_id, @project_id, @timestamp, @level, @message, @type, @stack, @url,
      @environment, @release_name, @user_json, @tags_json, @breadcrumbs_json, @extra_json, @sdk
    )
  `),
  distinctUsers: db.prepare(`
    SELECT COUNT(DISTINCT json_extract(user_json, '$.id')) AS n
    FROM events
    WHERE issue_id = ? AND json_extract(user_json, '$.id') IS NOT NULL
  `),
  setUserCount: db.prepare('UPDATE issues SET user_count = ? WHERE id = ?'),
  getIssue: db.prepare(`
    SELECT i.*, p.notify_email, p.name AS project_name
    FROM issues i
    JOIN projects p ON p.id = i.project_id
    WHERE i.id = ?
  `),
  listEvents: db.prepare('SELECT * FROM events WHERE issue_id = ? ORDER BY timestamp DESC LIMIT ?'),
  updateStatus: db.prepare('UPDATE issues SET status = ? WHERE id = ?'),
  setAgentStatus: db.prepare('UPDATE issues SET agent_status = ? WHERE id = ?'),
  saveAgent: db.prepare(`
    UPDATE issues
    SET agent_status = @status,
        agent_summary = @summary,
        agent_solution = @solution,
        pr_url = CASE WHEN @prUrl != '' THEN @prUrl ELSE pr_url END,
        pr_merged = CASE WHEN @prUrl != '' THEN 0 ELSE pr_merged END,
        pr_closed = CASE WHEN @prUrl != '' THEN 0 ELSE pr_closed END,
        status = CASE WHEN @prUrl != '' THEN 'resolved' ELSE status END,
        emailed_at = @emailedAt,
        emailed_to = @emailedTo
    WHERE id = @id
  `),
  applyPullState: db.prepare(`
    UPDATE issues
    SET pr_merged = @merged,
        pr_closed = @closed,
        status = CASE WHEN @merged = 1 AND status = 'open' THEN 'resolved' ELSE status END
    WHERE id = @id
  `),
};

export function setAgentStatus(id, status) {
  stmts.setAgentStatus.run(status, id);
  return stmts.getIssue.get(id);
}

export function saveAgentResult(id, { status, summary, solution, prUrl, emailedAt, emailedTo }) {
  stmts.saveAgent.run({
    id,
    status: status || 'done',
    summary: summary || '',
    solution: solution || '',
    prUrl: prUrl || '',
    emailedAt: emailedAt || null,
    emailedTo: emailedTo || '',
  });
  return stmts.getIssue.get(id);
}

export function normalizeNotifyEmail(value) {
  const emails = String(value || '')
    .split(/[,;\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
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
  return {
    id: project.id,
    name: project.name,
    public_key: project.public_key,
    created_at: project.created_at,
    notify_email: project.notify_email || '',
    github_repo: project.github_repo || '',
    github_base_branch: project.github_base_branch || '',
    github_connected: Boolean(project.github_token && project.github_repo),
    send_email_enabled: Boolean(project.send_email_enabled),
    company_id: project.company_id || null,
  };
}

export function listProjects(scope = { all: true }) {
  if (scope.all) return stmts.listProjects.all().map(serializeProject);
  if (!scope.projectIds?.length) return [];
  return db.prepare(`
    SELECT * FROM projects
    WHERE id IN (${scope.projectIds.map(() => '?').join(',')})
    ORDER BY created_at DESC
  `).all(...scope.projectIds).map(serializeProject);
}

export function listGithubProjects() {
  return stmts.listProjects.all().filter((project) => project.github_token && project.github_repo);
}

export function createProject(name, notifyEmail, companyId = null) {
  const project = {
    id: nanoid(),
    name: String(name || 'New project').trim().slice(0, 80) || 'New project',
    public_key: `pk_live_${nanoid(18)}`,
    created_at: new Date().toISOString(),
    notify_email: normalizeNotifyEmail(notifyEmail) || '',
    company_id: companyId || null,
  };
  stmts.insertProject.run(project.id, project.name, project.public_key, project.created_at, project.notify_email, project.company_id);
  return serializeProject(project);
}

export function getProject(id) {
  return stmts.projectById.get(id) || null;
}

export function getProjectByKey(publicKey) {
  return stmts.projectByKey.get(publicKey) || null;
}

export function saveClientSettings(publicKey, input = {}) {
  const project = stmts.projectByKey.get(publicKey);
  if (!project) {
    const err = new Error('Unknown project key');
    err.statusCode = 401;
    throw err;
  }
  const nextName = input.name ? String(input.name).trim().slice(0, 80) || project.name : project.name;
  let nextEmail = project.notify_email || '';
  if (input.notifyEmail != null && String(input.notifyEmail).trim() !== '') {
    nextEmail = normalizeNotifyEmail(input.notifyEmail);
    if (!nextEmail) {
      const err = new Error('Client PR email is invalid. Set PULSE_NOTIFY_EMAIL in the client app.');
      err.statusCode = 400;
      throw err;
    }
  }
  const nextToken = input.githubToken != null && String(input.githubToken).trim() !== ''
    ? String(input.githubToken).trim()
    : project.github_token || '';
  const nextRepo = normalizeGithubRepo(
    input.githubRepo != null && String(input.githubRepo).trim() !== ''
      ? input.githubRepo
      : project.github_repo || '',
  );
  const nextBranch = input.githubBaseBranch != null && String(input.githubBaseBranch).trim() !== ''
    ? String(input.githubBaseBranch).trim()
    : project.github_base_branch || '';
  if (nextRepo && !nextRepo.includes('/')) {
    const err = new Error('GITHUB_REPO must be owner/name or a github.com URL');
    err.statusCode = 400;
    throw err;
  }
  let nextSend = project.send_email_enabled ? 1 : 0;
  const parsedSend = parseBoolFlag(input.isEnabledSendEmail ?? input.sendEmailEnabled ?? input.send_email_enabled);
  if (parsedSend != null) nextSend = parsedSend ? 1 : 0;
  stmts.updateClientSettings.run(nextName, nextEmail, nextToken, nextRepo, nextBranch, nextSend, project.id);
  return stmts.projectById.get(project.id);
}

export function updateProject(id, { name, notifyEmail } = {}) {
  const project = stmts.projectById.get(id);
  if (!project) return null;
  const nextName = name != null ? (String(name).trim().slice(0, 80) || project.name) : project.name;
  let nextEmail = project.notify_email || '';
  if (notifyEmail != null) {
    nextEmail = normalizeNotifyEmail(notifyEmail);
    if (!nextEmail) {
      const err = new Error('Enter a valid email for PR alerts');
      err.statusCode = 400;
      throw err;
    }
  }
  stmts.updateProject.run(nextName, nextEmail, id);
  return serializeProject(stmts.projectById.get(id));
}

function resolveFinishedFixes() {
  db.prepare(`
    UPDATE issues
    SET status = 'resolved'
    WHERE status = 'open'
      AND agent_status = 'done'
      AND pr_url IS NOT NULL
      AND trim(pr_url) != ''
  `).run();
}

export function applyPullStates(pulls = []) {
  const byUrl = new Map(
    pulls
      .filter((pull) => pull?.url)
      .map((pull) => [String(pull.url).replace(/\/$/, ''), pull]),
  );
  const issues = db.prepare(`
    SELECT id, pr_url FROM issues
    WHERE pr_url IS NOT NULL AND trim(pr_url) != ''
  `).all();
  for (const issue of issues) {
    const hit = byUrl.get(String(issue.pr_url).replace(/\/$/, ''));
    if (!hit) continue;
    stmts.applyPullState.run({
      id: issue.id,
      merged: hit.merged ? 1 : 0,
      closed: hit.closed || hit.merged ? 1 : 0,
    });
  }
  db.prepare(`
    UPDATE issues
    SET status = 'resolved',
        pr_closed = CASE WHEN pr_merged = 1 THEN 1 ELSE pr_closed END
    WHERE status = 'open'
      AND (
        pr_merged = 1
        OR (agent_status = 'done' AND pr_url IS NOT NULL AND trim(pr_url) != '')
      )
  `).run();
}

export function listIssues({ projectId, projectIds, status, environment, q, limit = 80 } = {}) {
  resolveFinishedFixes();
  const clauses = [];
  const params = [];
  if (projectId) {
    clauses.push('i.project_id = ?');
    params.push(projectId);
  } else if (projectIds) {
    if (!projectIds.length) return [];
    clauses.push(`i.project_id IN (${projectIds.map(() => '?').join(',')})`);
    params.push(...projectIds);
  }
  if (status === 'fixed' || status === 'resolved') {
    clauses.push("i.agent_status = 'done' AND i.pr_url IS NOT NULL AND trim(i.pr_url) != ''");
  } else if (status === 'create-pull') {
    clauses.push("i.pr_url IS NOT NULL AND trim(i.pr_url) != '' AND IFNULL(i.pr_merged, 0) = 0 AND IFNULL(i.pr_closed, 0) = 0");
  } else if (status === 'merge-pull') {
    clauses.push('i.pr_merged = 1');
  } else if (status === 'closed-pull') {
    clauses.push('IFNULL(i.pr_closed, 0) = 1');
  } else if (status === 'open') {
    clauses.push("i.status = 'open'");
    clauses.push("NOT (i.agent_status = 'done' AND i.pr_url IS NOT NULL AND trim(i.pr_url) != '')");
  } else if (status === 'performance') {
    clauses.push(`(
      lower(i.title) LIKE '%timeout%' OR lower(i.title) LIKE '%slow%' OR lower(i.title) LIKE '%latency%'
      OR lower(i.title) LIKE '%performance%' OR lower(i.culprit) LIKE '%timeout%'
    )`);
  } else if (status === 'memory-leak') {
    clauses.push(`(
      lower(i.title) LIKE '%memory%' OR lower(i.title) LIKE '%heap%' OR lower(i.title) LIKE '%leak%'
      OR lower(i.title) LIKE '%oom%'
    )`);
  } else if (status && status !== 'all') {
    clauses.push('i.status = ?');
    params.push(status);
  }
  if (q) {
    clauses.push('(i.title LIKE ? OR i.culprit LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (environment) {
    clauses.push(`EXISTS (SELECT 1 FROM events e WHERE e.issue_id = i.id AND e.environment = ?)`);
    params.push(environment);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT i.*
    FROM issues i
    ${where}
    ORDER BY i.last_seen DESC
    LIMIT ?
  `).all(...params, Math.min(Number(limit) || 80, 200));
}

export function getIssue(id) {
  const issue = stmts.getIssue.get(id);
  if (!issue) return null;
  const events = stmts.listEvents.all(id, 40).map(serializeEvent);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const hourly = db.prepare(`
    SELECT strftime('%Y-%m-%dT%H:00:00.000Z', timestamp) AS hour, COUNT(*) AS count
    FROM events
    WHERE issue_id = ? AND timestamp >= ?
    GROUP BY hour
    ORDER BY hour
  `).all(id, since);
  return { ...issue, events, hourly };
}

export function setIssueStatus(id, status) {
  if (!['open', 'resolved', 'ignored'].includes(status)) return null;
  stmts.updateStatus.run(status, id);
  return stmts.getIssue.get(id);
}

export function stats(projectId, projectIds) {
  resolveFinishedFixes();
  if (projectIds && !projectIds.length) {
    return {
      openIssues: 0,
      fixedIssues: 0,
      createPull: 0,
      mergePull: 0,
      closedPull: 0,
      events24h: 0,
      users24h: 0,
      series: [],
      byLevel: [],
    };
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let scope = '';
  let eventScope = '';
  let scopeParams = [];
  let eventParams = [since];
  if (projectId) {
    scope = 'AND project_id = ?';
    eventScope = 'AND project_id = ?';
    scopeParams = [projectId];
    eventParams = [since, projectId];
  } else if (projectIds) {
    const holes = projectIds.map(() => '?').join(',');
    scope = `AND project_id IN (${holes})`;
    eventScope = `AND project_id IN (${holes})`;
    scopeParams = projectIds;
    eventParams = [since, ...projectIds];
  }
  const open = db.prepare(`
    SELECT COUNT(*) AS n FROM issues
    WHERE status = 'open'
      AND NOT (agent_status = 'done' AND pr_url IS NOT NULL AND trim(pr_url) != '')
      ${scope}
  `).get(...scopeParams);
  const fixed = db.prepare(`
    SELECT COUNT(*) AS n FROM issues
    WHERE agent_status = 'done' AND pr_url IS NOT NULL AND trim(pr_url) != '' ${scope}
  `).get(...scopeParams);
  const createPull = db.prepare(`
    SELECT COUNT(*) AS n FROM issues
    WHERE pr_url IS NOT NULL AND trim(pr_url) != '' AND IFNULL(pr_merged, 0) = 0 AND IFNULL(pr_closed, 0) = 0 ${scope}
  `).get(...scopeParams);
  const mergePull = db.prepare(`SELECT COUNT(*) AS n FROM issues WHERE pr_merged = 1 ${scope}`).get(...scopeParams);
  const closedPull = db.prepare(`SELECT COUNT(*) AS n FROM issues WHERE IFNULL(pr_closed, 0) = 1 ${scope}`).get(...scopeParams);
  const events24h = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE timestamp >= ? ${eventScope}`).get(...eventParams);
  const users24h = db.prepare(`
    SELECT COUNT(DISTINCT json_extract(user_json, '$.id')) AS n
    FROM events
    WHERE timestamp >= ? AND json_extract(user_json, '$.id') IS NOT NULL ${eventScope}
  `).get(...eventParams);
  const series = db.prepare(`
    SELECT strftime('%Y-%m-%dT%H:00:00.000Z', timestamp) AS hour, COUNT(*) AS count
    FROM events
    WHERE timestamp >= ? ${eventScope}
    GROUP BY hour
    ORDER BY hour
  `).all(...eventParams);
  const byLevel = db.prepare(`
    SELECT level, COUNT(*) AS count
    FROM issues
    WHERE status = 'open'
      AND NOT (agent_status = 'done' AND pr_url IS NOT NULL AND trim(pr_url) != '')
      ${scope}
    GROUP BY level
  `).all(...scopeParams);
  return {
    openIssues: open.n,
    fixedIssues: fixed.n,
    createPull: createPull.n,
    mergePull: mergePull.n,
    closedPull: closedPull.n,
    events24h: events24h.n,
    users24h: users24h.n,
    series,
    byLevel,
  };
}

export function ingestEvent(publicKey, rawBody) {
  const project = stmts.projectByKey.get(publicKey);
  if (!project) {
    const err = new Error('Unknown project key');
    err.statusCode = 401;
    throw err;
  }
  const parsed = ingestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const err = new Error(parsed.error.issues[0]?.message || 'Invalid event');
    err.statusCode = 400;
    throw err;
  }
  const body = parsed.data;
  const seen = body.timestamp || new Date().toISOString();
  const type = body.type || 'Error';
  const level = body.level || 'error';
  const fingerprint = fingerprintEvent({ type, message: body.message, stack: body.stack });
  const culprit = culpritFromStack(body.stack);
  const title = `${type}: ${body.message}`.slice(0, 240);
  const userId = body.user?.id ? 1 : 0;

  const result = db.transaction(() => {
    let isNew = false;
    let reopened = false;
    let issue = stmts.findIssue.get(project.id, fingerprint);
    if (!issue) {
      isNew = true;
      issue = {
        id: nanoid(),
        project_id: project.id,
        fingerprint,
        title,
        culprit,
        type,
        level,
        status: 'open',
        count: 1,
        user_count: userId,
        first_seen: seen,
        last_seen: seen,
      };
      stmts.insertIssue.run({
        id: issue.id,
        project_id: project.id,
        fingerprint,
        title,
        culprit,
        type,
        level,
        user_count: userId,
        seen,
      });
    } else {
      reopened = issue.status === 'resolved';
      stmts.bumpIssue.run({ id: issue.id, seen, level, title, culprit });
    }

    const event = {
      id: nanoid(),
      issue_id: issue.id,
      project_id: project.id,
      timestamp: seen,
      level,
      message: body.message,
      type,
      stack: body.stack || '',
      url: body.url || '',
      environment: body.environment || 'production',
      release_name: body.release || '',
      user_json: JSON.stringify(body.user || {}),
      tags_json: JSON.stringify(body.tags || {}),
      breadcrumbs_json: JSON.stringify(body.breadcrumbs || []),
      extra_json: JSON.stringify(body.extra || {}),
      sdk: body.sdk || '@pulse/sdk',
    };
    stmts.insertEvent.run(event);
    const users = stmts.distinctUsers.get(issue.id);
    stmts.setUserCount.run(users.n, issue.id);
    const updated = stmts.getIssue.get(issue.id);
    return { project, issue: updated, event: serializeEvent(event), isNew, reopened };
  })();

  return result;
}

function serializeEvent(event) {
  const parse = (value, fallback) => {
    try {
      return JSON.parse(value || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  };
  return {
    ...event,
    user: parse(event.user_json, {}),
    tags: parse(event.tags_json, {}),
    breadcrumbs: parse(event.breadcrumbs_json, []),
    extra: parse(event.extra_json, {}),
    release: event.release_name,
  };
}
