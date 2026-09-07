import { describe, it, expect } from 'vitest';
import { normalizeModelId, modelToTier, isModelAllowed, isDefaultTierAllowed, resolveReasoning, isValidReasoningEffort, resolveModel, advertisedModelIds, BUILTIN_MODEL_PROFILES } from '../../src/lumo-client/model-tier.js';

describe('normalizeModelId', () => {
    it('lowercases, trims, and strips a provider prefix', () => {
        expect(normalizeModelId('  Lumo-Max ')).toBe('lumo-max');
        expect(normalizeModelId('proton/lumo-max')).toBe('lumo-max');
        expect(normalizeModelId(undefined)).toBe('');
    });
    it('returns empty string for non-string input (no throw)', () => {
        expect(normalizeModelId(42 as unknown)).toBe('');
        expect(normalizeModelId({} as unknown)).toBe('');
        expect(normalizeModelId(null)).toBe('');
    });
});

describe('isValidReasoningEffort', () => {
    it('accepts valid values and absent/null', () => {
        for (const e of ['none', 'low', 'medium', 'high', undefined, null]) {
            expect(isValidReasoningEffort(e)).toBe(true);
        }
    });
    it('rejects invalid values (including wrong case and non-strings)', () => {
        for (const e of ['NONE', 'HIGH', 'typo', '', 5, {}]) {
            expect(isValidReasoningEffort(e)).toBe(false);
        }
    });
});

describe('modelToTier', () => {
    it('maps model ids to tiers', () => {
        expect(modelToTier('lumo')).toBe('auto');
        expect(modelToTier('lumo-lite')).toBe('lumo-lite');
        expect(modelToTier('lumo-max')).toBe('lumo-max');
        expect(modelToTier('something-else')).toBe('auto');
    });
});

describe('isModelAllowed', () => {
    const allowed = ['lumo', 'lumo-lite', 'lumo-max', 'lumo-lead'];
    it('accepts allowed models (normalized) and rejects others', () => {
        expect(isModelAllowed('lumo-max', allowed)).toBe(true);
        expect(isModelAllowed(normalizeModelId('proton/lumo'), allowed)).toBe(true);
        expect(isModelAllowed('lumo-lead', allowed)).toBe(true);
        expect(isModelAllowed('gpt-4', allowed)).toBe(false);
    });
});

describe('isDefaultTierAllowed', () => {
    it('allows auto even if not listed', () => {
        expect(isDefaultTierAllowed('auto', ['lumo-lite'])).toBe(true);
    });
    it('requires a concrete default to be in allowedModels', () => {
        expect(isDefaultTierAllowed('lumo-max', ['lumo', 'lumo-lite'])).toBe(false);
        expect(isDefaultTierAllowed('lumo-max', ['lumo', 'lumo-max'])).toBe(true);
    });
});

describe('resolveReasoning', () => {
    it('maps reasoning_effort to a thinking-mode boolean', () => {
        expect(resolveReasoning('none', false)).toBe(false);
        expect(resolveReasoning('low', false)).toBe(true);
        expect(resolveReasoning('medium', false)).toBe(true);
        expect(resolveReasoning('high', false)).toBe(true);
    });
    it('falls back to the config default when absent', () => {
        expect(resolveReasoning(undefined, false)).toBe(false);
        expect(resolveReasoning(undefined, true)).toBe(true);
        expect(resolveReasoning(null, true)).toBe(true);
    });
    it('defaults lumo-max to thinking on when effort is omitted', () => {
        expect(resolveReasoning(undefined, false, 'lumo-max')).toBe(true);
        expect(resolveReasoning(null, false, 'lumo-max')).toBe(true);
        expect(resolveReasoning(undefined, false, 'lumo-lite')).toBe(false);
        expect(resolveReasoning(undefined, false, 'auto')).toBe(false);
    });
    it('still honors an explicit none on lumo-max', () => {
        expect(resolveReasoning('none', false, 'lumo-max')).toBe(false);
    });
    it('honors a per-model reasoning override when effort is omitted', () => {
        expect(resolveReasoning(undefined, false, 'lumo-lite', 'high')).toBe(true);
        expect(resolveReasoning(undefined, true, 'lumo-max', 'none')).toBe(false);
    });
});

describe('resolveModel / advertisedModelIds', () => {
    const allowed = ['lumo', 'lumo-lite', 'lumo-max', 'lumo-lead'];
    const extras = [
        { id: 'lumo-lite-thinking', model: 'lumo-lite', reasoning: 'high' as const },
        { id: 'lumo-max-fast', model: 'lumo-max', reasoning: 'none' as const },
        { id: 'my-lead', model: 'lumo-max', reasoning: 'high' as const, agent: 'lead' as const },
    ];

    it('lists extras after built-ins', () => {
        expect(advertisedModelIds(allowed, extras)).toEqual([
            'lumo', 'lumo-lite', 'lumo-max', 'lumo-lead', 'lumo-lite-thinking', 'lumo-max-fast', 'my-lead',
        ]);
    });

    it('maps an alias to a tier and reasoning pin', () => {
        const resolved = resolveModel('lumo-lite-thinking', allowed, extras, 'auto');
        expect(resolved).toEqual({ id: 'lumo-lite-thinking', tier: 'lumo-lite', reasoning: 'high' });
    });

    it('rejects unknown names', () => {
        expect(resolveModel('gpt-4', allowed, extras, 'auto')).toBeNull();
    });

    it('resolves built-in lumo-lead to lumo-max + thinking + lead', () => {
        expect(BUILTIN_MODEL_PROFILES['lumo-lead']).toEqual({
            tier: 'lumo-max',
            reasoning: 'high',
            agent: 'lead',
        });
        const resolved = resolveModel('lumo-lead', allowed, extras, 'auto');
        expect(resolved).toEqual({
            id: 'lumo-lead',
            tier: 'lumo-max',
            reasoning: 'high',
            agent: 'lead',
        });
        // Built-in wins even if a conflicting extraModels entry exists
        const withConflict = resolveModel(
            'lumo-lead',
            allowed,
            [{ id: 'lumo-lead', model: 'lumo', reasoning: 'none', agent: 'lead' }],
            'auto',
        );
        expect(withConflict).toEqual({
            id: 'lumo-lead',
            tier: 'lumo-max',
            reasoning: 'high',
            agent: 'lead',
        });
    });

    it('carries agent from optional extraModels aliases', () => {
        const resolved = resolveModel('my-lead', allowed, extras, 'auto');
        expect(resolved).toEqual({
            id: 'my-lead',
            tier: 'lumo-max',
            reasoning: 'high',
            agent: 'lead',
        });
        const worker = resolveModel('lumo-lite-thinking', allowed, extras, 'auto');
        expect(worker?.agent).toBeUndefined();
    });
});
