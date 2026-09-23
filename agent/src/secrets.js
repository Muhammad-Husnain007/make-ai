const REDACTED = '[REDACTED]';
const PLACEHOLDER = (index) => `__PULSE_REDACTED_${index}__`;
const PLACEHOLDER_RE = /__PULSE_REDACTED_\d+__/g;

const SECRET_PATH_RE = /(?:^|\/)(?:\.env(?:\..+)?$|\.netrc$|\.npmrc$|\.pypirc$|\.htpasswd$|id_rsa(?:\.pub)?$|id_dsa$|id_ecdsa$|id_ed25519$|authorized_keys$|known_hosts$|kubeconfig(?:\.yaml)?$|credentials(?:\.json)?$|service[-_]?account.*\.json$|google-services\.json$|.*\.(?:pem|key|p12|pfx|jks|keystore|kdbx)$)/i;

const SECRET_PATH_DIR_RE = /(?:^|\/)(?:secrets?|private|certs?|certificates|keys)\/.+/i;

const SENSITIVE_KEY_RE = /^(?:password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token|auth(?:orization)?|cookie|session|client[_-]?secret|smtp[_-]?(?:pass|password)|db[_-]?pass(?:word)?|mongo(?:db)?[_-]?(?:uri|url|pass)|database[_-]?url|connection[_-]?string|credit[_-]?card|ssn|otp)$/i;

const HIGH_VALUE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
  /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bsk[_-](?:live|test)[_-][A-Za-z0-9]{16,}\b/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bAIza[0-9A-Za-z\-_]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp|https?):\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/gi,
];

const ASSIGN_RE = /(^|[\s,{])((?:password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|smtp[_-]?(?:pass|password)|authorization|mongo(?:db)?[_-]?(?:uri|url)|database[_-]?url|connection[_-]?string)\s*[:=]\s*)(['"`])([^'"`\n]{4,})\3/gim;

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

export function isSecretPath(filePath) {
  const path = normalizePath(filePath);
  if (!path) return false;
  if (path.includes('..')) return true;
  return SECRET_PATH_RE.test(path) || SECRET_PATH_DIR_RE.test(path);
}

export function publicSecretLabel(filePath) {
  const path = normalizePath(filePath).replace(/^file:\/\//i, '').replace(/^[A-Za-z]:/, '');
  const parts = path.split('/').filter(Boolean);
  const base = parts[parts.length - 1] || '';
  const parent = parts[parts.length - 2] || '';
  if (!base) return '';
  if (parent && /^(secrets?|private|certs?|certificates|keys|\.config)$/i.test(parent)) {
    return `${parent}/${base}`;
  }
  return base;
}

export function extractSecretStackPaths(stack, extra = '') {
  const text = `${stack || ''}\n${extra || ''}`;
  const matches = String(text).match(/(?:file:\/\/\/)?(?:[A-Za-z]:)?[^\s)'"]+/g) || [];
  const out = [];
  for (const raw of matches) {
    const cleaned = raw
      .replace(/^file:\/\//i, '')
      .replace(/^[('"`[]+/, '')
      .replace(/\\/g, '/')
      .replace(/:\d+:\d+$/, '')
      .replace(/:\d+$/, '');
    if (!isSecretPath(cleaned) && !isSecretPath(cleaned.split('/').pop() || '')) continue;
    const label = publicSecretLabel(cleaned);
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

export function defaultSecretGuidance(secretFiles, issue) {
  return (secretFiles || []).map((path) => ({
    path,
    issue: `This crash involves ${path}. Pulse never reads or commits secret files.`,
    action: `Open ${path} locally and fix the setting related to: ${String(issue?.title || 'this error').slice(0, 160)}. Do not commit this file.`,
  }));
}

export function formatSecretGuidance(guidance) {
  const items = (guidance || []).filter((item) => item?.path && (item.issue || item.action));
  if (!items.length) return '';
  return [
    '## Secret files you must update yourself',
    'Pulse does not read, send to the model, or commit secret files. Apply these changes locally and keep them out of git:',
    ...items.map((item) => `- \`${item.path}\`: ${[item.issue, item.action].filter(Boolean).join(' ')}`),
  ].join('\n');
}

function collectMatches(text, patterns) {
  const found = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const copy = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (const match of String(text || '').matchAll(copy)) {
      if (match[0]) found.push({ start: match.index, end: match.index + match[0].length, value: match[0] });
    }
  }
  ASSIGN_RE.lastIndex = 0;
  for (const match of String(text || '').matchAll(ASSIGN_RE)) {
    const full = match[0];
    const secret = match[4];
    const secretAt = full.lastIndexOf(secret);
    const start = match.index + secretAt;
    found.push({ start, end: start + secret.length, value: secret });
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const item of found) {
    const last = merged[merged.length - 1];
    if (last && item.start < last.end) {
      if (item.end > last.end) last.end = item.end;
      continue;
    }
    merged.push({ ...item });
  }
  return merged;
}

export function hasSecretContent(text) {
  return collectMatches(text, HIGH_VALUE_PATTERNS).length > 0;
}

export function maskSecrets(text) {
  const source = String(text ?? '');
  const hits = collectMatches(source, HIGH_VALUE_PATTERNS);
  if (!hits.length) return { masked: source, secrets: [] };
  const secrets = [];
  let masked = '';
  let cursor = 0;
  hits.forEach((hit, index) => {
    masked += source.slice(cursor, hit.start);
    const token = PLACEHOLDER(index + 1);
    secrets.push({ token, value: source.slice(hit.start, hit.end) });
    masked += token;
    cursor = hit.end;
  });
  masked += source.slice(cursor);
  return { masked, secrets };
}

export function restoreSecrets(text, secrets) {
  let out = String(text ?? '');
  for (const item of secrets || []) {
    if (!item?.token || item.value == null) continue;
    out = out.split(item.token).join(item.value);
  }
  return out;
}

export function placeholdersIntact(maskedOriginal, maskedNext) {
  const tokens = String(maskedOriginal || '').match(PLACEHOLDER_RE) || [];
  const next = String(maskedNext || '');
  return tokens.every((token) => next.includes(token));
}

export function redactText(text) {
  return maskSecrets(text).masked.replace(PLACEHOLDER_RE, REDACTED);
}

function sanitizeUnknown(value, key = '') {
  if (value == null) return value;
  if (SENSITIVE_KEY_RE.test(String(key || ''))) return REDACTED;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item, key));
  if (typeof value === 'object') return sanitizeObject(value);
  return REDACTED;
}

export function sanitizeObject(value) {
  if (!value || typeof value !== 'object') return value;
  const out = Array.isArray(value) ? [] : {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = sanitizeUnknown(item, key);
  }
  return out;
}

export function sanitizeIssuePayload(issue, event) {
  const extra = event?.extra && typeof event.extra === 'object' ? sanitizeObject(event.extra) : event?.extra;
  return {
    title: redactText(issue?.title || ''),
    culprit: redactText(issue?.culprit || ''),
    stack: redactText(event?.stack || issue?.title || ''),
    extra,
    user: event?.user && typeof event.user === 'object' ? sanitizeObject(event.user) : undefined,
  };
}

export function maskContextFile(file) {
  if (!file?.path || isSecretPath(file.path)) return null;
  const local = maskSecrets(file.contents || '');
  const github = maskSecrets(file.githubContents || file.contents || '');
  if (/-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(file.contents || '')
    || /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(file.githubContents || '')) {
    return null;
  }
  return {
    ...file,
    contents: local.masked,
    githubContents: github.masked,
    _secrets: {
      contents: local.secrets,
      githubContents: github.secrets,
    },
  };
}

export function safePatchedContents({ original, maskedOriginal, patchedMasked, secrets }) {
  if (!patchedMasked || patchedMasked === maskedOriginal) return null;
  if (!placeholdersIntact(maskedOriginal, patchedMasked)) return null;
  const restored = restoreSecrets(patchedMasked, secrets);
  const originalHits = collectMatches(original, HIGH_VALUE_PATTERNS).map((item) => item.value).sort();
  const nextHits = collectMatches(restored, HIGH_VALUE_PATTERNS).map((item) => item.value).sort();
  if (nextHits.some((value) => !originalHits.includes(value))) return null;
  return restored;
}

export function assertSafeCommitFiles(files) {
  const safe = [];
  for (const file of files || []) {
    const path = normalizePath(file?.path);
    if (!path || isSecretPath(path) || path.includes('..')) continue;
    const body = file.githubContents || file.contents || '';
    if (/-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(body)) continue;
    safe.push(file);
  }
  return safe;
}
