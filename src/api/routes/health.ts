import { Router, Request, Response } from 'express';
import { EndpointDependencies } from '../types.js';
import { VERSION } from '../../app/version.js';
import { getCachedUpdateStatus } from '../../app/updates.js';

export function createHealthRouter(deps: EndpointDependencies): Router {
  const router = Router();

  router.get('/health', (req: Request, res: Response) => {
    const auth = deps.authManager?.getHealth() ?? {
      available: false,
      ...(deps.sessionNotice ? { notice: deps.sessionNotice } : {}),
    };

    const update = getCachedUpdateStatus();
    res.json({
      status: 'ok',
      version: VERSION,
      queue: {
        size: deps.queue.getSize(),
        pending: deps.queue.getPending(),
      },
      auth,
      update: {
        available: update.available,
        current: update.current,
        latest: update.latest,
        channel: update.channel,
      },
    });
  });

  return router;
}
