import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SKIP = new Set(['node_modules', '.git', 'dist', 'data', 'coverage', '.cursor']);
const SOURCE_EXT = /\.(?:js|jsx|mjs|cjs)$/i;

function walkSourceFiles(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (out.length > 80) return out;
      walkSourceFiles(abs, out);
    } else if (SOURCE_EXT.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

export function clientScanRoot(repoRoot, { release, cwd } = {}) {
  const fromRelease = String(release || '').split('@')[0].trim();
  const candidates = [
    cwd,
    fromRelease ? path.join(repoRoot, fromRelease) : '',
    path.join(repoRoot, 'shop-api'),
  ].filter(Boolean);
  for (const dir of candidates) {
    const src = path.join(dir, 'src');
    if (fs.existsSync(src) && fs.statSync(src).isDirectory()) return dir;
  }
  return repoRoot;
}

export function findStackLocalFiles(repoRoot, { stack, culprit, extra, release } = {}) {
  const scanRoot = clientScanRoot(repoRoot, { release, cwd: extra?.cwd });
  const text = [stack, culprit, extra?.main, extra?.cwd].filter(Boolean).join('\n');
  const matches = String(text).match(/(?:file:\/\/\/)?(?:[A-Za-z]:)?[^\s)'"]+\.(?:js|jsx|mjs|cjs)/gi) || [];
  const files = [];
  for (const raw of matches) {
    const cleaned = raw
      .replace(/^file:\/\//i, '')
      .replace(/\\/g, '/')
      .replace(/:\d+:\d+$/, '');
    const srcIndex = cleaned.toLowerCase().lastIndexOf('/src/');
    const relInside = srcIndex >= 0 ? cleaned.slice(srcIndex + 1) : path.posix.basename(cleaned);
    const abs = path.join(scanRoot, relInside);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const rel = path.relative(repoRoot, abs).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..') || files.some((file) => file.path === rel)) continue;
    files.push({ path: rel, abs, contents: fs.readFileSync(abs, 'utf8') });
  }
  return files;
}

export function fallbackReferenceErrorFix(issue, contextFiles) {
  const missing = String(issue?.title || issue?.message || '').match(/ReferenceError:\s+([A-Za-z_$][\w$]*) is not defined/)?.[1];
  if (!missing) return [];
  const out = [];
  for (const file of contextFiles || []) {
    if (!new RegExp(`\\b${missing}\\b`).test(file.contents || '')) continue;
    const imported = [...String(file.contents).matchAll(/import\s+\{([^}]+)\}/g)]
      .flatMap((item) => item[1].split(',').map((part) => {
        const bits = part.trim().split(/\s+as\s+/);
        return bits[bits.length - 1].trim();
      }))
      .filter(Boolean);
    const replacement = imported.find((name) => (
      name !== missing
      && (name.startsWith(missing) || missing.startsWith(name) || name.toLowerCase().includes(missing.toLowerCase()))
    ));
    if (!replacement) continue;
    const contents = file.contents.replace(new RegExp(`\\b${missing}\\b`, 'g'), replacement);
    const githubSource = file.githubContents || file.contents;
    const githubContents = githubSource.replace(new RegExp(`\\b${missing}\\b`, 'g'), replacement);
    if (contents !== file.contents) out.push({ path: file.path, contents, githubContents });
  }
  return out;
}

export function findLocalParseErrors(repoRoot, { release, cwd } = {}) {
  const scanRoot = clientScanRoot(repoRoot, { release, cwd });
  const files = walkSourceFiles(path.join(scanRoot, 'src'));
  const broken = [];
  for (const abs of files) {
    const checked = spawnSync(process.execPath, ['--check', abs], {
      encoding: 'utf8',
      timeout: 4000,
    });
    if (checked.status === 0) continue;
    const rel = path.relative(repoRoot, abs).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..')) continue;
    broken.push({
      path: rel,
      abs,
      contents: fs.readFileSync(abs, 'utf8'),
      detail: String(checked.stderr || checked.stdout || '').slice(0, 800),
    });
    if (broken.length >= 4) break;
  }
  return broken;
}

function detectEol(text) {
  return String(text || '').includes('\r\n') ? '\r\n' : '\n';
}

function splitLines(text) {
  return String(text || '').replace(/\r\n/g, '\n').split('\n');
}

function restoreEol(lines, original) {
  const eol = detectEol(original);
  const joined = lines.join(eol);
  const hadTerm = /\r?\n$/.test(original);
  const hasTerm = /\r?\n$/.test(joined);
  if (hadTerm && !hasTerm) return joined + eol;
  if (!hadTerm && hasTerm) return joined.replace(/\r?\n$/, '');
  return joined;
}

function changedLineCount(original, next) {
  const a = splitLines(original);
  const b = splitLines(next);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA -= 1;
    endB -= 1;
  }
  return Math.max(endA - start + 1, 0) + Math.max(endB - start + 1, 0);
}

export function isSurgicalChange(original, next) {
  if (!next || next === original) return false;
  const total = Math.max(splitLines(original).length, 1);
  const changed = changedLineCount(original, next);
  if (changed <= 0) return false;
  if (total <= 20) return changed <= 6;
  return changed <= Math.max(4, Math.ceil(total * 0.12));
}

export function applySearchReplace(original, oldText, newText) {
  const source = String(original || '');
  const from = String(oldText || '').replace(/\r\n/g, '\n');
  const to = String(newText ?? '').replace(/\r\n/g, '\n');
  if (!from || from === to) return null;
  const normalized = source.replace(/\r\n/g, '\n');
  const index = normalized.indexOf(from);
  if (index === -1) return null;
  const next = normalized.slice(0, index) + to + normalized.slice(index + from.length);
  return restoreEol(splitLines(next), source);
}

export function mergeMinimally(original, proposed) {
  const source = String(original || '');
  const next = String(proposed || '').replace(/\r\n/g, '\n');
  if (!next.trim()) return null;
  const a = splitLines(source);
  const b = splitLines(next);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA -= 1;
    endB -= 1;
  }
  const merged = [...a.slice(0, start), ...b.slice(start, endB + 1), ...a.slice(endA + 1)];
  const result = restoreEol(merged, source);
  return isSurgicalChange(source, result) ? result : null;
}

export function applyAiFilePatch(original, aiFile) {
  const source = String(original || '');
  const edits = Array.isArray(aiFile?.edits) ? aiFile.edits : Array.isArray(aiFile?.changes) ? aiFile.changes : [];
  if (edits.length) {
    let next = source;
    for (const edit of edits.slice(0, 5)) {
      const applied = applySearchReplace(
        next,
        edit.old || edit.search || edit.original || edit.from,
        edit.new || edit.replace || edit.updated || edit.to,
      );
      if (!applied) return null;
      next = applied;
    }
    return isSurgicalChange(source, next) ? next : null;
  }
  const full = aiFile?.contents ?? aiFile?.content;
  if (full) return mergeMinimally(source, String(full));
  return null;
}

export function applyLocalFiles(repoRoot, files) {
  for (const file of files) {
    const abs = path.resolve(repoRoot, file.path);
    if (!abs.startsWith(path.resolve(repoRoot))) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.contents, 'utf8');
  }
}
