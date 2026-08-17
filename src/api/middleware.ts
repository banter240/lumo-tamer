import type { RequestHandler } from 'express';
import { logger } from '../app/logger.js';
import { getMetrics, type MetricsService } from '../app/metrics.js';

export function setupAuthMiddleware(apiKey: string): RequestHandler {
  return (req, res, next) => {
    // Skip API-key check for health, metrics, and the login page
    if (req.path === '/health' || req.path === '/metrics' || req.path === '/auth' || req.path.startsWith('/auth/')) {
      return next();
    }

    const key = req.headers.authorization?.replace('Bearer ', '');
    if (key !== apiKey) {
      getMetrics()?.authFailuresTotal.inc();
      return res.status(401).json({ error: 'Invalid API key' });
    }
    next();
  };
}

export function setupReadyMiddleware(isReady: () => boolean): RequestHandler {
  return (req, res, next) => {
    if (
      req.path === '/health' ||
      req.path === '/metrics' ||
      req.path === '/auth' ||
      req.path.startsWith('/auth/') ||
      req.path === '/v1/models'
    ) {
      return next();
    }
    if (isReady()) {
      return next();
    }
    return res.status(503).json({
      error: {
        message: 'Not authenticated. Open /auth in your browser and log in to Proton.',
        type: 'auth_required',
      },
    });
  };
}

export function setupLoggingMiddleware(): RequestHandler {
  return (req, res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  };
}

// Normalize paths to base endpoints for consistent labeling
function normalizeEndpoint(path: string): string {
  if (path.startsWith('/v1/responses')) return '/v1/responses';
  if (path.startsWith('/v1/chat/completions')) return '/v1/chat/completions';
  if (path.startsWith('/v1/models')) return '/v1/models';
  if (path.startsWith('/v1/auth')) return '/v1/auth';
  return path;
}

// Metrics middleware for request tracking
export function setupMetricsMiddleware(metrics: MetricsService): RequestHandler {
  return (req, res, next) => {
    const startTime = process.hrtime.bigint();

    res.on('finish', () => {
      const endpoint = normalizeEndpoint(req.path);
      const duration = Number(process.hrtime.bigint() - startTime) / 1e9;

      // Determine streaming from request body (if available)
      const streaming = req.body?.stream === true ? 'true' : 'false';

      metrics.httpRequestsTotal.inc({
        endpoint,
        method: req.method,
        status: res.statusCode.toString(),
        streaming,
      });

      metrics.httpRequestDuration.observe(
        { endpoint, method: req.method },
        duration
      );
    });

    next();
  };
}

