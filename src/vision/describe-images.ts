/**
 * Make attached images reliably visible to Lumo.
 *
 * Lumo reads an image only by calling its native describe_image tool. In agent
 * mode it often skips that and goes straight to the client's tools, so it
 * answers about a screenshot it never looked at. Here lumo-tamer asks Lumo to
 * look at each attached image once, in a request whose only job is that, and
 * writes the description next to the image as text. Every later step of the
 * conversation (OpenCode re-sends the history) reuses the cached description.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getDataDir } from "../app/paths.js";
import { logger } from "../app/logger.js";
import {
  MAX_IMAGES_PER_REQUEST,
  isGenuineUserTurn,
} from "../lumo-client/images.js";
import { Role, type Turn } from "../lumo-client/types.js";

export interface DescribeImagesContext {
  /** One Lumo completion (images included), returning its text. */
  describe: (turn: Turn) => Promise<string>;
  /** Progress lines for the user (surfaced as thinking). */
  progress: (msg: string) => void;
}

const memory = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

function cacheFile(imageId: string): string {
  return join(
    getDataDir(),
    "image-descriptions",
    `${imageId.replace(/[^A-Za-z0-9_-]/g, "_")}.txt`,
  );
}

function cached(imageId: string): string | undefined {
  const hit = memory.get(imageId);
  if (hit) return hit;
  const file = cacheFile(imageId);
  if (existsSync(file)) {
    const text = readFileSync(file, "utf8");
    memory.set(imageId, text);
    return text;
  }
  return undefined;
}

function store(imageId: string, text: string): void {
  memory.set(imageId, text);
  const file = cacheFile(imageId);
  mkdirSync(join(getDataDir(), "image-descriptions"), { recursive: true });
  writeFileSync(file, text);
}

function describePrompt(context: string): string {
  return [
    "Look at the attached picture with your describe_image tool, then report precisely what it shows,",
    "for someone who cannot see it and must work only from your words.",
    "Report:",
    "- what kind of picture it is (screenshot of which app, game, site or terminal; photo; diagram…);",
    "- every readable text, quoted exactly (titles, buttons, labels, errors, numbers);",
    "- the layout from top to bottom: where each element sits (top, bottom, left, right, centre), rough sizes and gaps;",
    "- colours, and interface elements with their state (selected, greyed out, cut off, overlapping, hidden, off-screen);",
    "- anything that looks wrong or relates to the user's message.",
    'Facts only; write "unclear" when you are not sure. No advice, no fixes.',
    context
      ? `The user's message that came with it: «${context.slice(0, 600)}»`
      : "",
    "Reply in the language of the user's message (French if there is none).",
  ]
    .filter(Boolean)
    .join("\n");
}

async function describeOnce(
  ctx: DescribeImagesContext,
  image: NonNullable<Turn["images"]>[number],
  context: string,
): Promise<string | null> {
  const id = image.image_id;
  const hit = cached(id);
  if (hit) return hit;
  const running = inFlight.get(id);
  if (running) return running;
  const job = (async () => {
    try {
      const text = (
        await ctx.describe({
          role: Role.User,
          content: describePrompt(context),
          images: [image],
        })
      ).trim();
      if (!text) return null;
      store(id, text);
      return text;
    } catch (error) {
      logger.warn(
        { error: (error as Error).message },
        "Image description failed",
      );
      return null;
    } finally {
      inFlight.delete(id);
    }
  })();
  inFlight.set(id, job);
  return job;
}

/**
 * Returns turns where each user-side image that will be sent (the most recent
 * MAX_IMAGES_PER_REQUEST) carries a text description next to it. Unchanged
 * turns keep their identity; images stay attached.
 */
export async function describeAttachedImages(
  turns: Turn[],
  ctx: DescribeImagesContext,
): Promise<Turn[]> {
  // Images Lumo will actually receive: the most recent ones, user side only
  // (assistant-generated images are Lumo's own).
  const slots: Array<{ turn: number; index: number }> = [];
  turns.forEach((t, ti) => {
    if (t.role !== Role.User) return;
    (t.images ?? []).forEach((_img, ii) => slots.push({ turn: ti, index: ii }));
  });
  const recent = slots.slice(-MAX_IMAGES_PER_REQUEST);
  if (recent.length === 0) return turns;

  const out = [...turns];
  const byTurn = new Map<number, number[]>();
  for (const s of recent)
    byTurn.set(s.turn, [...(byTurn.get(s.turn) ?? []), s.index]);

  let todo = recent.filter(
    (s) => !cached(turns[s.turn].images![s.index].image_id),
  ).length;
  let done = 0;
  for (const [ti, indexes] of byTurn) {
    const turn = turns[ti];
    // Context: the turn's own text, or for a tool result, the user's request before it.
    let context = isGenuineUserTurn(turn) ? (turn.content ?? "") : "";
    if (!context) {
      for (let j = ti - 1; j >= 0; j--) {
        if (isGenuineUserTurn(turns[j])) {
          context = turns[j].content ?? "";
          break;
        }
      }
    }
    const notes: string[] = [];
    for (const ii of indexes) {
      const image = turn.images![ii];
      if (!cached(image.image_id)) {
        done++;
        ctx.progress(`lecture de l'image ${done}/${todo}…`);
      }
      const text = await describeOnce(ctx, image, context);
      if (text) {
        notes.push(
          `[Attached image ${ii + 1} — what it shows (read by lumo-tamer with your describe_image tool; you can call describe_image again for a detail):\n${text}]`,
        );
      }
    }
    if (notes.length > 0) {
      out[ti] = {
        ...turn,
        content: [turn.content ?? "", ...notes].filter(Boolean).join("\n\n"),
      };
    }
  }
  if (todo > 0)
    logger.info({ described: todo }, "Described attached images for Lumo");
  return out;
}
