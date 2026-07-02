import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { coralogix } from '../services/coralogix';

const SKIP_PATHS = new Set(['/api/health']);

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (SKIP_PATHS.has(req.path)) { next(); return; }

  const traceId = randomUUID();
  (req as any).traceId = traceId;
  res.setHeader('x-trace-id', traceId);

  const startMs = Date.now();
  const user    = (req as any).user?.email ?? 'anonymous';

  res.on('finish', () => {
    const duration = Date.now() - startMs;
    const failed   = res.statusCode >= 400;
    const severity = res.statusCode >= 500 ? 5 /* ERROR */
                   : res.statusCode >= 400 ? 4 /* WARNING */
                   : 3; /* INFO */

    coralogix.info('api', {
      event:      'http_request',
      method:     req.method,
      path:       req.path,
      status:     res.statusCode,
      durationMs: duration,
      user,
      ip:         req.ip ?? req.socket.remoteAddress,
      userAgent:  req.headers['user-agent'],
      severity,   // redundant but useful for Coralogix filters
      traceId,
    });

    coralogix.trace({
      traceId,
      operation: `${req.method} ${req.path}`,
      durationMs: duration,
      status: failed ? 'error' : 'ok',
      metadata: { method: req.method, path: req.path, statusCode: res.statusCode, user },
    });
  });

  next();
}
