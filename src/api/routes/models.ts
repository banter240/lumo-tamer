import { Router, Request, Response } from 'express';
import { getServerConfig } from '../../app/config.js';
import { advertisedModelIds } from '../../lumo-client/model-tier.js';

const MODEL_CREATED = 1700000000;

function modelCard(id: string) {
  return {
    id,
    object: 'model' as const,
    created: MODEL_CREATED,
    owned_by: 'proton',
  };
}

export function createModelsRouter(): Router {
  const router = Router();
  const serverConfig = getServerConfig();
  const advertised = advertisedModelIds(serverConfig.allowedModels, serverConfig.extraModels);

  router.get('/v1/models', (_req: Request, res: Response) => {
    res.json({
      object: 'list',
      data: advertised.map(modelCard),
    });
  });

  router.get('/v1/models/:id', (req: Request, res: Response) => {
    const id = decodeURIComponent(req.params.id);
    const allowed = advertised;
    const match = allowed.find((m) => m === id || m === id.split('/').pop());
    if (!match) {
      res.status(404).json({
        error: { message: `The model '${id}' does not exist`, type: 'invalid_request_error', code: 'model_not_found' },
      });
      return;
    }
    res.json(modelCard(match));
  });

  return router;
}
