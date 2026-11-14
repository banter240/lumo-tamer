/**
 * Local video analysis, cached per file (path + size + mtime).
 *
 * Short videos become up to 10 contact sheets (3×3 timestamped frames).
 * Long videos are cut into segments with one sheet each (summarized later by
 * Lumo, see inject.ts) plus a few overview sheets. Everything is written under
 * <data dir>/video-cache and never leaves this machine except as the images
 * and text lumo-tamer sends to Lumo.
 */

import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  rmSync,
} from "fs";
import { basename, join, resolve } from "path";
import { getDataDir } from "../app/paths.js";
import { logger } from "../app/logger.js";
import {
  extractAudio,
  extractFrame,
  probe,
  run,
  sceneChanges,
  tileSheet,
} from "./ffmpeg.js";
import { formatTimestamp, pickTimestamps } from "./timestamps.js";

export const SHEET_COLS = 3;
export const SHEET_ROWS = 3;
export const FRAMES_PER_SHEET = SHEET_COLS * SHEET_ROWS;
const CACHE_VERSION = 1;

export interface VideoSettings {
  ffmpegPath: string;
  ffprobePath: string;
  shortVideoSeconds: number;
  segmentSeconds: number;
  overviewSheets: number;
  sceneThreshold: number;
  transcribeCommand: string[];
}

export interface VideoSheet {
  file: string;
  from: number;
  to: number;
  timestamps: number[];
}

export interface TranscriptLine {
  start: number;
  end: number;
  text: string;
}

export interface VideoSegment {
  from: number;
  to: number;
  sheet: VideoSheet;
  summary?: string;
}

export interface VideoAnalysis {
  version: number;
  key: string;
  path: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  /** Short video: all sheets. Long video: overview sheets. */
  sheets: VideoSheet[];
  /** Long videos only. Summaries are filled in by inject.ts and cached. */
  segments: VideoSegment[];
  transcript?: TranscriptLine[];
  transcriptNote?: string;
  /** Where the video came from, when not a local file (e.g. YouTube). */
  source?: {
    url: string;
    title: string;
    channel: string;
    uploadDate?: string;
    description?: string;
  };
}

/** Extra inputs for a video that came from elsewhere (YouTube). */
export interface AnalyzeExtras {
  transcript?: TranscriptLine[];
  transcriptNote?: string;
  source?: VideoAnalysis["source"];
}

const inFlight = new Map<string, Promise<VideoAnalysis>>();

export function cacheKey(file: string): string {
  const st = statSync(file);
  return createHash("sha256")
    .update(`${resolve(file)}|${st.size}|${st.mtimeMs}|v${CACHE_VERSION}`)
    .digest("hex")
    .slice(0, 20);
}

function cacheDir(key: string): string {
  return join(getDataDir(), "video-cache", key);
}

export function saveAnalysis(a: VideoAnalysis): void {
  writeFileSync(
    join(cacheDir(a.key), "analysis.json"),
    JSON.stringify(a, null, 1),
  );
}

function tileSize(
  width: number,
  height: number,
  longSide: number,
): { w: number; h: number } {
  const portrait = height > width;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return portrait
    ? { w: even((longSide * 9) / 16), h: even(longSide) }
    : { w: even(longSide), h: even((longSide * 9) / 16) };
}

/** Run tasks with at most `limit` at once. */
async function pool<T>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
}

async function buildSheet(
  s: VideoSettings,
  file: string,
  dir: string,
  name: string,
  times: number[],
  tile: { w: number; h: number },
): Promise<VideoSheet> {
  const framesDir = join(dir, `${name}-frames`);
  mkdirSync(framesDir, { recursive: true });
  await pool(times, 4, async (t, i) => {
    await extractFrame(
      s.ffmpegPath,
      file,
      t,
      join(framesDir, `f${String(i + 1).padStart(2, "0")}.jpg`),
      {
        width: tile.w,
        height: tile.h,
        label: formatTimestamp(t),
      },
    );
  });
  const out = join(dir, `${name}.jpg`);
  const rows = Math.ceil(times.length / SHEET_COLS);
  await tileSheet(
    s.ffmpegPath,
    framesDir,
    "f",
    SHEET_COLS,
    Math.max(1, rows),
    out,
  );
  rmSync(framesDir, { recursive: true, force: true });
  return {
    file: out,
    from: times[0] ?? 0,
    to: times[times.length - 1] ?? 0,
    timestamps: times,
  };
}

function parseSrtTime(t: string): number {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t);
  return m
    ? Number(m[1]) * 3600 +
        Number(m[2]) * 60 +
        Number(m[3]) +
        Number(m[4]) / 1000
    : 0;
}

export function parseSrt(srt: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const block of srt.replace(/\r/g, "").split(/\n\n+/)) {
    const m =
      /(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)\n([\s\S]+)/.exec(
        block,
      );
    if (!m) continue;
    const text = m[3].replace(/\n/g, " ").trim();
    if (text)
      lines.push({ start: parseSrtTime(m[1]), end: parseSrtTime(m[2]), text });
  }
  return dropRepeatedLines(lines);
}

/**
 * Whisper fills silence with the same short line over and over ("Thank
 * you.", "Merci d'avoir regardé"). Drop any line repeated 3+ times in a row.
 */
function dropRepeatedLines(lines: TranscriptLine[]): TranscriptLine[] {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const out: TranscriptLine[] = [];
  for (let i = 0; i < lines.length;) {
    let j = i + 1;
    while (j < lines.length && norm(lines[j].text) === norm(lines[i].text)) j++;
    if (j - i < 3) out.push(...lines.slice(i, j));
    i = j;
  }
  return out;
}

async function transcribe(
  s: VideoSettings,
  file: string,
  dir: string,
): Promise<{ lines?: TranscriptLine[]; note?: string }> {
  if (s.transcribeCommand.length === 0) {
    return {
      note: "no local speech-to-text configured (server.video.transcribeCommand); sound is not available",
    };
  }
  try {
    const audio = join(dir, "audio.wav");
    await extractAudio(s.ffmpegPath, file, audio);
    const outBase = join(dir, "transcript");
    const [cmd, ...args] = s.transcribeCommand.map((a) =>
      a.replace("{audio}", audio).replace("{out}", outBase),
    );
    const res = await run(cmd, args, 60 * 60 * 1000);
    rmSync(audio, { force: true });
    const srt = `${outBase}.srt`;
    if (res.code !== 0 || !existsSync(srt)) {
      return {
        note: `speech-to-text failed (${res.stderr.trim().split("\n").pop() ?? res.code})`,
      };
    }
    return { lines: parseSrt(readFileSync(srt, "utf8")) };
  } catch (error) {
    return { note: `speech-to-text failed (${(error as Error).message})` };
  }
}

async function analyzeUncached(
  s: VideoSettings,
  file: string,
  key: string,
  progress: (msg: string) => void,
  extras: AnalyzeExtras = {},
): Promise<VideoAnalysis> {
  const dir = cacheDir(key);
  mkdirSync(dir, { recursive: true });
  const info = await probe(s.ffprobePath, file);
  progress(
    `vidéo « ${extras.source?.title ?? basename(file)} » : ${formatTimestamp(info.duration)}, détection des changements de scène…`,
  );
  const scenes = await sceneChanges(s.ffmpegPath, file, s.sceneThreshold);

  const analysis: VideoAnalysis = {
    version: CACHE_VERSION,
    key,
    path: resolve(file),
    name: extras.source?.title ?? basename(file),
    duration: info.duration,
    width: info.width,
    height: info.height,
    hasAudio: info.hasAudio,
    sheets: [],
    segments: [],
    ...(extras.source ? { source: extras.source } : {}),
  };

  const end = Math.max(0.5, info.duration - 0.2);
  if (info.duration <= s.shortVideoSeconds) {
    const sheetCount = Math.min(10, Math.max(1, Math.ceil(info.duration / 30)));
    const times = pickTimestamps(0, end, scenes, sheetCount * FRAMES_PER_SHEET);
    const tile = tileSize(info.width, info.height, 480);
    for (let i = 0; i < sheetCount; i++) {
      const slice = times.slice(
        i * FRAMES_PER_SHEET,
        (i + 1) * FRAMES_PER_SHEET,
      );
      if (slice.length === 0) break;
      progress(`planche ${i + 1}/${sheetCount}…`);
      analysis.sheets.push(
        await buildSheet(s, file, dir, `sheet${i + 1}`, slice, tile),
      );
    }
  } else {
    const tile = tileSize(info.width, info.height, 480);
    const segCount = Math.ceil(info.duration / s.segmentSeconds);
    for (let i = 0; i < segCount; i++) {
      const from = i * s.segmentSeconds;
      const to = Math.min(end, (i + 1) * s.segmentSeconds);
      progress(
        `segment ${i + 1}/${segCount} (${formatTimestamp(from)}–${formatTimestamp(to)}) : extraction des images…`,
      );
      const times = pickTimestamps(from, to, scenes, FRAMES_PER_SHEET);
      const sheet = await buildSheet(
        s,
        file,
        dir,
        `segment${i + 1}`,
        times,
        tile,
      );
      analysis.segments.push({ from, to, sheet });
    }
    if (s.overviewSheets > 0) {
      const times = pickTimestamps(
        0,
        end,
        scenes,
        s.overviewSheets * FRAMES_PER_SHEET,
      );
      for (let i = 0; i < s.overviewSheets; i++) {
        const slice = times.slice(
          i * FRAMES_PER_SHEET,
          (i + 1) * FRAMES_PER_SHEET,
        );
        if (slice.length === 0) break;
        analysis.sheets.push(
          await buildSheet(s, file, dir, `overview${i + 1}`, slice, tile),
        );
      }
    }
  }

  if (extras.transcript && extras.transcript.length > 0) {
    analysis.transcript = extras.transcript;
    analysis.transcriptNote = extras.transcriptNote;
  } else if (info.hasAudio) {
    progress("transcription du son…");
    const t = await transcribe(s, file, dir);
    analysis.transcript = t.lines;
    analysis.transcriptNote = t.note;
  } else {
    analysis.transcriptNote = "the video has no audio track";
  }

  saveAnalysis(analysis);
  return analysis;
}

/** Cached analysis of `file`; concurrent callers share one run. */
export async function analyzeVideo(
  s: VideoSettings,
  file: string,
  progress: (msg: string) => void = () => {},
  extras: AnalyzeExtras = {},
): Promise<VideoAnalysis> {
  const key = cacheKey(file);
  const cached = join(cacheDir(key), "analysis.json");
  if (existsSync(cached)) {
    try {
      const a = JSON.parse(readFileSync(cached, "utf8")) as VideoAnalysis;
      if (
        a.version === CACHE_VERSION &&
        [...a.sheets, ...a.segments.map((x) => x.sheet)].every((sh) =>
          existsSync(sh.file),
        )
      ) {
        return a;
      }
    } catch {
      // rebuild below
    }
  }
  const running = inFlight.get(key);
  if (running) return running;
  const job = analyzeUncached(s, file, key, progress, extras).finally(() =>
    inFlight.delete(key),
  );
  inFlight.set(key, job);
  logger.info({ key }, "Analyzing local video");
  return job;
}

/** Dense sheet around `t` (±4 s, one frame per second), cached. */
export async function zoomSheet(
  s: VideoSettings,
  a: VideoAnalysis,
  t: number,
): Promise<VideoSheet> {
  const dir = cacheDir(a.key);
  const name = `zoom-${Math.round(t)}`;
  const file = join(dir, `${name}.jpg`);
  const start = Math.max(0, Math.min(t - 4, a.duration - 9));
  const times = Array.from({ length: FRAMES_PER_SHEET }, (_, i) =>
    Math.min(a.duration - 0.1, start + i),
  );
  if (existsSync(file))
    return {
      file,
      from: times[0],
      to: times[times.length - 1],
      timestamps: times,
    };
  return buildSheet(
    s,
    a.path,
    dir,
    name,
    times,
    tileSize(a.width, a.height, 640),
  );
}

export function readSheetBase64(sheet: VideoSheet): string {
  return readFileSync(sheet.file).toString("base64");
}

export function transcriptBetween(
  a: VideoAnalysis,
  from: number,
  to: number,
): string {
  return (a.transcript ?? [])
    .filter((l) => l.end > from && l.start < to)
    .map((l) => `[${formatTimestamp(l.start)}] ${l.text}`)
    .join("\n");
}
