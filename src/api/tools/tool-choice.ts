import { interpolateTemplate } from '../../app/template.js';
import { getServerInstructionsConfig } from '../../app/config.js';
import type { OpenAITool } from '../types.js';

export type ResolvedToolChoice =
    | { mode: 'auto' }
    | { mode: 'none' }
    | { mode: 'required' }
    | { mode: 'named'; name: string };

export function parseToolChoice(value: unknown): ResolvedToolChoice {
    if (value === undefined || value === null || value === 'auto') {
        return { mode: 'auto' };
    }
    if (value === 'none') {
        return { mode: 'none' };
    }
    if (value === 'required') {
        return { mode: 'required' };
    }
    if (typeof value === 'object' && value !== null) {
        const obj = value as { type?: unknown; function?: { name?: unknown } };
        if (obj.type === 'function' && typeof obj.function?.name === 'string' && obj.function.name) {
            return { mode: 'named', name: obj.function.name };
        }
    }
    throw new Error('Invalid tool_choice');
}

/** Tools to advertise to Lumo after honoring tool_choice. */
export function toolsForChoice(tools: OpenAITool[] | undefined, choice: ResolvedToolChoice): OpenAITool[] | undefined {
    if (!tools?.length || choice.mode === 'none') {
        return undefined;
    }
    if (choice.mode === 'named') {
        const match = tools.filter((t) => t.function?.name === choice.name);
        return match.length > 0 ? match : undefined;
    }
    return tools;
}

export function toolChoiceInstruction(choice: ResolvedToolChoice): string | undefined {
    const cfg = getServerInstructionsConfig();
    if (choice.mode === 'required') {
        return cfg.forToolRequired;
    }
    if (choice.mode === 'named') {
        return interpolateTemplate(cfg.forToolNamed, { name: choice.name });
    }
    return undefined;
}
