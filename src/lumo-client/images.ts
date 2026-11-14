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

import { createHash } from "node:crypto";
import type { WireImage } from "@lumo/types-api.js";
import type { RequestEncryptionParams } from "@lumo/lib/lumo-api-client/core/encryptionParams.js";
import { Role, type ToolName, type Turn } from "./types.js";

/** Upstream MAX_IMAGES_PER_REQUEST: older images beyond this are dropped. */
export const MAX_IMAGES_PER_REQUEST = 10;

/** MIME types accepted by the Lumo web client for image attachments. */
export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
];

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
  if (typeof url !== "string" || url.length === 0) {
    return { ok: false, reason: "missing image url" };
  }
  const match = DATA_URL_RE.exec(url);
  if (!match) {
    return {
      ok: false,
      reason: "only base64 data: URLs are supported for images",
    };
  }
  const mimeType = match[1].toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.includes(mimeType)) {
    return { ok: false, reason: `unsupported image type ${mimeType}` };
  }
  const data = match[3].replace(/\s+/g, "");
  if (!data) {
    return { ok: false, reason: "empty image data" };
  }
  if (!isStrictBase64(data)) {
    return { ok: false, reason: "invalid base64 image data" };
  }
  return {
    ok: true,
    mimeType,
    image: { encrypted: false, image_id: stableImageId(data), data },
  };
}

/** Canonical padded base64 only (Buffer.from(..., 'base64') silently skips garbage). */
export function isStrictBase64(data: string): boolean {
  return data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(data);
}

/** Total base64 characters of image payloads (used to keep them out of token estimates). */
export function imagePayloadChars(turns: Turn[]): number {
  return turns.reduce(
    (n, t) => n + (t.images ?? []).reduce((m, im) => m + im.data.length, 0),
    0,
  );
}

/**
 * Deterministic UUID-shaped id from the image bytes. Clients resend the whole history
 * on every request, so a stable id keeps markers (and conversation dedup hashes)
 * identical across requests and lets Lumo refer back to the same image.
 */
export function stableImageId(base64: string): string {
  const h = createHash("sha256").update(base64).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Upstream lumoImageMarker (WebClients packages/lumo-api-client/utils.ts). The backend
 * zips these markers with the image_url parts of the same turn, which is how
 * edit_image / describe_image find an earlier image.
 */
export function lumoImageMarker(
  id: string,
  source: "user" | "assistant",
  name?: string,
): string {
  const nameAttr = name ? ` name="${encodeURIComponent(name)}"` : "";
  return `<lumo-image id="${encodeURIComponent(id)}" source="${encodeURIComponent(source)}"${nameAttr} />`;
}

/** MIME type from the magic bytes of a base64 payload (same table as v2-body). */
export function inferImageMimeType(base64: string): string {
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  if (base64.startsWith("UklGR")) return "image/webp";
  return "image/png";
}

/** Markdown for a generated image sent to the client (format documented in the README). */
export function generatedImageMarkdown(
  imageId: string,
  base64: string,
): string {
  return `\n\n![lumo:${imageId}](data:${inferImageMimeType(base64)};base64,${base64})\n\n`;
}

const GENERATED_IMAGE_MD_RE =
  /!\[lumo:([^\]\s]+)\]\(data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)\)/g;

/**
 * Turn generated-image markdown that a client echoes back in an assistant message
 * into Lumo's own representation: a `<lumo-image source="assistant">` marker in the
 * text plus the bytes as a WireImage, exactly how the web client replays generated
 * images. Keeps megabytes of base64 out of the prompt text and enables edit_image.
 */
export function extractGeneratedImages(text: string): {
  content: string;
  images: WireImage[];
} {
  const images: WireImage[] = [];
  const content = text.replace(
    GENERATED_IMAGE_MD_RE,
    (_m, id: string, _mime: string, data: string) => {
      images.push({
        encrypted: false,
        image_id: id,
        data: data.replace(/\s+/g, ""),
      });
      return lumoImageMarker(id, "assistant");
    },
  );
  return {
    content:
      images.length > 0 ? content.replace(/\n{3,}/g, "\n\n").trim() : text,
    images,
  };
}

/** Decode a base64 payload into bytes and back (normalizes / validates base64). */
export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    "base64",
  );
}

/**
 * Keep only the most recent `max` images across the conversation (upstream rule).
 * Older images are dropped; text is untouched.
 */
export function limitImages<T extends Turn>(
  turns: T[],
  max = MAX_IMAGES_PER_REQUEST,
): T[] {
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
  const buf = Buffer.from(base64, "base64");
  const out = new Uint8Array(new ArrayBuffer(buf.length));
  out.set(buf);
  return out;
}

/** Encrypt one image with the request key + request AD (upstream encryptImage). */
async function encryptImage(
  image: WireImage,
  encryption: RequestEncryptionParams,
): Promise<WireImage> {
  if (image.encrypted) return image;
  const encryptedData = await encryption.encryptUint8Array(
    base64ToBytes(image.data),
  );
  return { ...image, data: encryptedData, encrypted: true };
}

/**
 * Encrypt the images of turns whose text has already been U2L-encrypted.
 * The vendored encryptTurns() only encrypts `content`; this completes it so no
 * plaintext image ever leaves the proxy when encryption is enabled.
 */
export async function encryptTurnImages<T extends Turn>(
  turns: T[],
  encryption: RequestEncryptionParams,
): Promise<T[]> {
  return Promise.all(
    turns.map(async (turn) => {
      if (!turn.images || turn.images.length === 0) return turn;
      const images = await Promise.all(
        turn.images.map((im) => encryptImage(im, encryption)),
      );
      return { ...turn, images };
    }),
  );
}

const words = (list: string[]) =>
  "(?<!\\p{L})(?:" + list.join("|") + ")(?!\\p{L})";

/** Verbs that ask for a picture on their own ("dessine un chat", "draw a cat"). */
const DRAW_VERBS = [
  "dessine\\p{L}*",
  "dessiner",
  "draw",
  "draws",
  "drawing",
  "drew",
  "sketch\\p{L}*",
  "illustre\\p{L}*",
  "illustrate\\p{L}*",
  "peins",
  "peignez",
  "peindre",
  "paint",
  "paints",
  "painting",
  "pinta\\p{L}*",
  "pinte\\p{L}*",
  "malen",
  "male(?=\\s+(?:ein|mir))",
  "zeichne\\p{L}*",
  "dibuj\\p{L}*",
  "disegna\\p{L}*",
  "desenh\\p{L}*",
];

/** Verbs that ask for a picture when an image noun follows ("génère une image"). */
const CREATE_VERBS = [
  "g[ée]n[èée]r\\p{L}*",
  "cr[ée]e[rsz]?",
  "fais",
  "faites",
  "faire",
  "imagine\\p{L}*",
  "produi\\p{L}*",
  "make",
  "makes",
  "create\\p{L}*",
  "generate\\p{L}*",
  "design\\p{L}*",
  "render",
  "genera\\p{L}*",
  "crea\\p{L}*",
  "haz",
  "erstell\\p{L}*",
  "generier\\p{L}*",
  "mach\\p{L}*",
  "gera\\p{L}*",
  "cria\\p{L}*",
  "fa[cç]a",
];

const IMAGE_NOUNS = [
  "images?",
  "img",
  "pictures?",
  "pics?",
  "photos?",
  "fotos?",
  "illustrations?",
  "dessins?",
  "drawings?",
  "paintings?",
  "peintures?",
  "sketch(?:es)?",
  "logos?",
  "ic[oô]nes?",
  "icons?",
  "wallpapers?",
  "fonds? d['’]\\s?[ée]cran",
  "posters?",
  "affiches?",
  "portraits?",
  "avatars?",
  "artwork",
  "imagen(?:es)?",
  "imagens?",
  "immagin[ei]",
  "bild(?:er)?",
  "disegno",
  "dibujo",
  "desenho",
];

const DRAW_RE = new RegExp(words(DRAW_VERBS), "iu");
const CREATE_IMAGE_RE = new RegExp(
  words(CREATE_VERBS) + "[^.?!\\n]{0,40}?" + words(IMAGE_NOUNS),
  "iu",
);
/** "docker image", "image de base"...: not pictures. */
const NOT_A_PICTURE_RE =
  /(?:docker|container|conteneur|oci|disk|disque|iso|vm|base|os|system|syst[eè]me)\s+images?|images?\s+(?:docker|de\s+base|disque|iso|du\s+conteneur)/giu;

/** Meta mentions of image generation never count as a request: bug reports
 *  ("la génération d'image"), tool names ("generate_image"), participles
 *  ("l'image générée") and stop requests ("arrête de générer"). */
const META_IMAGE_RE = new RegExp(
  [
    "(?:generate|edit|describe)_image\\b",
    "g[ée]n[ée]r(?:ation|ations)\\s+d['’]?\\s?images?|image\\s+generations?",
    "images?\\s+(?:g[ée]n[ée]r|generat)\\p{L}*",
    "(?:arr[êe]t\\p{L}*|stop\\p{L}*|cess\\p{L}*|sans)\\s+(?:de\\s+|d['’]\\s+)?(?:g[ée]n\\p{L}*|generat\\p{L}*)",
    "(?:g[ée]n[ée]r[ée](?:e|s)?|generated|créé(?:e|s)?|created)(?!\\p{L})",
  ].join("|"),
  "giu",
);

/** Agent background requests (OpenCode title generation, compaction) must never draw. */
const HELPER_REQUEST_RE =
  /title generator|thread title|generate a (?:short )?title|summari[sz]e the conversation|structured summary|existing checkpoint/i;

const MARKER_RE = /<lumo-image\b[^>]*\/>|\[Image omitted:[^\]]*\]/g;
const TOOL_RESULT_PREFIX = "[Tool Result:";

function isGenuineUserTurn(turn: Turn): boolean {
  return (
    turn.role === Role.User &&
    !(turn.content ?? "").startsWith(TOOL_RESULT_PREFIX)
  );
}

const hasImages = (t: Turn | undefined) => (t?.images?.length ?? 0) > 0;

/** True if the text asks for a picture to be made. Meta mentions (bug
 *  reports, tool names, stop requests) never count. */
export function asksForImage(text: string): boolean {
  const clean = text
    .replace(MARKER_RE, " ")
    .replace(NOT_A_PICTURE_RE, " ")
    .replace(META_IMAGE_RE, " ");
  return DRAW_RE.test(clean) || CREATE_IMAGE_RE.test(clean);
}

/** Verbs that ask to change an existing picture ("rends-le bleu", "remove the background"). */
const EDIT_VERBS = [
  "[ée]dit\\p{L}*",
  "modifi\\p{L}*",
  "retouch\\p{L}*",
  "transform\\p{L}*",
  "chang\\p{L}*",
  "recolor\\p{L}*",
  "colori\\p{L}*",
  "rends",
  "rendez",
  "rendre",
  "make",
  "mets",
  "mettez",
  "mettre",
  "ajoute\\p{L}*",
  "add",
  "enl[èe]v\\p{L}*",
  "supprime\\p{L}*",
  "remove\\p{L}*",
  "efface\\p{L}*",
  "erase",
  "replace\\p{L}*",
  "remplace\\p{L}*",
  "turn",
  "convert\\p{L}*",
  "recadre\\p{L}*",
  "crop\\p{L}*",
  "agrandi\\p{L}*",
  "upscale",
  "cambia\\p{L}*",
  "bearbeit\\p{L}*",
  "[äa]e?nder\\p{L}*",
  "modifica\\p{L}*",
  "mude",
  "muda\\p{L}*",
];
const EDIT_RE = new RegExp(words(EDIT_VERBS), "iu");
const PICTURE_REFS = [
  ...IMAGE_NOUNS,
  "screenshots?",
  "captures?(?: d['’]\\s?[ée]cran)?",
];
/** Edit verb and the picture it acts on in the same clause ("change … sur cette photo"). */
const EDIT_PICTURE_RE = new RegExp(
  words(EDIT_VERBS) +
    "[^.?!\\n,;]{0,60}?" +
    words(PICTURE_REFS) +
    "|" +
    words(PICTURE_REFS) +
    "[^.?!\\n,;]{0,30}?" +
    words(EDIT_VERBS),
  "iu",
);

/** True if the text asks to change a picture. With `needsPictureRef`, it must also name it. */
export function asksForImageEdit(
  text: string,
  needsPictureRef: boolean,
): boolean {
  const clean = text.replace(MARKER_RE, " ").replace(NOT_A_PICTURE_RE, " ");
  return needsPictureRef ? EDIT_PICTURE_RE.test(clean) : EDIT_RE.test(clean);
}

/**
 * Which of Lumo's image tools to advertise on this request (possibly none).
 *
 * The web client only talks to Lumo with a human typing, but agent clients (OpenCode)
 * send many requests per user message: tool-loop steps, bounces, title generation,
 * compaction, screenshots attached for context. Advertising every image tool on all of
 * them makes Lumo draw or edit images nobody asked for. So, based on the last real
 * user message:
 * - asks for a picture -> generate_image;
 * - attached an image -> describe_image, plus edit_image only if it asks to change
 *   the picture (a screenshot sent for context is never edited); offered only on
 *   the request that directly answers that message, never on later tool-loop steps;
 * - directly answers an assistant message that showed an image and asks for a
 *   change ("make it blue") -> edit_image + describe_image.
 * Never on helper requests (title / summary), nor again on tool-loop steps once an
 * image was generated after that message.
 */
export function selectImageTools(
  turns: Turn[],
  instructions?: string,
): ToolName[] {
  if (instructions && HELPER_REQUEST_RE.test(instructions)) return [];

  let g = turns.length - 1;
  while (g >= 0 && !isGenuineUserTurn(turns[g])) g--;
  if (g < 0) return [];

  const user = turns[g];
  const text = user.content ?? "";
  if (HELPER_REQUEST_RE.test(text)) return [];
  if (turns.slice(g + 1).some((t) => t.role === Role.Assistant && hasImages(t)))
    return [];

  const tools = new Set<ToolName>();
  if (asksForImage(text)) tools.add("generate_image");
  // Attachments: only on the request that directly answers the image-bearing
  // message. Later tool-loop steps already carry the description in the
  // transcript; re-offering describe_image makes the agent describe the
  // screenshot again instead of continuing the actual task.
  if (hasImages(user) && g === turns.length - 1) {
    tools.add("describe_image");
    if (asksForImageEdit(text, true)) tools.add("edit_image");
  }

  // Follow-up edit: the user's own latest turn, right after an image was shown.
  const latestIsUser = g === turns.length - 1;
  const previous = turns[g - 1];
  if (
    latestIsUser &&
    previous?.role === Role.Assistant &&
    hasImages(previous) &&
    asksForImageEdit(text, false)
  ) {
    tools.add("edit_image");
    tools.add("describe_image");
  }
  return [...tools];
}

/**
 * Text of the last real user message, or null on agent helper requests (title,
 * compaction) and when there is none. Tool-result turns are skipped.
 */
export function latestUserRequestText(
  turns: Turn[],
  instructions?: string,
): string | null {
  if (instructions && HELPER_REQUEST_RE.test(instructions)) return null;
  let g = turns.length - 1;
  while (g >= 0 && !isGenuineUserTurn(turns[g])) g--;
  if (g < 0) return null;
  const text = (turns[g].content ?? "").replace(MARKER_RE, " ");
  return HELPER_REQUEST_RE.test(text) ? null : text;
}

/** Whether any image tool would be advertised on this request. */
export function shouldOfferImageTools(
  turns: Turn[],
  instructions?: string,
): boolean {
  return selectImageTools(turns, instructions).length > 0;
}

/** Safety net: true if any image would be sent in plaintext. */
export function hasPlaintextImages(turns: Turn[]): boolean {
  return turns.some((t) => t.images?.some((im) => !im.encrypted) ?? false);
}
