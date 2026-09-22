import path from 'node:path';
import { analyzeWithGemini } from './gemini.js';
import { createFixPullRequest, gatherGithubContext } from './github.js';
import { emailFixReport, resolveNotifyEmail } from './mailer.js';
import { applyAiFilePatch, fallbackIssueFix, githubAlreadyHasFix } from './source.js';
import { presentIssue } from './clientView.js';

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function fixedIssueName(title) {
  const slug = String(title || 'issue')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'issue';
  return `fixed/${slug}`;
}

function selectPatchedFiles(aiFiles, contextFiles) {
  const allowed = new Map(contextFiles.map((file) => [file.path, file]));
  const out = [];
  for (const file of Array.isArray(aiFiles) ? aiFiles : []) {
    const requested = normalizePath(file?.path);
    if (!requested || requested.includes('..') || requested.startsWith('pulse/incidents/')) continue;
    let target = allowed.has(requested) ? requested : null;
    if (!target) {
      const base = path.posix.basename(requested);
      target = [...allowed.keys()].find((item) => item === requested || item.endsWith(`/${base}`)) || null;
    }
    if (!target) continue;
    const context = allowed.get(target);
    const localPatched = applyAiFilePatch(context.contents, file);
    const githubPatched = applyAiFilePatch(context.githubContents || context.contents, file);
    const nextLocal = localPatched || (githubPatched && context.contents === (context.githubContents || context.contents) ? githubPatched : null);
    if (!nextLocal && !githubPatched) continue;
    if (out.some((item) => item.path === target)) continue;
    out.push({
      path: target,
      contents: nextLocal || context.contents,
      githubContents: githubPatched || nextLocal || context.githubContents || context.contents,
    });
  }
  return out;
}

function requireStore(store) {
  if (!store?.getIssue || !store?.saveAgentResult || !store?.setAgentStatus) {
    throw new Error('Pulse agent requires a store adapter from the API');
  }
  return store;
}

function clientGithub(project) {
  return {
    githubToken: project?.github_token,
    githubRepo: project?.github_repo,
    githubBaseBranch: project?.github_base_branch,
  };
}

function emitIssue(io, issue, project) {
  if (!io) return;
  io.to('platform').emit('pulse:issue', presentIssue(issue, { admin: true }));
  if (project?.company_id) {
    io.to(`company:${project.company_id}`).emit('pulse:issue', presentIssue(issue, { admin: false }));
  }
}

function defaultAnalysis(issue) {
  return {
    summary: '',
    rootCause: '',
    solution: '',
    prTitle: fixedIssueName(issue.title),
    prBody: '',
  };
}

export function canContinueToFix(scan) {
  return Boolean(scan?.github?.ok && scan.github.files?.length);
}

export async function loadGithubContext({ issue, event, project }) {
  const githubConfig = clientGithub(project);
  const github = await gatherGithubContext({
    stack: event?.stack,
    culprit: issue.culprit,
    release: event?.release || event?.release_name,
    extra: event?.extra,
    url: event?.url,
    github: githubConfig,
  });
  return { github, githubConfig };
}

export async function scanIssue({ issue, event, project, logger, store }) {
  const persistence = requireStore(store);
  const current = persistence.getIssue(issue.id) || issue;
  const owner = project || persistence.getProject?.(current.project_id);
  let analysis = defaultAnalysis(issue);
  let agentError = '';
  let github = { ok: false, files: [], reason: '', unmatchedReason: '', repoFull: '', base: '' };
  let githubConfig = clientGithub(owner);

  try {
    const loaded = await loadGithubContext({ issue: current, event, project: owner });
    github = loaded.github;
    githubConfig = loaded.githubConfig;
    if (!github.ok) {
      agentError = github.reason || 'Client GitHub is not connected';
    } else if (!github.files.length) {
      agentError = github.unmatchedReason || 'Could not match this stack to client source files.';
    } else {
      try {
        analysis = {
          ...analysis,
          ...(await analyzeWithGemini({
            issue,
            event,
            contextFiles: github.files,
            repo: github.repoFull,
            base: github.base,
          })),
        };
      } catch (error) {
        agentError = error.message || 'AI analysis failed';
        analysis = {
          ...analysis,
          summary: `Gemini could not complete the analysis: ${agentError}`,
          rootCause: issue.title,
          solution: 'Review the stack trace on the client base branch and re-run the agent after the model is available.',
        };
        logger?.error?.({ err: error }, 'Pulse AI analysis failed');
      }
    }
  } catch (error) {
    agentError = error.message || 'AI agent failed';
    logger?.error?.({ err: error }, 'Pulse AI scan failed');
  }

  return { analysis, github, githubConfig, agentError, current, owner };
}

export async function fixIssue({ issue, analysis, github, agentError }) {
  let files = [];
  let nextAnalysis = { ...analysis };
  let nextError = agentError;
  if (github?.ok && github.files?.length) {
    files = selectPatchedFiles(analysis.files, github.files);
    if (!files.length) files = fallbackIssueFix(issue, github.files, analysis);
    if (!files.length && githubAlreadyHasFix(issue, github.files, analysis)) {
      nextError = '';
      nextAnalysis.solution = [
        nextAnalysis.solution,
        'GitHub base already has the same code, so no new PR diff was created.',
      ].filter(Boolean).join('\n\n');
    } else if (!files.length) {
      nextError = nextError || 'AI did not return a safe patch against the client source files.';
    }
  }
  return { files, analysis: nextAnalysis, agentError: nextError };
}

export async function makeFixPr({ issue, event, github, githubConfig, files, analysis, agentError }) {
  let prUrl = '';
  let nextAnalysis = { ...analysis };
  let nextError = agentError;
  if (files?.length) {
    const prName = fixedIssueName(issue.title);
    const pr = await createFixPullRequest({
      github: githubConfig,
      target: github?.ok && github?.octokit ? github : null,
      branch: prName,
      title: prName,
      body: [
        analysis.prBody || analysis.solution || analysis.summary,
        '',
        `Tracked issue: ${issue.id}`,
        `Base branch: ${github?.base || ''}`,
        `Repo: ${github?.repoFull || ''}`,
        event.url ? `Error URL: ${event.url}` : '',
        '',
        'This PR changes only the crashing snippet on the client base-branch files.',
      ].filter(Boolean).join('\n'),
      files,
    });
    if (pr.ok && pr.url) prUrl = pr.url;
    else if (pr.unchanged) {
      nextAnalysis.solution = [
        nextAnalysis.solution,
        'GitHub base already has the same code, so no new PR diff was created.',
      ].filter(Boolean).join('\n\n');
    } else nextError = pr.reason || 'GitHub PR failed';
  }
  return { prUrl, analysis: nextAnalysis, agentError: nextError };
}

export async function finalizeAgent({ issue, event, analysis, prUrl, agentError, project, store, io, logger }) {
  const persistence = requireStore(store);
  const current = persistence.getIssue(issue.id) || issue;
  const owner = project || persistence.getProject?.(current.project_id);
  const mailTo = resolveNotifyEmail(owner, current);
  let emailedAt = null;
  let emailedTo = '';
  let nextError = agentError;
  const failed = Boolean(nextError) && !prUrl;

  if (!failed) {
    try {
      const mailed = await emailFixReport({
        issue: { ...current, project_name: owner?.name || current.project_name },
        event,
        analysis,
        prUrl,
        error: '',
        to: mailTo,
        project: owner,
      });
      if (mailed.ok && !mailed.skipped) {
        emailedAt = new Date().toISOString();
        emailedTo = mailed.to;
      } else if (!mailed.ok && !nextError) nextError = mailed.reason;
    } catch (error) {
      nextError = [nextError, error.message].filter(Boolean).join(' · ');
      logger?.error?.({ err: error }, 'Pulse AI fix email failed');
    }
  }

  const saved = persistence.saveAgentResult(issue.id, {
    status: failed ? 'failed' : 'done',
    summary: analysis.summary || analysis.rootCause || '',
    solution: [analysis.rootCause, analysis.solution].filter(Boolean).join('\n\n'),
    prUrl,
    emailedAt,
    emailedTo,
    agentError: nextError || '',
  });

  if (nextError) {
    try {
      const note = persistence.createAdminNotification?.({
        companyId: owner?.company_id,
        projectId: owner?.id || current.project_id,
        issueId: issue.id,
        title: current.title || issue.title || 'AI agent error',
        message: nextError,
      });
      if (note) io?.to('platform').emit('pulse:notification', note);
    } catch (error) {
      logger?.error?.({ err: error }, 'Pulse admin notification failed');
    }
  }

  emitIssue(io, saved, owner);
  return saved;
}

export async function runFixAgent({ issue, event, logger, io, force = false, project = null, store }) {
  const persistence = requireStore(store);
  if (!['error', 'fatal'].includes(issue.level || event.level || 'error')) return null;
  const current = persistence.getIssue(issue.id) || issue;
  const owner = project || persistence.getProject?.(current.project_id);
  if (!force && current.agent_status === 'running') return current;
  if (!force && current.agent_status === 'done' && current.pr_url) return current;

  persistence.setAgentStatus(issue.id, 'running');
  emitIssue(io, { ...current, agent_status: 'running' }, owner);

  const scan = await scanIssue({ issue: current, event, project: owner, logger, store: persistence });
  const fix = await fixIssue({
    issue: current,
    analysis: scan.analysis,
    github: scan.github,
    agentError: scan.agentError,
  });
  const pr = await makeFixPr({
    issue: current,
    event,
    github: scan.github,
    githubConfig: scan.githubConfig,
    files: fix.files,
    analysis: fix.analysis,
    agentError: fix.agentError,
  });
  return finalizeAgent({
    issue: current,
    event,
    analysis: pr.analysis,
    prUrl: pr.prUrl,
    agentError: pr.agentError,
    project: scan.owner,
    store: persistence,
    io,
    logger,
  });
}

export function shouldRunAgent(result) {
  const level = result.event?.level || result.issue?.level;
  if (!['error', 'fatal'].includes(level)) return false;
  if (!result.isNew && !result.reopened) return false;
  if (result.issue?.agent_status === 'running') return false;
  if (result.issue?.agent_status === 'done' && result.issue?.pr_url && !result.reopened) return false;
  return true;
}
