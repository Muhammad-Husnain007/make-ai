import { addBreadcrumb, captureException } from './index.js';

function statusOf(err) {
  return Number(err?.statusCode || err?.status || 500);
}

function wrapErrorMiddleware(fn) {
  function pulseErrorHandler(err, req, res, next) {
    const originalStatus = res.status.bind(res);
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    let httpStatus = statusOf(err);

    const reportIfServerError = () => {
      httpStatus = Number(res.statusCode) || httpStatus;
      if (httpStatus < 500 || res.__pulseReported) return;
      res.__pulseReported = true;
      captureException(err, {
        url: req.originalUrl || req.url || '',
        extra: { method: req.method, status: httpStatus },
        user: req.user
          ? { id: String(req.user.id || req.user._id || ''), email: req.user.email }
          : undefined,
      });
    };

    res.status = (code) => {
      httpStatus = Number(code) || httpStatus;
      return originalStatus(code);
    };
    res.json = (...args) => {
      reportIfServerError();
      return originalJson(...args);
    };
    res.send = (...args) => {
      reportIfServerError();
      return originalSend(...args);
    };

    return fn(err, req, res, next);
  }
  Object.defineProperty(pulseErrorHandler, 'length', { value: 4 });
  return pulseErrorHandler;
}

function patchUse(proto) {
  if (!proto || proto.__pulsePatched || typeof proto.use !== 'function') return;
  proto.__pulsePatched = true;
  const originalUse = proto.use;
  proto.use = function pulseUse(...args) {
    const last = args[args.length - 1];
    if (typeof last === 'function' && last.length === 4) {
      args[args.length - 1] = wrapErrorMiddleware(last);
    }
    return originalUse.apply(this, args);
  };
}

export function instrumentExpress(express) {
  if (!express) return;
  patchUse(express.application);
  if (express.Router) {
    patchUse(express.Router);
    patchUse(express.Router.prototype);
  }
}

export function setupExpress(app) {
  if (!app || typeof app.use !== 'function') return app;
  app.use((req, _res, next) => {
    addBreadcrumb({
      type: 'http',
      category: 'request',
      message: `${req.method} ${req.originalUrl || req.url}`,
    });
    next();
  });
  app.use(wrapErrorMiddleware((err, _req, _res, next) => next(err)));
  return app;
}
