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

function editDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left === right) return 0;
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i += 1) {
    let prev = i;
    row[0] = i + 1;
    for (let j = 0; j < right.length; j += 1) {
      const cur = row[j + 1];
      row[j + 1] = left[i] === right[j] ? prev : Math.min(prev, row[j], row[j + 1]) + 1;
      prev = cur;
    }
  }
  return row[right.length];
}

export function fallbackNotAFunctionFix(issue, contextFiles) {
  const match = String(issue?.title || issue?.message || '').match(/TypeError:\s+([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*) is not a function/);
  if (!match) return [];
  const [, objectName, badName] = match;
  const call = `${objectName}.${badName}`;
  const out = [];
  for (const file of contextFiles || []) {
    const source = file.contents || '';
    const githubSource = file.githubContents || source;
    if (!source.includes(call) && !githubSource.includes(call)) continue;
    const methods = [...`${source}\n${githubSource}`.matchAll(new RegExp(`\\b${objectName}\\.([A-Za-z_$][\\w$]*)\\b`, 'g'))]
      .map((item) => item[1])
      .filter((name) => name !== badName);
    const replacement = [...new Set(methods)].find((name) => editDistance(name, badName) === 1)
      || (badName === 'saev' ? 'save' : null);
    if (!replacement) continue;
    const nextCall = `${objectName}.${replacement}`;
    const contents = source.split(call).join(nextCall);
    const githubContents = githubSource.split(call).join(nextCall);
    if (contents !== source || githubContents !== githubSource) {
      out.push({ path: file.path, contents, githubContents });
    }
  }
  return out;
}

function removeTopLevelReturns(source) {
  const lines = splitLines(String(source || '').replace(/\r\n/g, '\n'));
  let depth = 0;
  let changed = false;
  const next = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (depth <= 0 && /^return\b/.test(trimmed)) {
      changed = true;
      continue;
    }
    next.push(line);
    depth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
    if (depth < 0) depth = 0;
  }
  return changed ? next.join('\n') : source;
}

export function fallbackSyntaxFix(issue, contextFiles) {
  const title = `${issue?.title || ''} ${issue?.message || ''}`;
  if (!/SyntaxError/i.test(title)) return [];
  const out = [];
  for (const file of contextFiles || []) {
    const source = file.contents || '';
    const githubSource = file.githubContents || source;
    let contents = source;
    let githubContents = githubSource;
    if (/Illegal return statement/i.test(title)) {
      contents = removeTopLevelReturns(source);
      githubContents = removeTopLevelReturns(githubSource);
    }
    if (contents !== source || githubContents !== githubSource) {
      out.push({ path: file.path, contents, githubContents });
    }
  }
  return out;
}

export function fallbackQuotedFix(analysis, contextFiles) {
  const text = [analysis?.solution, analysis?.rootCause, analysis?.summary, analysis?.prBody]
    .filter(Boolean)
    .join('\n');
  const pairs = [];
  for (const match of text.matchAll(/`([^`\n]{2,120})`\s*(?:was (?:corrected|changed|rewritten) to|→|->|to)\s*`([^`\n]{2,120})`/gi)) {
    pairs.push([match[1], match[2]]);
  }
  for (const match of text.matchAll(/misspelled as ['`]([^'`\n]+)['`] instead of ['`]([^'`\n]+)['`]/gi)) {
    pairs.push([match[1], match[2]]);
  }
  if (!pairs.length) return [];
  const out = [];
  for (const file of contextFiles || []) {
    let contents = file.contents || '';
    let githubContents = file.githubContents || contents;
    const before = contents;
    const beforeGithub = githubContents;
    for (const [from, to] of pairs) {
      if (!from || !to || from === to) continue;
      if (contents.includes(from)) contents = contents.split(from).join(to);
      if (githubContents.includes(from)) githubContents = githubContents.split(from).join(to);
    }
    if (contents !== before || githubContents !== beforeGithub) {
      out.push({ path: file.path, contents, githubContents });
    }
  }
  return out;
}

export function fallbackIssueFix(issue, contextFiles, analysis) {
  for (const attempt of [
    () => fallbackQuotedFix(analysis, contextFiles),
    () => fallbackNotAFunctionFix(issue, contextFiles),
    () => fallbackReferenceErrorFix(issue, contextFiles),
    () => fallbackSyntaxFix(issue, contextFiles),
  ]) {
    const files = attempt();
    if (files.length) return files;
  }
  return [];
}

export function githubAlreadyHasFix(issue, contextFiles, analysis) {
  if (fallbackIssueFix(issue, contextFiles, analysis).length) return false;
  const title = String(issue?.title || '');
  const sources = (contextFiles || []).map((file) => file.githubContents || file.contents || '');
  if (!sources.length) return false;
  const method = title.match(/TypeError:\s+([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*) is not a function/);
  if (method) return sources.every((text) => !text.includes(`${method[1]}.${method[2]}`));
  if (/Illegal return statement/i.test(title)) {
    return sources.every((text) => removeTopLevelReturns(text) === text);
  }
  return false;
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
  const changed = changedLineCount(original, next);
  return changed > 0 && changed <= 15;
}

export function applySearchReplace(original, oldText, newText) {
  const source = String(original || '');
  const from = String(oldText || '').replace(/\r\n/g, '\n');
  const to = String(newText ?? '').replace(/\r\n/g, '\n');
  if (!from || from === to) return null;
  const normalized = source.replace(/\r\n/g, '\n');
  const index = normalized.indexOf(from);
  if (index !== -1) {
    const next = normalized.slice(0, index) + to + normalized.slice(index + from.length);
    return restoreEol(splitLines(next), source);
  }
  const fromTrim = from.trim();
  if (!fromTrim) return null;
  const srcLines = splitLines(normalized);
  const fromLines = splitLines(fromTrim);
  for (let i = 0; i <= srcLines.length - fromLines.length; i += 1) {
    let matched = true;
    for (let j = 0; j < fromLines.length; j += 1) {
      if (srcLines[i + j].trim() !== fromLines[j].trim()) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    const next = [...srcLines.slice(0, i), ...splitLines(to), ...srcLines.slice(i + fromLines.length)].join('\n');
    return restoreEol(splitLines(next), source);
  }
  return null;
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
  return result !== source ? result : null;
}

export function applyAiFilePatch(original, aiFile) {
  const source = String(original || '');
  const edits = Array.isArray(aiFile?.edits) ? aiFile.edits : Array.isArray(aiFile?.changes) ? aiFile.changes : [];
  if (edits.length) {
    let next = source;
    let applied = 0;
    for (const edit of edits) {
      const patched = applySearchReplace(
        next,
        edit.old || edit.search || edit.original || edit.from,
        edit.new || edit.replace || edit.updated || edit.to,
      );
      if (!patched) continue;
      next = patched;
      applied += 1;
    }
    if (!applied || next === source) return null;
    return next;
  }
  const full = aiFile?.contents ?? aiFile?.content;
  if (full) return mergeMinimally(source, String(full));
  return null;
}
