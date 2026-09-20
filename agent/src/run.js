import path from 'node:path';
import { analyzeWithGemini } from './gemini.js';
import { createFixPullRequest, gatherGithubContext } from './github.js';
import { emailFixReport, resolveNotifyEmail } from './mailer.js';
import { applyAiFilePatch, applyLocalFiles, fallbackReferenceErrorFix, findLocalParseErrors, findStackLocalFiles } from './source.js';

function repoRoot() {
  return path.resolve(process.env.REPO_ROOT || path.join(process.cwd(), '..', '..'));
}

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
    if (!localPatched) continue;
    const githubPatched = applyAiFilePatch(context.githubContents || context.contents, file);
    if (out.some((item) => item.path === target)) continue;
    out.push({
      path: target,
      contents: localPatched,
      githubContents: githubPatched || context.githubContents || localPatched,
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

export async function runFixAgent({ issue, event, logger, io, force = false, project = null, store }) {
  const persistence = requireStore(store);
  if (!['error', 'fatal'].includes(issue.level || event.level || 'error')) return null;
  const current = persistence.getIssue(issue.id) || issue;
  const owner = project || persistence.getProject?.(current.project_id);
  const mailTo = resolveNotifyEmail(owner, current);
  if (!force && current.agent_status === 'running') return current;
  if (!force && current.agent_status === 'done' && current.pr_url) return current;

  persistence.setAgentStatus(issue.id, 'running');
  io?.emit('pulse:issue', { ...current, agent_status: 'running' });

  let analysis = {
    summary: '',
    rootCause: '',
    solution: '',
    prTitle: fixedIssueName(issue.title),
    prBody: '',
  };
  let prUrl = '';
  let agentError = '';
  const root = repoRoot();

  try {
    const localFiles = [
      ...findStackLocalFiles(root, {
        stack: event.stack,
        culprit: issue.culprit,
        extra: event.extra,
        release: event.release || event.release_name,
      }),
      ...findLocalParseErrors(root, {
        release: event.release || event.release_name,
        cwd: event.extra?.cwd,
      }),
    ].filter((file, index, all) => all.findIndex((item) => item.path === file.path) === index);
    const github = await gatherGithubContext({
      stack: event.stack,
      culprit: issue.culprit,
      release: event.release || event.release_name,
      extra: event.extra,
      localFiles,
    });
    if (!github.ok) {
      agentError = github.reason || 'GitHub repo is not available';
    } else if (!github.files.length) {
      agentError = 'Could not match this stack to client source files.';
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

      let files = selectPatchedFiles(analysis.files, github.files);
      if (!files.length) files = fallbackReferenceErrorFix(issue, github.files);
      if (files.length) {
        applyLocalFiles(root, files);
        const prName = fixedIssueName(issue.title);
        const pr = await createFixPullRequest({
          branch: prName,
          title: prName,
          body: [
            analysis.prBody || analysis.solution || analysis.summary,
            '',
            `Tracked issue: ${issue.id}`,
            `Base branch: ${github.base}`,
            `Repo: ${github.repoFull}`,
            event.url ? `Error URL: ${event.url}` : '',
            '',
            'This PR changes only the crashing snippet on the client base-branch files.',
          ].filter(Boolean).join('\n'),
          files,
        });
        if (pr.ok && pr.url) prUrl = pr.url;
        else if (pr.unchanged) {
          analysis.solution = [
            analysis.solution,
            'Local crashing file was patched. GitHub base already has the same code, so no new PR diff was created.',
          ].filter(Boolean).join('\n\n');
        } else agentError = pr.reason || 'GitHub PR failed';
      } else {
        agentError = agentError || 'AI did not return a safe patch against the client source files.';
      }
    }
  } catch (error) {
    agentError = error.message || 'AI agent failed';
    logger?.error?.({ err: error }, 'Pulse AI agent failed');
  }

  let emailedAt = null;
  let emailedTo = '';
  try {
    const mailed = await emailFixReport({
      issue: { ...current, project_name: owner?.name || current.project_name },
      event,
      analysis,
      prUrl,
      error: agentError,
      to: mailTo,
    });
    if (mailed.ok && !mailed.skipped) {
      emailedAt = new Date().toISOString();
      emailedTo = mailed.to;
    } else if (!mailed.ok && !agentError) agentError = mailed.reason;
  } catch (error) {
    agentError = [agentError, error.message].filter(Boolean).join(' · ');
  }

  const saved = persistence.saveAgentResult(issue.id, {
    status: agentError && !prUrl && !analysis.summary ? 'failed' : 'done',
    summary: analysis.summary || analysis.rootCause || '',
    solution: [analysis.rootCause, analysis.solution, agentError].filter(Boolean).join('\n\n'),
    prUrl,
    emailedAt,
    emailedTo,
  });
  io?.emit('pulse:issue', saved);
  return saved;
}

export function shouldRunAgent(result) {
  const level = result.event?.level || result.issue?.level;
  if (!['error', 'fatal'].includes(level)) return false;
  if (!result.isNew && !result.reopened) return false;
  if (result.issue?.agent_status === 'running') return false;
  if (result.issue?.agent_status === 'done' && result.issue?.pr_url && !result.reopened) return false;
  return true;
}
