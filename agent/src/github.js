import { Octokit } from '@octokit/rest';

const SOURCE_EXT = /\.(?:js|jsx|ts|tsx|mjs|cjs)$/i;

function createClient() {
  const token = process.env.GITHUB_TOKEN;
  const repoFull = process.env.GITHUB_REPO || 'Muhammad-Husnain007/Ask-ai';
  if (!token) return { ok: false, reason: 'GITHUB_TOKEN missing' };
  if (!repoFull.includes('/')) return { ok: false, reason: 'GITHUB_REPO must be owner/name' };
  const [owner, repo] = repoFull.split('/');
  return { ok: true, octokit: new Octokit({ auth: token }), owner, repo, repoFull };
}

function usableBranch(value) {
  const requested = String(value || '').trim();
  return requested && !requested.includes('..') && /^[A-Za-z0-9._/-]+$/.test(requested)
    ? requested
    : '';
}

export async function resolveGithubRepo() {
  const client = createClient();
  if (!client.ok) return client;
  const { octokit, owner, repo, repoFull } = client;
  const { data: repoData } = await octokit.repos.get({ owner, repo });
  let base = usableBranch(process.env.GITHUB_BASE_BRANCH) || repoData.default_branch;
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
  return {
    ok: true,
    octokit,
    owner,
    repo,
    repoFull,
    base,
    baseSha: baseRef.object.sha,
    baseTreeSha: commit.tree.sha,
  };
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
    .map((item) => item.path)
    .filter((path) => !path.includes('node_modules/') && !path.startsWith('pulse/incidents/'));
}

async function readGithubFile(target, path) {
  try {
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

export async function gatherGithubContext({ stack, culprit, release, extra, localFiles = [] }) {
  const target = await resolveGithubRepo();
  if (!target.ok) return { ...target, files: [] };
  const tree = await listSourceFiles(target);
  const hints = extractStackPaths(stack, culprit)
    .filter((hint) => !hint.startsWith('node:') && !hint.includes('internal/modules/'));
  const shopScoped = hints.some((hint) => /shop-api/i.test(hint))
    || /shop-api/i.test(String(release || ''))
    || /shop-api/i.test(String(extra?.cwd || ''));
  const matched = [];
  for (const hint of hints) {
    const ranked = tree
      .map((path) => ({ path, score: scoreRepoPath(hint, path) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    const hit = ranked.find((item) => !shopScoped || !item.path.startsWith('pulse/')) || ranked[0];
    if (hit && !matched.includes(hit.path)) matched.push(hit.path);
    if (matched.length >= 4) break;
  }
  for (const local of localFiles) {
    if (local.path && !matched.includes(local.path) && tree.includes(local.path)) {
      matched.push(local.path);
    } else if (local.path && !matched.includes(local.path)) {
      matched.push(local.path);
    }
  }
  const files = [];
  for (const filePath of matched) {
    const local = localFiles.find((item) => item.path === filePath);
    const githubContents = await readGithubFile(target, filePath);
    const contents = local?.contents || githubContents;
    if (!contents) continue;
    files.push({
      path: filePath,
      contents,
      githubContents: githubContents || contents,
      fromLocal: Boolean(local),
    });
  }
  return { ...target, files };
}

export async function createFixPullRequest({ branch, title, body, files }) {
  const tokenMissing = createClient();
  if (!tokenMissing.ok) return tokenMissing;
  if (!files?.length) return { ok: false, reason: 'No files to commit' };

  const target = await resolveGithubRepo();
  if (!target.ok) return target;
  const { octokit, owner, repo, base, baseSha, baseTreeSha } = target;

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

export async function listPullStates() {
  const client = createClient();
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
