import { Octokit } from '@octokit/rest';

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
  const [owner, repo] = repoFull.split('/');
  return { ok: true, octokit: new Octokit({ auth: token }), owner, repo, repoFull };
}

function usableBranch(value) {
  const requested = String(value || '').trim();
  return requested && !requested.includes('..') && /^[A-Za-z0-9._/-]+$/.test(requested)
    ? requested
    : '';
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
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^[A-Za-z]:/, '')
    .replace(/^\/+/, '')
    .replace(/:\d+:\d+$/, '')))];
}

function scoreRepoPath(hint, repoPath) {
  const needle = String(hint || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  const hay = String(repoPath || '').toLowerCase();
  if (!needle || !hay) return 0;
  if (hay === needle) return 100;
  if (needle.endsWith(`/${hay}`) || hay.endsWith(`/${needle}`)) return 95;
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
    .filter((item) => !item.path.includes('node_modules/') && !item.path.startsWith('pulse/incidents/'))
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

export async function gatherGithubContext({ stack, culprit, release, extra, localFiles = [], github } = {}) {
  const target = await resolveGithubRepo(github);
  if (!target.ok) return { ...target, files: [] };
  const tree = await listSourceFiles(target);
  const byPath = new Map(tree.map((item) => [item.path, item]));
  const hints = extractStackPaths(stack, culprit)
    .filter((hint) => !hint.startsWith('node:') && !hint.includes('internal/modules/'));
  const shopScoped = hints.some((hint) => /shop-api/i.test(hint))
    || /shop-api/i.test(String(release || ''))
    || /shop-api/i.test(String(extra?.cwd || ''));
  const matched = [];
  for (const hint of hints) {
    const ranked = tree
      .map((item) => ({ path: item.path, score: scoreRepoPath(hint, item.path) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    const hit = ranked.find((item) => !shopScoped || !item.path.startsWith('pulse/')) || ranked[0];
    if (hit && !matched.includes(hit.path)) matched.push(hit.path);
    if (matched.length >= 4) break;
  }
  for (const local of localFiles) {
    if (local.path && !matched.includes(local.path)) matched.push(local.path);
  }
  const files = (await Promise.all(matched.map(async (filePath) => {
    const local = localFiles.find((item) => item.path === filePath);
    const githubContents = await readGithubFile(target, filePath, byPath.get(filePath)?.sha);
    const contents = local?.contents || githubContents;
    if (!contents) return null;
    return {
      path: filePath,
      contents,
      githubContents: githubContents || contents,
      fromLocal: Boolean(local),
    };
  }))).filter(Boolean);
  return { ...target, files };
}

export async function createFixPullRequest({ branch, title, body, files, github, target }) {
  const tokenMissing = createClient(github);
  if (!tokenMissing.ok) return tokenMissing;
  if (!files?.length) return { ok: false, reason: 'No files to commit' };

  const resolved = target?.ok ? target : await resolveGithubRepo(github);
  if (!resolved.ok) return resolved;
  const { octokit, owner, repo, base, baseSha, baseTreeSha } = resolved;

  const blobs = [];
  for (const file of files) {
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
    if (error.status !== 422) throw error;
    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: commit.data.sha,
      force: true,
    });
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
