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

function safeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

export function createPulseClient(options = {}) {
  const state = {
    dsn: options.dsn || '',
    environment: options.environment || 'production',
    release: options.release || '',
    user: options.user || {},
    tags: options.tags || {},
    breadcrumbs: [],
    queue: [],
    sending: false,
    installed: false,
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
        await fetch(state.dsn, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        });
      }
    } catch {
      state.queue.unshift(...batch);
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
      user: extra.user || state.user,
      tags: { ...state.tags, ...(extra.tags || {}) },
      breadcrumbs: [...state.breadcrumbs],
      extra: safeJson(extra.extra) || {},
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

  function installNode() {
    if (typeof process === 'undefined' || typeof process.on !== 'function') return;
    process.on('uncaughtException', (error) => {
      captureException(error, {
        level: 'fatal',
        url: typeof process !== 'undefined' ? String(process.argv?.[1] || '') : '',
        extra: {
          kind: 'uncaughtException',
          cwd: typeof process !== 'undefined' ? process.cwd() : '',
          main: typeof process !== 'undefined' ? String(process.argv?.[1] || '') : '',
        },
      });
    });
    process.on('unhandledRejection', (reason) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      captureException(error, { level: 'error', extra: { kind: 'unhandledRejection' } });
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
      const dsn = next.dsn || process.env.PULSE_DSN || state.dsn;
      Object.assign(state, next, {
        dsn,
        environment: next.environment || process.env.PULSE_ENVIRONMENT || process.env.NODE_ENV || state.environment,
        release: next.release || process.env.PULSE_RELEASE || state.release,
      });
      install();
      return this;
    },
    captureException,
    captureMessage,
    setUser(user) {
      state.user = user || {};
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
export const addBreadcrumb = (...args) => defaultClient.addBreadcrumb(...args);
export const flush = () => defaultClient.flush();

if (typeof window !== 'undefined') {
  window.Pulse = defaultClient;
}
