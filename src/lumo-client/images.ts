/**
 * Image input support (vision).
 *
 * Mirrors Proton's web client:
 * - WebClients packages/lumo-api-client/core/encryption.ts (encryptImage): image bytes are
 *   AES-GCM encrypted with the same per-request key and request AD as the turn text,
 *   so images get the same U2L protection as message content.
 * - WebClients applications/lumo/src/app/llm/attachments.ts: supported MIME types and
 *   the "only the most recent N images per request" rule.
 *
 * Kept local (instead of editing the vendored encryption.ts) so a future upstream
 * sync of packages/lumo can replace it without patch conflicts.
 */

import { createHash } from 'node:crypto';
import type { WireImage } from '@lumo/types-api.js';
import type { RequestEncryptionParams } from '@lumo/lib/lumo-api-client/core/encryptionParams.js';
import { Role, type Turn } from './types.js';

/** Upstream MAX_IMAGES_PER_REQUEST: older images beyond this are dropped. */
export const MAX_IMAGES_PER_REQUEST = 10;

/** MIME types accepted by the Lumo web client for image attachments. */
export const SUPPORTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

const DATA_URL_RE = /^data:([^;,]+)((?:;[^;,]+)*?);base64,(.*)$/s;

export type ParsedImage =
    | { ok: true; image: WireImage; mimeType: string }
    | { ok: false; reason: string };

/**
 * Parse an OpenAI image reference (`data:image/...;base64,...`) into a plaintext WireImage.
 * Remote http(s) URLs are rejected on purpose: fetching arbitrary URLs from the proxy
 * would be an SSRF vector, and OpenAI-compatible clients (OpenCode, etc.) send data URLs.
 */
export function parseImageUrl(url: unknown): ParsedImage {
    if (typeof url !== 'string' || url.length === 0) {
        return { ok: false, reason: 'missing image url' };
    }
    const match = DATA_URL_RE.exec(url);
    if (!match) {
        return { ok: false, reason: 'only base64 data: URLs are supported for images' };
    }
    const mimeType = match[1].toLowerCase();
    if (!SUPPORTED_IMAGE_MIME_TYPES.includes(mimeType)) {
        return { ok: false, reason: `unsupported image type ${mimeType}` };
    }
    const data = match[3].replace(/\s+/g, '');
    if (!data) {
        return { ok: false, reason: 'empty image data' };
    }
    if (!isStrictBase64(data)) {
        return { ok: false, reason: 'invalid base64 image data' };
    }
    return { ok: true, mimeType, image: { encrypted: false, image_id: stableImageId(data), data } };
}

/** Canonical padded base64 only (Buffer.from(..., 'base64') silently skips garbage). */
export function isStrictBase64(data: string): boolean {
    return data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(data);
}

/** Total base64 characters of image payloads (used to keep them out of token estimates). */
export function imagePayloadChars(turns: Turn[]): number {
    return turns.reduce((n, t) => n + (t.images ?? []).reduce((m, im) => m + im.data.length, 0), 0);
}

/**
 * Deterministic UUID-shaped id from the image bytes. Clients resend the whole history
 * on every request, so a stable id keeps markers (and conversation dedup hashes)
 * identical across requests and lets Lumo refer back to the same image.
 */
export function stableImageId(base64: string): string {
    const h = createHash('sha256').update(base64).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Upstream lumoImageMarker (WebClients packages/lumo-api-client/utils.ts). The backend
 * zips these markers with the image_url parts of the same turn, which is how
 * edit_image / describe_image find an earlier image.
 */
export function lumoImageMarker(id: string, source: 'user' | 'assistant', name?: string): string {
    const nameAttr = name ? ` name="${encodeURIComponent(name)}"` : '';
    return `<lumo-image id="${encodeURIComponent(id)}" source="${encodeURIComponent(source)}"${nameAttr} />`;
}

/** MIME type from the magic bytes of a base64 payload (same table as v2-body). */
export function inferImageMimeType(base64: string): string {
    if (base64.startsWith('iVBORw0KGgo')) return 'image/png';
    if (base64.startsWith('/9j/')) return 'image/jpeg';
    if (base64.startsWith('R0lGOD')) return 'image/gif';
    if (base64.startsWith('UklGR')) return 'image/webp';
    return 'image/png';
}

/** Markdown for a generated image sent to the client (format documented in the README). */
export function generatedImageMarkdown(imageId: string, base64: string): string {
    return `\n\n![lumo:${imageId}](data:${inferImageMimeType(base64)};base64,${base64})\n\n`;
}

const GENERATED_IMAGE_MD_RE = /!\[lumo:([^\]\s]+)\]\(data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)\)/g;

/**
 * Turn generated-image markdown that a client echoes back in an assistant message
 * into Lumo's own representation: a `<lumo-image source="assistant">` marker in the
 * text plus the bytes as a WireImage, exactly how the web client replays generated
 * images. Keeps megabytes of base64 out of the prompt text and enables edit_image.
 */
export function extractGeneratedImages(text: string): { content: string; images: WireImage[] } {
    const images: WireImage[] = [];
    const content = text.replace(GENERATED_IMAGE_MD_RE, (_m, id: string, _mime: string, data: string) => {
        images.push({ encrypted: false, image_id: id, data: data.replace(/\s+/g, '') });
        return lumoImageMarker(id, 'assistant');
    });
    return { content: images.length > 0 ? content.replace(/\n{3,}/g, '\n\n').trim() : text, images };
}

/** Decode a base64 payload into bytes and back (normalizes / validates base64). */
export function bytesToBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

/**
 * Keep only the most recent `max` images across the conversation (upstream rule).
 * Older images are dropped; text is untouched.
 */
export function limitImages<T extends Turn>(turns: T[], max = MAX_IMAGES_PER_REQUEST): T[] {
    let budget = max;
    const result = new Array<T>(turns.length);
    for (let i = turns.length - 1; i >= 0; i--) {
        const turn = turns[i];
        if (!turn.images || turn.images.length === 0) {
            result[i] = turn;
            continue;
        }
        const keep = budget > 0 ? turn.images.slice(-budget) : [];
        budget -= keep.length;
        if (keep.length === turn.images.length) {
            result[i] = turn;
        } else {
            const { images: _dropped, ...rest } = turn;
            result[i] = (keep.length > 0 ? { ...rest, images: keep } : rest) as T;
        }
    }
    return result;
}

/** Remove images from all turns (e.g. for title generation, which only needs text). */
export function stripImages(turns: Turn[]): Turn[] {
    return turns.map((turn) => {
        if (!turn.images) return turn;
        const { images: _images, ...rest } = turn;
        return rest;
    });
}

export function countImages(turns: Turn[]): number {
    return turns.reduce((n, t) => n + (t.images?.length ?? 0), 0);
}

/** Base64 -> bytes (Node Buffer, no atob dependency). */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
    const buf = Buffer.from(base64, 'base64');
    const out = new Uint8Array(new ArrayBuffer(buf.length));
    out.set(buf);
    return out;
}

/** Encrypt one image with the request key + request AD (upstream encryptImage). */
async function encryptImage(image: WireImage, encryption: RequestEncryptionParams): Promise<WireImage> {
    if (image.encrypted) return image;
    const encryptedData = await encryption.encryptUint8Array(base64ToBytes(image.data));
    return { ...image, data: encryptedData, encrypted: true };
}

/**
 * Encrypt the images of turns whose text has already been U2L-encrypted.
 * The vendored encryptTurns() only encrypts `content`; this completes it so no
 * plaintext image ever leaves the proxy when encryption is enabled.
 */
export async function encryptTurnImages<T extends Turn>(turns: T[], encryption: RequestEncryptionParams): Promise<T[]> {
    return Promise.all(
        turns.map(async (turn) => {
            if (!turn.images || turn.images.length === 0) return turn;
            const images = await Promise.all(turn.images.map((im) => encryptImage(im, encryption)));
            return { ...turn, images };
        }),
    );
}

/** Words that signal the user wants a picture made (fr/en/es/de/it/pt). */
const IMAGE_INTENT_RE = new RegExp(
    '(?<!\\p{L})(?:' + [
        'images?', 'img', 'pictures?', 'pics?', 'photos?', 'fotos?',
        'illustr\\p{L}*', 'dessin\\p{L}*', 'dessine\\p{L}*', 'draw\\p{L}*', 'drew',
        'sketch\\p{L}*', 'croquis', 'peins', 'peindre', 'peinture\\p{L}*', 'paint\\p{L}*',
        'logos?', 'wallpapers?', "fonds? d['’]\\s?écran", 'posters?', 'affiches?',
        'portraits?', 'avatars?', 'artwork', 'imagen\\p{L}*', 'imagem\\p{L}*', 'immagin\\p{L}*',
        'bild\\p{L}*', 'zeichne\\p{L}*', 'dibuj\\p{L}*', 'disegn\\p{L}*', 'desenh\\p{L}*',
    ].join('|') + ')(?!\\p{L})',
    'iu',
);

const MARKER_RE = /<lumo-image\b[^>]*\/>|\[Image omitted:[^\]]*\]/g;
const TOOL_RESULT_PREFIX = '[Tool Result:';

function isGenuineUserTurn(turn: Turn): boolean {
    return turn.role === Role.User && !(turn.content ?? '').startsWith(TOOL_RESULT_PREFIX);
}

/**
 * Whether to advertise Lumo's image tools on this request.
 *
 * The web client only talks to Lumo with a human typing, but agent clients (OpenCode)
 * send many requests per user message: every tool-loop step, bounces, a huge system
 * prompt. Offering generate_image on all of them makes Lumo draw images nobody asked
 * for. So the tools are only offered when:
 * - the last real user message attached images, or asks for a picture, or follows up
 *   on a conversation that already has images (e.g. "make it blue");
 * - and no image was generated since that message (no re-drawing on tool-loop steps).
 */
export function shouldOfferImageTools(turns: Turn[]): boolean {
    let g = turns.length - 1;
    while (g >= 0 && !isGenuineUserTurn(turns[g])) g--;
    if (g < 0) return false;

    const after = turns.slice(g + 1);
    if (after.some((t) => t.role === Role.Assistant && (t.images?.length ?? 0) > 0)) return false;

    const user = turns[g];
    if ((user.images?.length ?? 0) > 0) return true;

    const text = (user.content ?? '').replace(MARKER_RE, ' ');
    if (IMAGE_INTENT_RE.test(text)) return true;

    // Follow-up on an existing image ("make it blue"): only when this is the user's own
    // turn, not a later step of a tool loop.
    const latestIsUser = g === turns.length - 1;
    return latestIsUser && turns.slice(0, g).some((t) => (t.images?.length ?? 0) > 0);
}

/** Safety net: true if any image would be sent in plaintext. */
export function hasPlaintextImages(turns: Turn[]): boolean {
    return turns.some((t) => t.images?.some((im) => !im.encrypted) ?? false);
}
