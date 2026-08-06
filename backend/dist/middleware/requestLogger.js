"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLogger = requestLogger;
const crypto_1 = require("crypto");
const coralogix_1 = require("../services/coralogix");
const SKIP_PATHS = new Set(['/api/health']);
function requestLogger(req, res, next) {
    if (SKIP_PATHS.has(req.path)) {
        next();
        return;
    }
    const traceId = (0, crypto_1.randomUUID)();
    req.traceId = traceId;
    res.setHeader('x-trace-id', traceId);
    const startMs = Date.now();
    const user = req.user?.email ?? 'anonymous';
    res.on('finish', () => {
        const duration = Date.now() - startMs;
        const failed = res.statusCode >= 400;
        const severity = res.statusCode >= 500 ? 5 /* ERROR */
            : res.statusCode >= 400 ? 4 /* WARNING */
                : 3; /* INFO */
        coralogix_1.coralogix.info('api', {
            event: 'http_request',
            method: req.method,
            path: req.path,
            status: res.statusCode,
            durationMs: duration,
            user,
            ip: req.ip ?? req.socket.remoteAddress,
            userAgent: req.headers['user-agent'],
            severity, // redundant but useful for Coralogix filters
            traceId,
        });
        coralogix_1.coralogix.trace({
            traceId,
            operation: `${req.method} ${req.path}`,
            durationMs: duration,
            status: failed ? 'error' : 'ok',
            metadata: { method: req.method, path: req.path, statusCode: res.statusCode, user },
        });
    });
    next();
}
