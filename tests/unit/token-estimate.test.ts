import { describe, it, expect } from 'vitest';
import {
  AUTO_BYTES_PER_TOKEN,
  AUTO_TOKEN_CALIBRATION,
  estimatePromptTokens,
} from '../../src/app/token-estimate.js';

describe('estimatePromptTokens', () => {
  it('returns 0 when off', () => {
    expect(estimatePromptTokens(1000, 'off')).toBe(0);
  });

  it('uses 4/1.45 as the auto divisor so factor 1.0 is the 1.45 baseline', () => {
    expect(AUTO_TOKEN_CALIBRATION).toBe(1.45);
    expect(AUTO_BYTES_PER_TOKEN).toBeCloseTo(4 / 1.45);
    expect(estimatePromptTokens(400, 'auto', 1)).toBe(Math.ceil(400 / (4 / 1.45)));
    expect(estimatePromptTokens(400, 'auto', 1)).toBe(145);
  });

  it('applies factor on top of auto 1.45, not on top of naive /4', () => {
    const auto = estimatePromptTokens(400, 'auto', 1);
    const tuned = estimatePromptTokens(400, 'auto', 0.9);
    expect(auto).toBe(145);
    expect(tuned).toBe(Math.ceil(145 * 0.9));
    expect(tuned).not.toBe(Math.ceil((400 / 4) * 0.9));
  });

  it('does not bake 1.45 into a manual divisor', () => {
    expect(estimatePromptTokens(400, 4, 1)).toBe(100);
  });
});
