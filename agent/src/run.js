import path from 'node:path';
import { adviseSecretIssue, analyzeWithGemini, isRetryableAi, reviewFixWithGemini } from './gemini.js';
import { createFixPullRequest, gatherGithubContext, loadRelatedTestFiles } from './github.js';
import { emailFixReport, resolveNotifyEmail } from './mailer.js';
import { applyAiFilePatch, fallbackIssueFix, githubAlreadyHasFix } from './source.js';
import { presentIssue } from './clientView.js';
import {
  assertSafeCommitFiles,
  defaultSecretGuidance,
  formatSecretGuidance,
  isSecretPath,
  maskContextFile,
  safePatchedContents,
} from './secrets.js';
import { formatTestSummary, remainingCrashSignatures, syntaxCheckFiles } from './verify.js';

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
  const allowed = new Map((contextFiles || []).filter((file) => file?.path && !isSecretPath(file.path)).map((file) => [file.path, file]));
  const out = [];
  for (const file of Array.isArray(aiFiles) ? aiFiles : []) {
    const requested = normalizePath(file?.path);
    if (!requested || requested.includes('..') || requested.startsWith('pulse/incidents/') || isSecretPath(requested)) continue;
    let target = allowed.has(requested) ? requested : null;
    if (!target) {
      const base = path.posix.basename(requested);
      target = [...allowed.keys()].find((item) => item === requested || item.endsWith(`/${base}`)) || null;
    }
    if (!target) continue;
    const context = allowed.get(target);
    const masked = maskContextFile(context);
    if (!masked) continue;
    const localPatched = applyAiFilePatch(masked.contents, file);
    const githubPatched = applyAiFilePatch(masked.githubContents || masked.contents, file);
    const nextLocal = localPatched
      ? safePatchedContents({
        original: context.contents,
        maskedOriginal: masked.contents,
        patchedMasked: localPatched,
        secrets: masked._secrets.contents,
      })
      : null;
    const nextGithub = githubPatched
      ? safePatchedContents({
        original: context.githubContents || context.contents,
        maskedOriginal: masked.githubContents || masked.contents,
        patchedMasked: githubPatched,
        secrets: masked._secrets.githubContents,
      })
      : null;
    if (!nextLocal && !nextGithub) continue;
    if (out.some((item) => item.path === target)) continue;
    out.push({
      path: target,
      contents: nextLocal || context.contents,
      githubContents: nextGithub || nextLocal || context.githubContents || context.contents,
    });
  }
  return assertSafeCommitFiles(out);
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
    secretGuidance: [],
  };
}

function attachSecretGuidance(analysis, secretFiles, issue) {
  const files = secretFiles || [];
  if (!files.length && !(analysis?.secretGuidance || []).length) return analysis;
  const guidance = (analysis?.secretGuidance || []).length
    ? analysis.secretGuidance
    : defaultSecretGuidance(files, issue);
  const formatted = formatSecretGuidance(guidance);
  return {
    ...analysis,
    secretGuidance: guidance,
    solution: [analysis.solution, formatted].filter(Boolean).join('\n\n'),
  };
}

export function isSecretOnlyIssue(scan) {
  return Boolean((scan?.github?.secretFiles || []).length) && !(scan?.github?.files || []).length;
}

export function canContinueToFix(scan) {
  return Boolean(scan?.github?.ok && scan.github.files?.length);
}

export function canContinueToPr(test) {
  return Boolean(test?.ok && test.files?.length);
}

async function runFixTests({ issue, event, files, analysis, github, githubConfig }) {
  const checks = [];
  const syntaxFailures = syntaxCheckFiles(files);
  if (syntaxFailures.length) {
    return {
      ok: false,
      reason: `Syntax check failed in ${syntaxFailures.map((item) => item.path).join(', ')}: ${syntaxFailures[0].detail}`,
      checks,
    };
  }
  checks.push('syntax');

  const leftovers = remainingCrashSignatures(issue, files);
  if (leftovers.length) {
    return {
      ok: false,
      reason: leftovers.join('; '),
      checks,
    };
  }
  checks.push('crash signature');

  let testFiles = [];
  try {
    testFiles = await loadRelatedTestFiles(githubConfig || github, (files || []).map((file) => file.path));
    if (testFiles.length) checks.push(`${testFiles.length} related test file${testFiles.length === 1 ? '' : 's'}`);
  } catch {
    testFiles = [];
  }

  const review = await reviewFixWithGemini({
    issue,
    event,
    patchedFiles: files,
    testFiles,
    repo: github?.repoFull,
    base: github?.base,
  });
  if (!review.ok) {
    return {
      ok: false,
      reason: review.reason || 'AI review rejected this patch.',
      checks,
    };
  }
  checks.push(review.skipped ? 'AI review skipped' : 'AI review');
  return { ok: true, reason: review.reason || '', checks };
}

export async function testFix({ issue, event, files, analysis, github, githubConfig, agentError, logger }) {
  let currentFiles = files || [];
  let currentAnalysis = { ...analysis };
  let lastReport = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    lastReport = await runFixTests({
      issue,
      event,
      files: currentFiles,
      analysis: currentAnalysis,
      github,
      githubConfig,
    });
    if (lastReport.ok) {
      const summary = formatTestSummary(lastReport);
      return {
        ok: true,
        files: currentFiles,
        analysis: {
          ...currentAnalysis,
          solution: [currentAnalysis.solution, summary].filter(Boolean).join('\n\n'),
          prBody: [currentAnalysis.prBody, summary].filter(Boolean).join('\n\n'),
        },
        agentError,
        tests: lastReport,
      };
    }
    if (attempt === 1 || !github?.ok || !github.files?.length) break;
    logger?.warn?.({ reason: lastReport.reason }, 'Pulse fix failed tests; retrying analysis');
    try {
      const retryIssue = {
        ...issue,
        title: `${issue.title}\n\nPrevious patch failed tests: ${lastReport.reason}`,
      };
      const retryFiles = github.files.map((file) => {
        const patched = currentFiles.find((item) => item.path === file.path);
        return patched
          ? { ...file, contents: patched.contents, githubContents: patched.githubContents || patched.contents }
          : file;
      });
      const retryAnalysis = await analyzeWithGemini({
        issue: retryIssue,
        event,
        contextFiles: retryFiles,
        repo: github.repoFull,
        base: github.base,
        secretFiles: github.secretFiles || [],
      });
      const nextFix = await fixIssue({
        issue,
        analysis: {
          ...currentAnalysis,
          ...retryAnalysis,
          secretGuidance: retryAnalysis.secretGuidance?.length
            ? retryAnalysis.secretGuidance
            : currentAnalysis.secretGuidance,
        },
        github,
        agentError: '',
      });
      if (!nextFix.files.length) break;
      currentFiles = nextFix.files;
      currentAnalysis = nextFix.analysis;
    } catch (error) {
      logger?.error?.({ err: error }, 'Pulse fix retry after tests failed');
      break;
    }
  }

  const reason = lastReport?.reason || 'Fix failed tests; pull request was not opened.';
  return {
    ok: false,
    files: currentFiles,
    analysis: {
      ...currentAnalysis,
      solution: [currentAnalysis.solution, formatTestSummary(lastReport)].filter(Boolean).join('\n\n'),
    },
    agentError: reason,
    tests: lastReport,
  };
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
  let github = { ok: false, files: [], secretFiles: [], reason: '', unmatchedReason: '', repoFull: '', base: '' };
  let githubConfig = clientGithub(owner);

  try {
    const loaded = await loadGithubContext({ issue: current, event, project: owner });
    github = { secretFiles: [], ...loaded.github };
    githubConfig = loaded.githubConfig;
    const secretFiles = github.secretFiles || [];
    const secretOnly = secretFiles.length && !github.files?.length;
    if (secretOnly) {
      try {
        analysis = {
          ...analysis,
          ...(await adviseSecretIssue({ issue, event, secretFiles })),
        };
      } catch (error) {
        analysis = {
          ...analysis,
          summary: `This crash involves secret files (${secretFiles.join(', ')}). Pulse cannot read or patch them.`,
          rootCause: issue.title,
          solution: 'Update these secret files locally and keep them out of git.',
          secretGuidance: defaultSecretGuidance(secretFiles, issue),
        };
        logger?.error?.({ err: error }, 'Pulse secret-file analysis failed');
      }
      analysis = attachSecretGuidance(analysis, secretFiles, issue);
    } else if (!github.ok) {
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
            secretFiles,
          })),
        };
        analysis = attachSecretGuidance(analysis, secretFiles, issue);
      } catch (error) {
        agentError = error.message || 'AI analysis failed';
        analysis = {
          ...analysis,
          summary: isRetryableAi(error)
            ? 'The AI model is busy. Click Run AI fix to try again.'
            : 'Gemini could not complete the analysis.',
          rootCause: issue.title,
          solution: isRetryableAi(error)
            ? 'Click Run AI fix to retry when the model is available.'
            : 'Review the stack trace on the client base branch and re-run the agent after the model is available.',
        };
        analysis = attachSecretGuidance(analysis, secretFiles, issue);
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
    if (!files.length) {
      files = assertSafeCommitFiles(
        fallbackIssueFix(issue, github.files.filter((file) => !isSecretPath(file.path)), analysis),
      );
    }
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
        analysis.prBody || analysis.summary || analysis.rootCause,
        '',
        formatSecretGuidance(analysis.secretGuidance),
        '',
        `Tracked issue: ${issue.id}`,
        `Base branch: ${github?.base || ''}`,
        `Repo: ${github?.repoFull || ''}`,
        event.url ? `Error URL: ${event.url}` : '',
        analysis.prBody && /Tests passed/.test(analysis.prBody) ? '' : 'Tests passed before this pull request was opened.',
        '',
        'Client secrets, private keys, and passwords are never sent to the model.',
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

export async function finalizeAgent({ issue, event, analysis, prUrl, agentError, project, store, io, logger, secretAlert = false }) {
  const persistence = requireStore(store);
  const current = persistence.getIssue(issue.id) || issue;
  const owner = project || persistence.getProject?.(current.project_id);
  const mailTo = resolveNotifyEmail(owner, current);
  let emailedAt = null;
  let emailedTo = '';
  let nextError = secretAlert ? '' : agentError;
  const secretGuidance = analysis?.secretGuidance || [];
  const failed = Boolean(nextError) && !prUrl && !secretAlert;

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

  try {
    const secretTitle = secretGuidance.map((item) => item.path).filter(Boolean).join(', ') || 'secret files';
    const note = secretAlert || secretGuidance.length
      ? persistence.createAdminNotification?.({
        companyId: owner?.company_id,
        projectId: owner?.id || current.project_id,
        issueId: issue.id,
        title: prUrl
          ? `Fix PR opened; update ${secretTitle} locally`
          : `Secret file issue: ${secretTitle}`,
        message: [
          analysis.summary,
          analysis.rootCause,
          formatSecretGuidance(secretGuidance) || analysis.solution,
          nextError,
        ].filter(Boolean).join('\n\n'),
      })
      : nextError
        ? persistence.createAdminNotification?.({
          companyId: owner?.company_id,
          projectId: owner?.id || current.project_id,
          issueId: issue.id,
          title: current.title || issue.title || 'AI agent error',
          message: nextError,
        })
        : null;
    if (note) io?.to('platform').emit('pulse:notification', note);
  } catch (error) {
    logger?.error?.({ err: error }, 'Pulse admin notification failed');
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
  if (isSecretOnlyIssue(scan)) {
    return finalizeAgent({
      issue: current,
      event,
      analysis: scan.analysis,
      prUrl: '',
      agentError: '',
      project: scan.owner,
      store: persistence,
      io,
      logger,
      secretAlert: true,
    });
  }
  const fix = await fixIssue({
    issue: current,
    analysis: scan.analysis,
    github: scan.github,
    agentError: scan.agentError,
  });
  if (!fix.files.length) {
    return finalizeAgent({
      issue: current,
      event,
      analysis: fix.analysis,
      prUrl: '',
      agentError: fix.agentError,
      project: scan.owner,
      store: persistence,
      io,
      logger,
    });
  }
  const tested = await testFix({
    issue: current,
    event,
    files: fix.files,
    analysis: fix.analysis,
    github: scan.github,
    githubConfig: scan.githubConfig,
    agentError: fix.agentError,
    logger,
  });
  if (!tested.ok) {
    return finalizeAgent({
      issue: current,
      event,
      analysis: tested.analysis,
      prUrl: '',
      agentError: tested.agentError,
      project: scan.owner,
      store: persistence,
      io,
      logger,
    });
  }
  const pr = await makeFixPr({
    issue: current,
    event,
    github: scan.github,
    githubConfig: scan.githubConfig,
    files: tested.files,
    analysis: tested.analysis,
    agentError: tested.agentError,
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
