import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHECKABLE = /\.(?:js|mjs|cjs)$/i;

function hasIllegalTopLevelReturn(source) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  let depth = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (depth <= 0 && /^return\b/.test(trimmed)) return true;
    depth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
    if (depth < 0) depth = 0;
  }
  return false;
}

export function syntaxCheckFiles(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pulse-test-'));
  const failures = [];
  try {
    for (const file of files || []) {
      const ext = path.extname(file.path || '');
      if (!CHECKABLE.test(ext)) continue;
      const abs = path.join(dir, `check${ext || '.js'}`);
      writeFileSync(abs, file.githubContents || file.contents || '', 'utf8');
      const checked = spawnSync(process.execPath, ['--check', abs], {
        encoding: 'utf8',
        timeout: 8000,
      });
      if (checked.status !== 0) {
        failures.push({
          path: file.path,
          detail: String(checked.stderr || checked.stdout || 'Syntax error').slice(0, 400),
        });
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return failures;
}

export function remainingCrashSignatures(issue, files) {
  const title = `${issue?.title || ''} ${issue?.message || ''}`;
  const hits = [];
  const method = title.match(/TypeError:\s+([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*) is not a function/);
  const ref = title.match(/ReferenceError:\s+([A-Za-z_$][\w$]*) is not defined/);
  for (const file of files || []) {
    const source = file.githubContents || file.contents || '';
    if (method && source.includes(`${method[1]}.${method[2]}`)) {
      hits.push(`${file.path} still calls ${method[1]}.${method[2]}`);
    }
    if (/Illegal return statement/i.test(title) && hasIllegalTopLevelReturn(source)) {
      hits.push(`${file.path} still has a top-level return`);
    }
    if (ref && new RegExp(`\\b${ref[1]}\\s*(?:is not defined)`).test(source)) {
      hits.push(`${file.path} still mentions ${ref[1]} is not defined`);
    }
  }
  return hits;
}

export function formatTestSummary(report) {
  if (!report) return '';
  if (report.ok) {
    return `Tests passed before opening the PR: ${report.checks.join(', ')}.`;
  }
  return `Tests failed, so no pull request was opened. ${report.reason || ''}`.trim();
}
