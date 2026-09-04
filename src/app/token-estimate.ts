/**
 * Proton does not report prompt_tokens. Estimate from UTF-8 byte length.
 *
 * auto: TOKEN_ESTIMATE in const.ts (4 bytes/token × 1.45).
 * Factor 1.0 = that baseline. 0.9 = 90% of auto, not 90% of naive /4.
 * number: raw chars-per-token divisor, no 1.45 baked in.
 * off: 0.
 */

import { TOKEN_ESTIMATE } from './const.js';

export const AUTO_TOKEN_CALIBRATION = TOKEN_ESTIMATE.AUTO_CALIBRATION;
export const AUTO_BYTES_PER_TOKEN =
  TOKEN_ESTIMATE.NAIVE_BYTES_PER_TOKEN / TOKEN_ESTIMATE.AUTO_CALIBRATION;

export type PromptTokenEstimator = 'auto' | 'off' | number;

export function estimatePromptTokens(
  utf8Bytes: number,
  estimator: PromptTokenEstimator,
  factor = 1,
): number {
  if (estimator === 'off') return 0;
  const bytesPerToken = typeof estimator === 'number' ? estimator : AUTO_BYTES_PER_TOKEN;
  return Math.ceil((utf8Bytes / bytesPerToken) * factor);
}
