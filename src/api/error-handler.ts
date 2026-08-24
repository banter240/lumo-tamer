import type { ErrorRequestHandler, Response } from 'express';
import { logger } from '../app/logger.js';

// ============================================
// OpenAI-compatible error response helpers
// ============================================

interface OpenAIErrorBody {
  error: {
    message: string;
    type: 'invalid_request_error' | 'server_error';
    param: string | null;
    code: string | null;
  };
}

export function sendInvalidRequest(
  res: Response,
  message: string,
  param: string | null = null,
  code: string | null = 'invalid_request'
): Response<OpenAIErrorBody> {
  return res.status(400).json({
    error: {
      message,
      type: 'invalid_request_error',
      param,
      code,
    },
  });
}

export function sendServerError(
  res: Response,
  message = 'The server encountered an error while processing your request.'
): Response<OpenAIErrorBody> {
  return res.status(500).json({
    error: {
      message,
      type: 'server_error',
      param: null,
      code: null,
    },
  });
}

// ============================================
// Express error handler middleware
// ============================================

function isPayloadTooLarge(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { status?: number; statusCode?: number; type?: string };
  return candidate.status === 413 || candidate.statusCode === 413 || candidate.type === 'entity.too.large';
}

function isInvalidJsonBody(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { status?: number; type?: string; body?: unknown };
  return candidate.status === 400 && candidate.type === 'entity.parse.failed' && candidate.body !== undefined;
}

export function sendAuthRequired(
  res: Response
): Response<OpenAIErrorBody> {
  return res.status(401).json({
    error: {
      message: 'Authentication expired or invalid. Open /auth in your browser and log in to Proton again.',
      type: 'invalid_request_error',
      param: null,
      code: 'auth_required',
    },
  });
}

export function isAuthError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { status?: number; Code?: number };
  return candidate.status === 401 || candidate.Code === 401;
}

export const setupApiErrorHandler = (): ErrorRequestHandler => {
  return (err, _req, res, next) => {
    if (isAuthError(err)) {
      logger.warn({ err }, 'Auth error in request - session may be invalid');
      return sendAuthRequired(res);
    }

    if (isPayloadTooLarge(err)) {
      logger.warn({ err }, 'Request body exceeds parser limit');
      return res.status(413).json({
        error: {
          message: 'Request body too large for this server. Reduce payload size or increase server.bodyLimit',
          type: 'invalid_request_error',
          param: null,
          code: 'request_too_large',
        },
      });
    }

    if (isInvalidJsonBody(err)) {
      logger.warn({ err }, 'Malformed JSON request body');
      return res.status(400).json({
        error: {
          message: 'Malformed JSON in request body.',
          type: 'invalid_request_error',
          param: null,
          code: 'invalid_json',
        },
      });
    }

    return next(err);
  };
};
