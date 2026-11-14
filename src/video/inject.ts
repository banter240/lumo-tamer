/**
 * Turn local video paths in user messages into something Lumo can read:
 * timestamped contact sheets (images, U2L-encrypted like any image), a
 * segment-by-segment timeline for long videos, an optional transcript, and
 * dense frames around times the user asks about ("à 14:20").
 */

import { existsSync, statSync } from "fs";
import { basename } from "path";
import { Role, type Turn } from "../lumo-client/types.js";
import { isGenuineUserTurn, stableImageId } from "../lumo-client/images.js";
import { logger } from "../app/logger.js";
import {
  analyzeVideo,
  readSheetBase64,
  saveAnalysis,
  transcriptBetween,
  zoomSheet,
  type VideoAnalysis,
  type VideoSettings,
  type VideoSheet,
} from "./analyze.js";
import {
  fetchYouTube,
  findYouTubeIds,
  youTubeWatchUrl,
  type YouTubeSettings,
} from "./youtube.js";
import {
  findTimestamps,
  findUnsupportedVideoNotices,
  findVideoPaths,
  formatTimestamp,
  replaceUnsupportedVideoNotices,
} from "./timestamps.js";

const MAX_IMAGES = 10;
const MAX_ZOOMS = 2;
const MAX_TRANSCRIPT_CHARS = 16_000;

export interface VideoContext {
  settings: VideoSettings;
  /** One Lumo completion (images included), returning its text. */
  summarize: (turn: Turn) => Promise<string>;
  /** Progress lines for the user (surfaced as thinking). */
  progress: (msg: string) => void;
  /** YouTube links (yt-dlp); off unless enabled. */
  youtube?: YouTubeSettings & { enabled: boolean };
}

function sheetImage(sheet: VideoSheet) {
  const data = readSheetBase64(sheet);
  return { encrypted: false, image_id: stableImageId(data), data };
}

function sheetLegend(label: string, sheet: VideoSheet): string {
  return `${label}: ${sheet.timestamps.map(formatTimestamp).join(", ")}`;
}

function header(a: VideoAnalysis): string {
  const src = a.source;
  return [
    src
      ? `[YouTube video "${src.title}" by ${src.channel || "unknown channel"}${src.uploadDate ? `, ${src.uploadDate}` : ""} — ${formatTimestamp(a.duration)} — ${src.url} — fetched and analysed locally by lumo-tamer]`
      : `[Video "${a.name}" — ${formatTimestamp(a.duration)} — analysed locally by lumo-tamer]`,
    ...(src?.description
      ? [
          `Description (from YouTube): ${src.description.replace(/\n+/g, " ").slice(0, 600)}`,
        ]
      : []),
    "You cannot play the video. You get timestamped frames instead: each attached",
    "contact sheet holds 3×3 frames, read left to right then top to bottom, each",
    "frame labelled with its time. Base your answer on these frames, the timeline",
    "and the transcript; say so when something cannot be seen in them.",
  ].join("\n");
}

function segmentPrompt(a: VideoAnalysis, i: number, userText: string): Turn {
  const seg = a.segments[i];
  const transcript = transcriptBetween(a, seg.from, seg.to);
  const text = [
    `Contact sheet of 9 frames from ${formatTimestamp(seg.from)}–${formatTimestamp(seg.to)} of the video "${a.name}"`,
    "(read left to right, top to bottom; each frame shows its time).",
    transcript ? `Speech in this part:\n${transcript}` : "",
    "Look at the sheet, then describe factually what is visible and what happens in this part:",
    "places, people, on-screen text (quote it exactly), interface elements, actions, and what changes",
    "from one frame to the next. 5 to 10 short bullet points, each starting with its time.",
    "Do not guess beyond what the frames and speech show.",
    `Write in the language of this request from the user: «${userText.slice(0, 160)}»`,
  ]
    .filter(Boolean)
    .join("\n");
  return { role: Role.User, content: text, images: [sheetImage(seg.sheet)] };
}

async function ensureSummaries(
  a: VideoAnalysis,
  ctx: VideoContext,
  userText: string,
): Promise<void> {
  const missing = a.segments
    .map((s, i) => (s.summary ? -1 : i))
    .filter((i) => i >= 0);
  for (const i of missing) {
    const seg = a.segments[i];
    ctx.progress(
      `résumé du segment ${i + 1}/${a.segments.length} (${formatTimestamp(seg.from)}–${formatTimestamp(seg.to)})…`,
    );
    try {
      seg.summary =
        (await ctx.summarize(segmentPrompt(a, i, userText))).trim() ||
        "(no description)";
    } catch (error) {
      logger.warn({ error, segment: i }, "Video segment summary failed");
      seg.summary = "(description failed for this part)";
    }
    saveAnalysis(a);
  }
}

function transcriptBlock(a: VideoAnalysis): string {
  if (a.transcript && a.transcript.length > 0) {
    const full = transcriptBetween(a, 0, a.duration + 1);
    return full.length <= MAX_TRANSCRIPT_CHARS
      ? `Transcript (local speech-to-text):\n${full}`
      : `Transcript (local speech-to-text, first part; the timeline covers the rest):\n${full.slice(0, MAX_TRANSCRIPT_CHARS)}…`;
  }
  return a.transcriptNote ? `No transcript: ${a.transcriptNote}.` : "";
}

/** Text + images for a video referenced in the latest user message. */
async function describeVideo(
  a: VideoAnalysis,
  ctx: VideoContext,
  userText: string,
  imageBudget: number,
): Promise<{ text: string; images: VideoSheet[] }> {
  const parts = [header(a)];
  const images: VideoSheet[] = [];
  if (a.segments.length > 0) {
    await ensureSummaries(a, ctx, userText);
    parts.push(
      "Timeline (each part described by you earlier from its own contact sheet):",
      ...a.segments.map(
        (s) =>
          `## ${formatTimestamp(s.from)}–${formatTimestamp(s.to)}\n${s.summary ?? ""}`,
      ),
      "Ask about a precise time (e.g. 14:20) to get dense frames around it.",
    );
  }
  const sheets = a.sheets.slice(0, imageBudget);
  sheets.forEach((sh, i) => images.push(sh));
  if (sheets.length > 0) {
    parts.push(
      a.segments.length > 0 ? "Attached overview sheets:" : "Attached sheets:",
      ...sheets.map((sh, i) => sheetLegend(`Sheet ${i + 1}`, sh)),
    );
  }
  const tr = transcriptBlock(a);
  if (tr) parts.push(tr);
  return { text: parts.join("\n"), images };
}

/** Short reminder for a video referenced earlier in the conversation. */
function rememberVideo(a: VideoAnalysis): string {
  const lines = [
    `[Video "${a.name}" (${formatTimestamp(a.duration)}) was analysed locally earlier; frames are not re-attached.]`,
  ];
  if (a.segments.some((s) => s.summary)) {
    lines.push(
      ...a.segments.map(
        (s) =>
          `${formatTimestamp(s.from)}–${formatTimestamp(s.to)}: ${(s.summary ?? "").replace(/\n+/g, " ").slice(0, 600)}`,
      ),
    );
  }
  return lines.join("\n");
}

function isVideoFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Returns new turns with video context added. Turns without video
 * references are returned unchanged (same objects).
 */
export async function prepareVideoTurns(
  turns: Turn[],
  ctx: VideoContext,
): Promise<Turn[]> {
  let latest = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (isGenuineUserTurn(turns[i])) {
      latest = i;
      break;
    }
  }
  if (latest < 0) return turns;

  const out = [...turns];
  let lastVideo: VideoAnalysis | null = null;
  let changed = false;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (!isGenuineUserTurn(turn)) continue;
    let content = turn.content ?? "";
    const isLatest = i === latest;

    if (findUnsupportedVideoNotices(content).length > 0) {
      content = replaceUnsupportedVideoNotices(
        content,
        (name) =>
          `[lumo-tamer: the client could not send the video "${name}". Lumo cannot watch videos, but lumo-tamer can analyse a local video file: ask the user to paste its full path (for example C:\\Users\\me\\Videos\\${name}) in a message.]`,
      );
      changed = true;
    }

    // Local files, then YouTube links (fetched with yt-dlp, cached by id).
    const sources: Array<{
      label: string;
      load: () => Promise<VideoAnalysis>;
    }> = [
      ...findVideoPaths(content)
        .filter(isVideoFile)
        .map((path) => ({
          label: basename(path),
          load: () => analyzeVideo(ctx.settings, path, ctx.progress),
        })),
      ...(ctx.youtube?.enabled ? findYouTubeIds(content) : []).map((id) => ({
        label: youTubeWatchUrl(id),
        load: async () => {
          const yt = await fetchYouTube(
            ctx.youtube!,
            id,
            ctx.settings.transcribeCommand.length === 0,
            ctx.progress,
          );
          return analyzeVideo(ctx.settings, yt.file, ctx.progress, {
            transcript: yt.transcript,
            transcriptNote: yt.transcriptNote,
            source: yt.source,
          });
        },
      })),
    ];
    if (sources.length === 0) {
      if (content !== (turn.content ?? "")) out[i] = { ...turn, content };
      continue;
    }

    const extraText: string[] = [];
    const extraImages = [...(turn.images ?? [])];
    for (const source of sources) {
      try {
        const a = await source.load();
        lastVideo = a;
        if (isLatest) {
          const budget = Math.max(
            0,
            MAX_IMAGES -
              extraImages.length -
              (findTimestamps(content, a.duration).length > 0 ? MAX_ZOOMS : 0),
          );
          const d = await describeVideo(a, ctx, content, budget);
          extraText.push(d.text);
          extraImages.push(...d.images.map(sheetImage));
        } else {
          extraText.push(rememberVideo(a));
        }
      } catch (error) {
        logger.warn(
          { error: (error as Error).message, video: source.label },
          "Video analysis failed",
        );
        extraText.push(
          `[lumo-tamer could not analyse the video "${source.label}": ${(error as Error).message}]`,
        );
      }
    }
    out[i] = {
      ...turn,
      content: [content, ...extraText].join("\n\n"),
      images: extraImages,
    };
    changed = true;
  }

  // "What happens at 14:20?" → dense frames around that time, from the
  // latest video in the conversation.
  if (lastVideo) {
    const latestTurn = out[latest];
    const times = findTimestamps(
      turns[latest].content ?? "",
      lastVideo.duration,
    ).slice(0, MAX_ZOOMS);
    const room = MAX_IMAGES - (latestTurn.images?.length ?? 0);
    if (times.length > 0 && room > 0) {
      const zoomText: string[] = [];
      const zoomImages = [...(latestTurn.images ?? [])];
      for (const t of times.slice(0, room)) {
        try {
          ctx.progress(`images détaillées autour de ${formatTimestamp(t)}…`);
          const sheet = await zoomSheet(ctx.settings, lastVideo, t);
          zoomImages.push(sheetImage(sheet));
          zoomText.push(
            sheetLegend(
              `Detail sheet around ${formatTimestamp(t)} of "${lastVideo.name}" (one frame per second)`,
              sheet,
            ),
          );
        } catch (error) {
          logger.warn({ error: (error as Error).message }, "Video zoom failed");
        }
      }
      if (zoomText.length > 0) {
        out[latest] = {
          ...latestTurn,
          content: [latestTurn.content ?? "", ...zoomText].join("\n\n"),
          images: zoomImages,
        };
        changed = true;
      }
    }
  }

  return changed ? out : turns;
}
