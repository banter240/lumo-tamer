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

export type AgentKind = 'lead' | 'worker';

export interface ExtraModel {
    id: string;
    model: string;
    reasoning?: 'none' | 'high';
    /** lead = chat orchestrator (no custom-tools MITM). Absent = worker. */
    agent?: AgentKind;
}

export interface ResolvedModel {
    id: string;
    tier: LumoModelTier;
    reasoning?: 'none' | 'high';
    agent?: AgentKind;
}

/**
 * Built-in model profiles (not extraModels aliases).
 * `lumo-lead` is a first-class id like lumo / lumo-lite / lumo-max; under the
 * hood it runs lumo-max with thinking and the lead agent profile.
 */
export const BUILTIN_MODEL_PROFILES: Readonly<Record<string, Omit<ResolvedModel, 'id'>>> = {
    'lumo-lead': { tier: 'lumo-max', reasoning: 'high', agent: 'lead' },
};

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
 * Map a request model id to a Proton tier and optional thinking override.
 * Unknown ids return null. Missing model uses defaultTier.
 * Built-in profiles (e.g. lumo-lead) win over extraModels when allowed.
 * extraModels still supports optional custom aliases, including agent: lead.
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
    const builtin = BUILTIN_MODEL_PROFILES[id];
    if (builtin && isModelAllowed(id, allowedModels)) {
        return { id, ...builtin };
    }
    const extra = extras.find((item) => normalizeModelId(item.id) === id);
    if (extra) {
        return {
            id: extra.id,
            tier: modelToTier(normalizeModelId(extra.model)),
            reasoning: extra.reasoning,
            agent: extra.agent,
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
 * Explicit effort wins. Else model/built-in reasoning pin. Else global default.
 * Built-in lumo-max (and lumo-lead → lumo-max) still thinks when nothing else is set.
 */
export function resolveReasoning(
    effort: string | null | undefined,
    defaultHigh: boolean,
    tier?: LumoModelTier,
    modelReasoning?: 'none' | 'high',
): boolean {
    if (effort !== undefined && effort !== null) {
        return effort !== 'none';
    }
    if (modelReasoning === 'high') return true;
    if (modelReasoning === 'none') return false;
    return defaultHigh || tier === 'lumo-max';
}
