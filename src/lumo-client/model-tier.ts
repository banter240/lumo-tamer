/**
 * Maps the inbound OpenAI `model` field to a Lumo tier, and the inbound
 * `reasoning_effort` to a thinking-mode boolean.
 */

import type { LumoModelTier } from './types.js';

/**
 * Normalize a client-supplied model id: lowercase, trimmed, and stripped of any
 * provider prefix (e.g. "proton/lumo-max" -> "lumo-max").
 */
export function normalizeModelId(model?: unknown): string {
    if (typeof model !== 'string') {
        return '';
    }
    const lower = model.trim().toLowerCase();
    const slash = lower.lastIndexOf('/');
    return slash >= 0 ? lower.slice(slash + 1) : lower;
}

/** Valid inbound reasoning_effort values (plus absent/null meaning "use default"). */
export const VALID_REASONING_EFFORTS = ['none', 'low', 'medium', 'high'] as const;

/** True if the effort is absent/null or one of the valid string values. */
export function isValidReasoningEffort(effort: unknown): boolean {
    return effort === undefined || effort === null
        || (typeof effort === 'string' && (VALID_REASONING_EFFORTS as readonly string[]).includes(effort));
}

/** Map a normalized model id to a tier. `lumo`/`auto`/unknown-ish -> 'auto'. */
export function modelToTier(normalizedModel: string): LumoModelTier {
    switch (normalizedModel) {
        case 'lumo-lite':
            return 'lumo-lite';
        case 'lumo-max':
            return 'lumo-max';
        default:
            return 'auto';
    }
}

export interface ExtraModel {
    id: string;
    model: string;
    reasoning?: 'none' | 'high';
    /** Force the reasoning mode, ignoring an explicit client reasoning_effort. */
    pinned?: boolean;
}

export interface ResolvedModel {
    id: string;
    tier: LumoModelTier;
    reasoning?: 'none' | 'high';
    pinned?: boolean;
}

/** True if the normalized model is in the allowed list (also normalized). */
export function isModelAllowed(normalizedModel: string, allowedModels: string[]): boolean {
    return allowedModels.some((m) => normalizeModelId(m) === normalizedModel);
}

export function advertisedModelIds(allowedModels: string[], extras: ExtraModel[] = []): string[] {
    const ids = [...allowedModels];
    for (const extra of extras) {
        const id = extra.id?.trim();
        if (!id) continue;
        if (!ids.some((item) => normalizeModelId(item) === normalizeModelId(id))) {
            ids.push(id);
        }
    }
    return ids;
}

/**
 * Auto-generate a `-thinking` variant for every allowed model. Each variant
 * pins reasoning to high, so it thinks even when the client explicitly sends
 * reasoning_effort "none" (e.g. OpenCode's per-model toggle). Ids already
 * defined by user-configured extraModels are not duplicated.
 */
export function buildThinkingVariants(allowedModels: string[], userExtras: ExtraModel[] = []): ExtraModel[] {
    const taken = new Set(userExtras.map((extra) => normalizeModelId(extra.id)));
    const variants: ExtraModel[] = [];
    for (const model of allowedModels) {
        const base = normalizeModelId(model);
        if (!base || taken.has(`${base}-thinking`)) continue;
        variants.push({ id: `${base}-thinking`, model: base, reasoning: 'high', pinned: true });
    }
    return variants;
}

/** User extras plus the auto-generated thinking variants (when enabled). */
export function effectiveExtras(
    allowedModels: string[],
    extras: ExtraModel[] = [],
    autoVariants = true,
): ExtraModel[] {
    return autoVariants ? [...extras, ...buildThinkingVariants(allowedModels, extras)] : extras;
}

/**
 * Map a request model id to a Proton tier and optional thinking override.
 * Unknown ids return null. Missing model uses defaultTier.
 */
export function resolveModel(
    rawModel: unknown,
    allowedModels: string[],
    extras: ExtraModel[],
    defaultTier: LumoModelTier,
): ResolvedModel | null {
    if (rawModel === undefined || rawModel === null || rawModel === '') {
        return { id: '', tier: defaultTier };
    }
    if (typeof rawModel !== 'string') {
        return null;
    }
    const id = normalizeModelId(rawModel);
    const extra = extras.find((item) => normalizeModelId(item.id) === id);
    if (extra) {
        return {
            id: extra.id,
            tier: modelToTier(normalizeModelId(extra.model)),
            reasoning: extra.reasoning,
            pinned: extra.pinned,
        };
    }
    if (isModelAllowed(id, allowedModels)) {
        return { id, tier: modelToTier(id) };
    }
    return null;
}

/** True if defaultModelTier is "auto" or listed in allowedModels. */
export function isDefaultTierAllowed(defaultModelTier: string, allowedModels: string[]): boolean {
    return defaultModelTier === 'auto' || isModelAllowed(defaultModelTier, allowedModels);
}

/**
 * Resolve the inbound reasoning_effort to a thinking-mode boolean.
 * Pinned models (auto thinking variants, extraModels with pinned: true)
 * force their mode, ignoring the client effort. Otherwise explicit effort
 * wins. Else extraModels[].reasoning. Else global default. Built-in lumo-max
 * still thinks when nothing else is set (Proton Max).
 */
export function resolveReasoning(
    effort: string | null | undefined,
    defaultHigh: boolean,
    tier?: LumoModelTier,
    modelReasoning?: 'none' | 'high',
    pinned?: boolean,
): boolean {
    if (pinned && modelReasoning !== undefined) {
        return modelReasoning === 'high';
    }
    if (effort !== undefined && effort !== null) {
        return effort !== 'none';
    }
    if (modelReasoning === 'high') return true;
    if (modelReasoning === 'none') return false;
    return defaultHigh || tier === 'lumo-max';
}
