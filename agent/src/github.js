import { createHash } from 'node:crypto';
import { Octokit } from '@octokit/rest';
import { assertSafeCommitFiles, extractSecretStackPaths, isSecretPath, publicSecretLabel } from './secrets.js';

const SOURCE_EXT = /\.(?:js|jsx|ts|tsx|mjs|cjs)$/i;

function normalizeGithubRepo(value) {
  const raw = String(value || '').trim().replace(/\.git$/i, '');
  const hosted = raw.match(/github\.com[:/]+([^/]+)\/([^/#?]+)/i);
  if (hosted) return `${hosted[1]}/${hosted[2]}`;
  return raw.replace(/^\/+|\/+$/g, '');
}

function createClient(github = {}) {
  const token = String(github.githubToken || github.github_token || '').trim();
  const repoFull = normalizeGithubRepo(github.githubRepo || github.github_repo);
  if (!token) return { ok: false, reason: 'Client GitHub token missing. Set GITHUB_TOKEN in the client app.' };
  if (!repoFull.includes('/')) return { ok: false, reason: 'Client GitHub repo missing. Set GITHUB_REPO=owner/name in the client app.' };
  const tokenSource = github.githubToken ? 'githubToken' : 'github_token';
  const tokenFingerprint = createHash('sha256').update(token).digest('hex').slice(0, 12);
  console.log('[Pulse agent] GitHub token diagnostic', {
    repo: repoFull,
    source: tokenSource,
    length: token.length,
    fingerprint: `sha256:${tokenFingerprint}`,
  });
  const [owner, repo] = repoFull.split('/');
  return { ok: true, octokit: new Octokit({ auth: token }), owner, repo, repoFull };
}

function usableBranch(value) {
  const requested = String(value || '').trim();
  return requested && !requested.includes('..') && /^[A-Za-z0-9._/-]+$/.test(requested)
    ? requested
    : '';
}

export function explainGithubWriteError(error, repoFull = '') {
  const status = Number(error?.status || error?.statusCode || 0);
  const repo = repoFull ? ` for ${repoFull}` : '';
  if (status === 401) {
    return `GitHub rejected the token${repo} (401). Replace the project's GitHub token and reconnect the repository.`;
  }
  if (status === 403) {
    return `GitHub denied permission to create the fix${repo} (403). For a fine-grained personal access token, grant access to this exact repository and enable Contents: Read and write and Pull requests: Read and write. For an organization repository, confirm the organization approved the token and any required SSO authorization. Then update the token in the Pulse project and retry the fix.`;
  }
  if (status === 404) {
    return `GitHub could not access the repository or branch${repo} (404). Check the repository name, token repository access, and configured base branch.`;
  }
  return error?.message || 'GitHub could not create the fix pull request.';
}

const repoCache = new Map();

export async function resolveGithubRepo(github = {}) {
  const client = createClient(github);
  if (!client.ok) return client;
  const requested = usableBranch(github.githubBaseBranch || github.github_base_branch);
  const cacheKey = `${client.repoFull}:${requested}:${String(github.githubToken || github.github_token || '').slice(-8)}`;
  const cached = repoCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 45000) return cached.value;
  const { octokit, owner, repo, repoFull } = client;
  const { data: repoData } = await octokit.repos.get({ owner, repo });
  let base = requested || repoData.default_branch;
  let baseRef;
  try {
    ({ data: baseRef } = await octokit.git.getRef({ owner, repo, ref: `heads/${base}` }));
  } catch (error) {
    if (error.status !== 404 || base === repoData.default_branch) throw error;
    base = repoData.default_branch;
    ({ data: baseRef } = await octokit.git.getRef({ owner, repo, ref: `heads/${base}` }));
  }
  const { data: commit } = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: baseRef.object.sha,
  });
  const value = {
    ok: true,
    octokit,
    owner,
    repo,
    repoFull,
    base,
    baseSha: baseRef.object.sha,
    baseTreeSha: commit.tree.sha,
  };
  repoCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

export function extractStackPaths(stack, culprit = '') {
  const text = `${stack || ''}\n${culprit || ''}`;
  const matches = text.match(/(?:file:\/\/\/)?(?:[A-Za-z]:)?[^\s)'"]+\.(?:js|jsx|ts|tsx|mjs|cjs)/gi) || [];
  return [...new Set(matches.map((item) => item
    .replace(/^file:\/\//i, '')
    .replace(/^[('"`[]+/, '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^[A-Za-z]:/, '')
    .replace(/^\/+/, '')
    .replace(/:\d+:\d+$/, '')))];
}

function scoreRepoPath(hint, repoPath) {
  const needle = String(hint || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase().split(/[?#]/, 1)[0];
  const hay = String(repoPath || '').replace(/\\/g, '/').toLowerCase();
  if (!needle || !hay) return 0;
  if (hay === needle) return 100;
  if (needle.endsWith(`/${hay}`) || hay.endsWith(`/${needle}`)) return 95;
  const hintParts = needle.split('/').filter(Boolean);
  const repoParts = hay.split('/').filter(Boolean);
  let sharedTail = 0;
  while (sharedTail < hintParts.length && sharedTail < repoParts.length
    && hintParts[hintParts.length - 1 - sharedTail] === repoParts[repoParts.length - 1 - sharedTail]) sharedTail += 1;
  if (sharedTail >= 3) return 88 + Math.min(sharedTail, 5);
  if (sharedTail === 2) return 72;
  const markers = ['shop-api/', 'pulse/', 'src/'];
  for (const marker of markers) {
    const index = needle.lastIndexOf(marker);
    if (index >= 0 && hay.endsWith(needle.slice(index))) return 90;
  }
  const base = needle.split('/').pop();
  if (base && hay.endsWith(`/${base}`)) {
    if (hay.includes('/src/') && !hay.includes('/test/')) return 60;
    if (hay.includes('/test/')) return 25;
    return 40;
  }
  return 0;
}

async function listSourceFiles(target) {
  const { data } = await target.octokit.git.getTree({
    owner: target.owner,
    repo: target.repo,
    tree_sha: target.baseTreeSha,
    recursive: 'true',
  });
  return (data.tree || [])
    .filter((item) => item.type === 'blob' && SOURCE_EXT.test(item.path || ''))
    .filter((item) => !item.path.includes('node_modules/') && !item.path.startsWith('pulse/incidents/') && !isSecretPath(item.path))
    .map((item) => ({ path: item.path, sha: item.sha }));
}

async function readGithubFile(target, path, sha) {
  try {
    if (sha) {
      const { data } = await target.octokit.git.getBlob({
        owner: target.owner,
        repo: target.repo,
        file_sha: sha,
      });
      if (data?.content) return Buffer.from(String(data.content).replace(/\n/g, ''), 'base64').toString('utf8');
    }
    const { data } = await target.octokit.repos.getContent({
      owner: target.owner,
      repo: target.repo,
      path,
      ref: target.base,
    });
    if (Array.isArray(data) || data.type !== 'file' || !data.content) return null;
    if (Number(data.size) > 200_000) return null;
    return Buffer.from(String(data.content).replace(/\n/g, ''), 'base64').toString('utf8');
  } catch {
    return null;
  }
}

export async function gatherGithubContext({ stack, culprit, release, extra, url, github } = {}) {
  const extraText = [culprit, url, extra?.main, extra?.cwd].filter(Boolean).join('\n');
  const secretFiles = extractSecretStackPaths(stack, extraText);
  const target = await resolveGithubRepo(github);
  if (!target.ok) return { ...target, files: [], secretFiles };
  const tree = await listSourceFiles(target);
  const byPath = new Map(tree.map((item) => [item.path, item]));
  const hints = extractStackPaths(stack, extraText)
    .filter((hint) => !hint.startsWith('node:') && !hint.includes('internal/modules/') && !hint.includes('/node:'));
  const shopScoped = hints.some((hint) => /shop-api/i.test(hint))
    || /shop-api/i.test(String(release || ''))
    || /shop-api/i.test(String(extra?.cwd || ''));
  const matched = [];
  for (const hint of hints) {
    if (isSecretPath(hint) || isSecretPath(hint.split('/').pop() || '')) {
      const label = publicSecretLabel(hint);
      if (label && !secretFiles.includes(label)) secretFiles.push(label);
      continue;
    }
    const ranked = tree
      .map((item) => ({ path: item.path, score: scoreRepoPath(hint, item.path) }))
      .filter((item) => item.score >= 70)
      .sort((a, b) => b.score - a.score);
    const hit = ranked.find((item) => !shopScoped || !item.path.startsWith('pulse/')) || ranked[0];
    if (hit && isSecretPath(hit.path)) {
      const label = publicSecretLabel(hit.path);
      if (label && !secretFiles.includes(label)) secretFiles.push(label);
      continue;
    }
    if (hit && !matched.includes(hit.path) && !isSecretPath(hit.path)) matched.push(hit.path);
    if (matched.length >= 8) break;
  }
  const files = (await Promise.all(matched.map(async (filePath) => {
    const contents = await readGithubFile(target, filePath, byPath.get(filePath)?.sha);
    if (!contents || isSecretPath(filePath) || /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(contents)) return null;
    return {
      path: filePath,
      contents,
      githubContents: contents,
      source: 'github',
      baseSha: target.baseSha,
    };
  }))).filter(Boolean);
  const unmatchedReason = files.length || secretFiles.length
    ? ''
    : (!hints.length && !secretFiles.length
      ? 'This stack has no client file paths — only Node internals — so Pulse cannot open a PR against the GitHub repo.'
      : `This stack points at ${hints.join(', ')}, which are not files in ${target.repoFull}.`);
  return { ...target, files, secretFiles, unmatchedReason };
}

export async function loadRelatedTestFiles(github, patchedPaths = []) {
  const target = await resolveGithubRepo(github);
  if (!target.ok) return [];
  const tree = await listSourceFiles(target);
  const byPath = new Map(tree.map((item) => [item.path, item]));
  const wanted = new Set();
  for (const filePath of patchedPaths) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    const dir = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
    const base = normalized.split('/').pop().replace(/\.(?:js|jsx|ts|tsx|mjs|cjs)$/i, '');
    if (!base) continue;
    for (const item of tree) {
      const repoPath = item.path;
      if (repoPath === normalized || isSecretPath(repoPath)) continue;
      if (repoPath === `${dir}/${base}.test.js` || repoPath === `${dir}/${base}.spec.js`) wanted.add(repoPath);
      if (/(?:^|\/)(?:test|tests|__tests__)\//i.test(repoPath) && repoPath.includes(base)) wanted.add(repoPath);
    }
  }
  const files = [];
  for (const filePath of [...wanted].slice(0, 4)) {
    const contents = await readGithubFile(target, filePath, byPath.get(filePath)?.sha);
    if (!contents) continue;
    files.push({ path: filePath, contents, githubContents: contents });
  }
  return files;
}

export async function createFixPullRequest({ branch, title, body, files, github, target }) {
  const tokenMissing = createClient(github);
  if (!tokenMissing.ok) return tokenMissing;
  if (!files?.length) return { ok: false, reason: 'No files to commit' };
  const commitFiles = assertSafeCommitFiles(files);
  if (!commitFiles.length) return { ok: false, reason: 'Refusing to commit secret or credential files.' };

  const resolved = target?.ok ? target : await resolveGithubRepo(github);
  if (!resolved.ok) return resolved;
  const { octokit, owner, repo, base, baseSha, baseTreeSha } = resolved;

  try {
    const blobs = [];
    for (const file of commitFiles) {
      const blob = await octokit.git.createBlob({
        owner,
        repo,
        content: file.githubContents || file.contents,
        encoding: 'utf-8',
      });
      blobs.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.data.sha,
      });
    }

    const tree = await octokit.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: blobs,
    });
    if (tree.data.sha === baseTreeSha) {
      return { ok: true, unchanged: true, url: '', base, repo: `${owner}/${repo}` };
    }
    const commit = await octokit.git.createCommit({
      owner,
      repo,
      message: (title || 'fix: production error').slice(0, 80),
      tree: tree.data.sha,
      parents: [baseSha],
    });

    try {
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: commit.data.sha,
      });
    } catch (error) {
      if (error.status === 422) {
        return {
          ok: false,
          reason: `GitHub branch ${branch} already exists in ${owner}/${repo}. Pulse did not overwrite it. Delete that abandoned branch or use a new issue title, then retry.`,
        };
      }
      throw error;
    }

    try {
      const pr = await octokit.pulls.create({
        owner,
        repo,
        title,
        head: branch,
        base,
        body,
      });
      return {
        ok: true,
        url: pr.data.html_url,
        number: pr.data.number,
        base,
        repo: `${owner}/${repo}`,
      };
    } catch (error) {
      if (error.status !== 422) throw error;
      const { data: existing } = await octokit.pulls.list({
        owner,
        repo,
        head: `${owner}:${branch}`,
        state: 'open',
      });
      if (existing[0]) {
        return {
          ok: true,
          url: existing[0].html_url,
          number: existing[0].number,
          base,
          repo: `${owner}/${repo}`,
        };
      }
      return { ok: false, reason: error.message || 'Unable to open pull request' };
    }
    } catch (error) {
    return { ok: false, reason: explainGithubWriteError(error, `${owner}/${repo}`) };
  }
}

export async function commitFixBranch({ branch, title, files, github }) {
  const client = createClient(github);
  if (!client.ok) return client;
  if (!files?.length) return { ok: false, reason: 'No files to commit' };
  const commitFiles = assertSafeCommitFiles(files);
  if (!commitFiles.length) return { ok: false, reason: 'Refusing to commit secret or credential files.' };
  const { octokit, owner, repo, repoFull } = client;

  try {
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    let base = usableBranch(github.githubBaseBranch || github.github_base_branch) || repoData.default_branch;
    let baseRef;
    try {
      ({ data: baseRef } = await octokit.git.getRef({ owner, repo, ref: `heads/${base}` }));
    } catch (error) {
      if (error.status !== 404 || base === repoData.default_branch) throw error;
      base = repoData.default_branch;
      ({ data: baseRef } = await octokit.git.getRef({ owner, repo, ref: `heads/${base}` }));
    }
    const { data: parent } = await octokit.git.getCommit({ owner, repo, commit_sha: baseRef.object.sha });
    const treeEntries = [];
    for (const file of commitFiles) {
      const { data: blob } = await octokit.git.createBlob({
        owner,
        repo,
        content: file.githubContents || file.contents,
        encoding: 'utf-8',
      });
      treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const { data: tree } = await octokit.git.createTree({
      owner,
      repo,
      base_tree: parent.tree.sha,
      tree: treeEntries,
    });
    const { data: commit } = await octokit.git.createCommit({
      owner,
      repo,
      message: (title || 'fix: production error').slice(0, 80),
      tree: tree.sha,
      parents: [baseRef.object.sha],
    });
    await octokit.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commit.sha });
    return { ok: true, branch, sha: commit.sha, base, repo: repoFull };
  } catch (error) {
    if (error.status === 422) {
      return { ok: false, reason: `GitHub could not create candidate branch ${branch} in ${repoFull}; it may already exist.` };
    }
    return { ok: false, reason: explainGithubWriteError(error, repoFull) };
  }
}

export async function runGithubWorkflow({ branch, sha, github, workflow = 'pulse-validation.yml', timeoutMs = 15 * 60_000 }) {
  const client = createClient(github);
  if (!client.ok) return client;
  const { octokit, owner, repo, repoFull } = client;
  try {
    await octokit.actions.createWorkflowDispatch({ owner, repo, workflow_id: workflow, ref: branch });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { data } = await octokit.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: workflow,
        branch,
        event: 'workflow_dispatch',
        per_page: 20,
      });
      const run = data.workflow_runs.find((item) => item.head_sha === sha);
      if (run?.status === 'completed') {
        const ok = run.conclusion === 'success';
        return {
          ok,
          url: run.html_url,
          conclusion: run.conclusion || 'unknown',
          retryable: !ok,
          reason: ok ? '' : `GitHub Actions validation ${run.conclusion || 'failed'}: ${run.html_url}`,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    return { ok: false, retryable: false, reason: `GitHub Actions validation did not finish within ${Math.round(timeoutMs / 60_000)} minutes for ${repoFull}.` };
  } catch (error) {
    const status = Number(error?.status || 0);
    const reason = status === 404
      ? `GitHub Actions could not find ${workflow} on the repository's default branch. Add and enable that workflow before Pulse can open tested PRs.`
      : status === 403
        ? `GitHub Actions denied workflow dispatch for ${repoFull} (403). Grant the project's fine-grained token Actions: Read and write, in addition to Contents and Pull requests: Read and write.`
        : explainGithubWriteError(error, repoFull);
    return { ok: false, retryable: false, reason };
  }
}

export async function openFixPullRequest({ branch, title, body, github, target }) {
  const client = createClient(github);
  if (!client.ok) return client;
  const resolved = target?.ok ? target : await resolveGithubRepo(github);
  if (!resolved.ok) return resolved;
  const { octokit, owner, repo, base, repoFull } = resolved;
  try {
    const pr = await octokit.pulls.create({ owner, repo, title, head: branch, base, body });
    return { ok: true, url: pr.data.html_url, number: pr.data.number, base, repo: repoFull };
  } catch (error) {
    if (error.status === 422) {
      const { data: existing } = await octokit.pulls.list({ owner, repo, head: `${owner}:${branch}`, state: 'open' });
      if (existing[0]) return { ok: true, url: existing[0].html_url, number: existing[0].number, base, repo: repoFull };
    }
    return { ok: false, reason: explainGithubWriteError(error, repoFull) };
  }
}

export async function listPullStates(github) {
  const client = createClient(github);
  if (!client.ok) return [];
  const { octokit, owner, repo } = client;
  const { data } = await octokit.pulls.list({
    owner,
    repo,
    state: 'all',
    per_page: 100,
    sort: 'updated',
    direction: 'desc',
  });
  return data.map((pr) => ({
    url: pr.html_url,
    number: pr.number,
    merged: Boolean(pr.merged_at),
    closed: pr.state === 'closed' || Boolean(pr.merged_at),
    title: pr.title,
  }));
}
