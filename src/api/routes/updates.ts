/**
 * GET  /v1/update  — GitHub check (cached)
 * POST /v1/update  — pull GHCR and recreate this container
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../app/logger.js';
import { clientIp, createAttemptGate } from '../attempt-limit.js';
import { AUTH } from '../../app/const.js';
import {
  applyUpdate,
  checkForUpdate,
  getCachedUpdateStatus,
} from '../../app/updates.js';

const allowApply = createAttemptGate(AUTH.UPDATE_APPLY_MAX_ATTEMPTS);

export function createUpdatesRouter(): Router {
  const router = Router();

  router.get('/v1/update', async (req: Request, res: Response) => {
    try {
      const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const cached = getCachedUpdateStatus();
      const status = refresh || !cached.checkedAt
        ? await checkForUpdate()
        : cached;
      res.json(status);
    } catch (error) {
      logger.warn({ error }, 'GET /v1/update failed');
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Update check failed',
      });
    }
  });

  router.post('/v1/update', async (req: Request, res: Response) => {
    if (!allowApply(clientIp(req))) {
      res.status(429).json({ error: 'Too many update attempts. Wait a few minutes.' });
      return;
    }
    try {
      const result = await applyUpdate();
      res.status(result.ok ? 200 : 409).json(result);
    } catch (error) {
      logger.error({ error }, 'POST /v1/update failed');
      res.status(502).json({
        error: error instanceof Error ? error.message : 'Update apply failed',
      });
    }
  });

  return router;
}
