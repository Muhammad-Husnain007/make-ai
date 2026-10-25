import fs from 'node:fs';
import path from 'node:path';

const MAX_BREADCRUMBS = 40;
const MAX_QUEUE = 30;

function now() {
  return new Date().toISOString();
}

function serializeError(error) {
  if (!error) return { type: 'Error', message: 'Unknown error', stack: '' };
  if (typeof error === 'string') return { type: 'Error', message: error, stack: '' };
  return {
    type: error.name || 'Error',
    message: error.message || String(error),
    stack: error.stack || '',
  };
}

function browserAnonymousId() {
  if (typeof window === 'undefined') return '';
  try {
    const key = 'pulse_anon_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = `anon:${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return '';
  }
}

function detectGitBranch() {
  if (typeof process === 'undefined') return '';
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  if (process.env.GITHUB_REF) return process.env.GITHUB_REF.replace(/^refs\/heads\//, '');
  if (process.env.GIT_BRANCH) return process.env.GIT_BRANCH;
  if (process.env.BRANCH) return process.env.BRANCH;
  try {
    const headFile = path.join(process.cwd(), '.git', 'HEAD');
    if (fs.existsSync(headFile)) {
      const head = fs.readFileSync(headFile, 'utf8').trim();
      const match = head.match(/ref:\s*refs\/heads\/(.+)/);
      if (match) return match[1].trim();
    }
  } catch {
    // Non-fatal if .git cannot be read
  }
  return '';
}

function detectIsLocal() {
  if (typeof process === 'undefined') {
    if (typeof location !== 'undefined') {
      return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    }
    return false;
  }
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  const pulseEnv = String(process.env.PULSE_ENVIRONMENT || '').toLowerCase();
  if (['local', 'development', 'dev', 'test'].includes(pulseEnv)) return true;
  if (['local', 'development', 'dev', 'test'].includes(nodeEnv)) return true;
  if (!process.env.CI && !process.env.VERCEL && !process.env.RENDER && !process.env.HEROKU && !process.env.AWS_EXECUTION_ENV) {
    if (nodeEnv !== 'production' && pulseEnv !== 'production') return true;
  }
  return false;
}

function normalizeUser(user) {
  const raw = user && typeof user === 'object' ? user : {};
  const id = String(raw.id || raw._id || '').trim();
  const email = String(raw.email || '').trim();
  const ip = String(raw.ip || '').trim();
  const stable = id || email || (ip ? `anon:${ip}` : browserAnonymousId());
  if (!stable) return { ...raw, id: '', email, ip };
  return { ...raw, id: stable, email, ip };
}

function safeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

export function createPulseClient(options = {}) {
  const isLocalInitial = options.isLocal ?? detectIsLocal();
  const branchInitial = options.branch || detectGitBranch();
  const state = {
    dsn: options.dsn || '',
    environment: options.environment || (isLocalInitial ? 'local' : 'production'),
    release: options.release || '',
    branch: branchInitial,
    isLocal: isLocalInitial,
    user: options.user || {},
    tags: {
      ...(options.tags || {}),
      ...(branchInitial ? { branch: branchInitial } : {}),
      isLocal: isLocalInitial ? 'true' : 'false',
    },
    breadcrumbs: [],
    queue: [],
    sending: false,
    installed: false,
    fatalHandling: false,
  };

  function addBreadcrumb(crumb) {
    state.breadcrumbs.push({
      timestamp: now(),
      type: crumb.type || 'default',
      category: crumb.category || 'custom',
      message: String(crumb.message || '').slice(0, 300),
      data: safeJson(crumb.data) || {},
      level: crumb.level || 'info',
    });
    if (state.breadcrumbs.length > MAX_BREADCRUMBS) {
      state.breadcrumbs.shift();
    }
  }

  async function flush() {
    if (state.sending || !state.dsn || state.queue.length === 0) return;
    state.sending = true;
    const batch = state.queue.splice(0, MAX_QUEUE);
    try {
      for (const event of batch) {
        const payload = JSON.stringify(event);
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          const ok = navigator.sendBeacon(state.dsn, new Blob([payload], { type: 'application/json' }));
          if (ok) continue;
        }
        const response = await fetch(state.dsn, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
          signal: typeof globalThis.AbortSignal?.timeout === 'function'
            ? globalThis.AbortSignal.timeout(2500)
            : undefined,
        });
        if (!response.ok) throw new Error(`Pulse ingest failed (${response.status})`);
      }
    } catch {
      state.queue.unshift(...batch);
      console.warn(`[Pulse SDK] Event delivery failed; ${batch.length} event(s) queued for retry`);
    } finally {
      state.sending = false;
    }
  }

  function captureException(error, extra = {}) {
    if (!state.dsn) return null;
    const serialized = serializeError(error);
    const event = {
      ...serialized,
      level: extra.level || 'error',
      timestamp: now(),
      url: typeof location !== 'undefined' ? location.href : extra.url || '',
      environment: state.environment,
      release: state.release,
      branch: state.branch || '',
      user: normalizeUser(extra.user || state.user),
      tags: {
        ...state.tags,
        ...(state.branch ? { branch: state.branch } : {}),
        isLocal: state.isLocal ? 'true' : 'false',
        ...(extra.tags || {}),
      },
      breadcrumbs: [...state.breadcrumbs],
      extra: safeJson({ ...(extra.extra || {}), isLocal: state.isLocal }),
      sdk: '@pulse/sdk@1.0.0',
    };
    addBreadcrumb({ type: 'error', category: 'exception', message: event.message, level: 'error' });
    if (state.queue.length >= MAX_QUEUE) state.queue.shift();
    state.queue.push(event);
    flush();
    return event;
  }

  function captureMessage(message, level = 'info') {
    return captureException({ name: 'Message', message, stack: '' }, { level });
  }

  function registerClientSettings() {
    if (typeof process === 'undefined' || typeof fetch !== 'function' || !state.dsn) return;
    let parsed;
    try {
      parsed = new URL(state.dsn);
    } catch {
      return;
    }
    const key = parsed.pathname.match(/\/ingest\/([^/?#]+)/)?.[1];
    if (!key) return;
    const payload = {
      githubToken: process.env.GITHUB_TOKEN || '',
      githubRepo: process.env.GITHUB_REPO || '',
      githubBaseBranch: process.env.GITHUB_BASE_BRANCH || '',
      notifyEmail: process.env.PULSE_NOTIFY_EMAIL || '',
      isEnabledSendEmail: process.env.ISENABLEDSENDEMAIL ?? '',
    };
    if (
      !payload.githubToken
      && !payload.githubRepo
      && !payload.githubBaseBranch
      && !payload.notifyEmail
      && payload.isEnabledSendEmail === ''
    ) return;
    fetch(`${parsed.origin}/ingest/${key}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((response) => {
      if (!response.ok) console.warn(`[Pulse SDK] Settings registration failed (${response.status})`);
    }).catch(() => console.warn('[Pulse SDK] Settings registration could not reach the Pulse server'));
  }

  function installNode() {
    if (typeof process === 'undefined' || typeof process.on !== 'function') return;
    function failFast(error, context) {
      if (state.fatalHandling) return;
      state.fatalHandling = true;
      captureException(error, {
        level: 'fatal',
        url: String(process.argv?.[1] || ''),
        extra: { ...context, cwd: process.cwd(), main: String(process.argv?.[1] || ''), isLocal: state.isLocal },
      });
      const forceExit = setTimeout(() => process.exit(1), 3000);
      const drain = async () => {
        const deadline = Date.now() + 2700;
        while (state.sending && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        if (state.queue.length) await flush();
      };
      drain().finally(() => {
        clearTimeout(forceExit);
        process.exit(1);
      });
    }
    process.on('uncaughtException', (error) => {
      failFast(error, { kind: 'uncaughtException' });
    });
    process.on('unhandledRejection', (reason) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      failFast(error, { kind: 'unhandledRejection' });
    });
    process.on('beforeExit', () => { flush(); });
  }

  function installBrowser() {
    if (typeof window === 'undefined') return;
    window.addEventListener('error', (event) => {
      captureException(event.error || {
        name: 'Error',
        message: event.message,
        stack: `${event.filename}:${event.lineno}:${event.colno}`,
      });
    });
    window.addEventListener('unhandledrejection', (event) => {
      captureException(event.reason || { name: 'UnhandledRejection', message: 'Unhandled promise rejection' });
    });
    window.addEventListener('pagehide', () => { flush(); });
  }

  function install() {
    if (state.installed) return;
    state.installed = true;
    installBrowser();
    installNode();
  }

  return {
    init(next = {}) {
      const isLocal = next.isLocal ?? (options.isLocal ?? detectIsLocal());
      const branch = next.branch || process.env.PULSE_BRANCH || detectGitBranch() || state.branch;
      const defaultEnv = isLocal ? 'local' : 'production';
      const environment = next.environment
        || process.env.PULSE_ENVIRONMENT
        || process.env.NODE_ENV
        || defaultEnv;

      const dsn = next.dsn || process.env.PULSE_DSN || state.dsn;
      Object.assign(state, next, {
        dsn,
        environment,
        release: next.release || process.env.PULSE_RELEASE || state.release,
        branch,
        isLocal,
      });
      state.tags = {
        ...state.tags,
        ...(state.branch ? { branch: state.branch } : {}),
        isLocal: state.isLocal ? 'true' : 'false',
      };
      install();
      registerClientSettings();
      return this;
    },
    captureException,
    captureMessage,
    setUser(user) {
      state.user = normalizeUser(user);
    },
    setTag(key, value) {
      state.tags[key] = value;
    },
    addBreadcrumb,
    flush,
  };
}

const defaultClient = createPulseClient();

export const init = (options) => defaultClient.init(options);
export const captureException = (...args) => defaultClient.captureException(...args);
export const captureMessage = (...args) => defaultClient.captureMessage(...args);
export const setUser = (...args) => defaultClient.setUser(...args);
export const setTag = (...args) => defaultClient.setTag(...args);
export const flush = () => defaultClient.flush();

if (typeof window !== 'undefined') {
  window.Pulse = defaultClient;
}
