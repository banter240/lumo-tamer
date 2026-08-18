import { interpolateTemplate } from '../app/template.js';
import { getServerInstructionsConfig } from '../app/config.js';

export type JsonResponseFormat =
    | { kind: 'json_object' }
    | { kind: 'json_schema'; schema: unknown; name?: string };

export function parseResponseFormat(value: unknown): JsonResponseFormat | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== 'object') {
        throw new Error('response_format must be an object');
    }
    const obj = value as { type?: unknown; json_schema?: unknown; schema?: unknown };
    if (obj.type === 'text' || obj.type === undefined) {
        return undefined;
    }
    if (obj.type === 'json_object') {
        return { kind: 'json_object' };
    }
    if (obj.type === 'json_schema') {
        const spec = (obj.json_schema && typeof obj.json_schema === 'object')
            ? obj.json_schema as { schema?: unknown; name?: string }
            : undefined;
        const schema = spec?.schema ?? obj.schema;
        if (schema === undefined) {
            throw new Error('response_format.json_schema.schema is required');
        }
        return { kind: 'json_schema', schema, name: spec?.name };
    }
    throw new Error(`Unsupported response_format.type '${String(obj.type)}'`);
}

export function buildJsonFormatInstruction(format: JsonResponseFormat): string {
    const template = getServerInstructionsConfig().forJsonFormat;
    const schema = format.kind === 'json_schema'
        ? JSON.stringify(format.schema, null, 2)
        : 'a JSON object';
    return interpolateTemplate(template, {
        schema,
        name: format.kind === 'json_schema' ? (format.name ?? '') : '',
    });
}

/** Strip markdown fences and leading chatter so clients get parseable JSON. */
export function stripJsonFences(text: string): string {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```$/);
    if (fenced) {
        return fenced[1].trim();
    }
    const firstBrace = trimmed.indexOf('{');
    const firstBracket = trimmed.indexOf('[');
    const startCandidates = [firstBrace, firstBracket].filter((i) => i >= 0);
    if (startCandidates.length === 0) {
        return trimmed;
    }
    const start = Math.min(...startCandidates);
    const endBrace = trimmed.lastIndexOf('}');
    const endBracket = trimmed.lastIndexOf(']');
    const end = Math.max(endBrace, endBracket);
    if (end > start) {
        return trimmed.slice(start, end + 1);
    }
    return trimmed;
}
