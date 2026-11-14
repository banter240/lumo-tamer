/**
 * YouTube links → a local low-resolution copy + subtitles, via yt-dlp.
 *
 * Only YouTube video ids are taken from the text; the URL fetched is always
 * rebuilt as https://www.youtube.com/watch?v=<id>, so a message can never
 * make the proxy fetch another host. Downloads are cached per id under
 * <data dir>/video-cache/yt-<id>/.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { getDataDir } from "../app/paths.js";
import { run } from "./ffmpeg.js";
import { parseSrt, type TranscriptLine } from "./analyze.js";
import { formatTimestamp } from "./timestamps.js";

export interface YouTubeSettings {
  ytDlpPath: string;
  ffmpegPath: string;
  maxDurationSeconds: number;
  maxHeight: number;
}

export interface YouTubeSource {
  id: string;
  url: string;
  title: string;
  channel: string;
  uploadDate?: string;
  description?: string;
}

export interface YouTubeVideo {
  file: string;
  source: YouTubeSource;
  /** Subtitles from YouTube (manual, else auto-generated), if any. */
  transcript?: TranscriptLine[];
  transcriptNote?: string;
}

const ID = "([A-Za-z0-9_-]{11})";
const YOUTUBE_RE = new RegExp(
  String.raw`(?:https?:\/\/)?(?:(?:www|m|music)\.)?(?:youtube\.com\/(?:watch\?(?:[^\s#]*?&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)${ID}(?![A-Za-z0-9_-])`,
  "gi",
);

/** YouTube video ids in the text, in order, without duplicates. */
export function findYouTubeIds(text: string): string[] {
  return [...new Set([...text.matchAll(YOUTUBE_RE)].map((m) => m[1]))];
}

export function youTubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * YouTube auto-captions converted to SRT roll: each cue repeats the previous
 * line before adding a new one. Keep only lines not in the previous cue.
 */
export function parseRollingSrt(srt: string): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  let previous: string[] = [];
  for (const block of srt.replace(/\r/g, "").split(/\n\n+/)) {
    const m =
      /(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)\n([\s\S]+)/.exec(
        block,
      );
    if (!m) continue;
    const lines = m[3]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const fresh = lines.filter((l) => !previous.includes(l));
    previous = lines;
    if (fresh.length === 0) continue;
    const [start, end] = [m[1], m[2]].map((t) => {
      const p = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t)!;
      return (
        Number(p[1]) * 3600 +
        Number(p[2]) * 60 +
        Number(p[3]) +
        Number(p[4]) / 1000
      );
    });
    out.push({ start, end, text: fresh.join(" ") });
  }
  return out;
}

function ffmpegLocationArgs(ffmpegPath: string): string[] {
  return /[\\/]/.test(ffmpegPath)
    ? ["--ffmpeg-location", dirname(ffmpegPath)]
    : [];
}

interface Meta {
  id: string;
  title?: string;
  channel?: string;
  uploader?: string;
  duration?: number;
  upload_date?: string;
  description?: string;
  language?: string | null;
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
  is_live?: boolean;
}

function pickLanguage(
  available: string[],
  preferred: string | null | undefined,
): string | undefined {
  if (available.length === 0) return undefined;
  const base = (l: string) => l.toLowerCase().split(/[-_]/)[0];
  if (preferred) {
    const exact =
      available.find((l) => l === preferred) ??
      available.find((l) => base(l) === base(preferred));
    if (exact) return exact;
  }
  return (
    available.find((l) => base(l) === "fr") ??
    available.find((l) => base(l) === "en") ??
    available[0]
  );
}

async function downloadSubtitles(
  s: YouTubeSettings,
  meta: Meta,
  dir: string,
  auto: boolean,
): Promise<TranscriptLine[] | undefined> {
  const pool = Object.keys(
    (auto ? meta.automatic_captions : meta.subtitles) ?? {},
  ).filter((l) => l !== "live_chat");
  // Auto captions: prefer the original-language track ("fr-orig") over translations.
  const original = auto ? pool.find((l) => l.endsWith("-orig")) : undefined;
  const lang = original ?? pickLanguage(pool, meta.language);
  if (!lang) return undefined;
  const prefix = auto ? "autosubs" : "subs";
  const res = await run(
    s.ytDlpPath,
    [
      "--no-playlist",
      "--no-warnings",
      "--skip-download",
      auto ? "--write-auto-subs" : "--write-subs",
      "--sub-langs",
      lang,
      "--sub-format",
      "vtt/srt/best",
      "--convert-subs",
      "srt",
      ...ffmpegLocationArgs(s.ffmpegPath),
      "-o",
      join(dir, `${prefix}.%(ext)s`),
      youTubeWatchUrl(meta.id),
    ],
    5 * 60 * 1000,
  );
  if (res.code !== 0) return undefined;
  const file = readdirSync(dir).find(
    (f) => f.startsWith(`${prefix}.`) && f.endsWith(".srt"),
  );
  if (!file) return undefined;
  const srt = readFileSync(join(dir, file), "utf8");
  const lines = auto ? parseRollingSrt(srt) : parseSrt(srt);
  return lines.length > 0 ? lines : undefined;
}

/**
 * Metadata, a ≤maxHeight copy and subtitles of a YouTube video, cached.
 * `wantAutoCaptions`: use YouTube's auto captions when there are no manual
 * subtitles (set false when a local speech-to-text is configured).
 */
export async function fetchYouTube(
  s: YouTubeSettings,
  id: string,
  wantAutoCaptions: boolean,
  progress: (msg: string) => void,
): Promise<YouTubeVideo> {
  const dir = join(getDataDir(), "video-cache", `yt-${id}`);
  mkdirSync(dir, { recursive: true });
  const cached = join(dir, "youtube.json");
  if (existsSync(cached)) {
    const v = JSON.parse(readFileSync(cached, "utf8")) as YouTubeVideo;
    if (existsSync(v.file)) return v;
  }

  progress(`YouTube ${id} : lecture des informations…`);
  const metaRes = await run(
    s.ytDlpPath,
    ["--dump-json", "--no-playlist", "--no-warnings", youTubeWatchUrl(id)],
    2 * 60 * 1000,
  );
  if (metaRes.code !== 0) {
    throw new Error(
      `YouTube video unavailable (${metaRes.stderr.trim().split("\n").pop() ?? metaRes.code})`,
    );
  }
  const meta = JSON.parse(metaRes.stdout) as Meta;
  if (meta.is_live) throw new Error("live streams are not supported");
  if (meta.duration && meta.duration > s.maxDurationSeconds) {
    throw new Error(
      `the video lasts ${formatTimestamp(meta.duration)}, above the ${formatTimestamp(s.maxDurationSeconds)} limit (server.video.youtube.maxDurationSeconds)`,
    );
  }

  progress(
    `YouTube : téléchargement en ${s.maxHeight}p (${formatTimestamp(meta.duration ?? 0)})…`,
  );
  const h = s.maxHeight;
  const dl = await run(
    s.ytDlpPath,
    [
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      "-f",
      `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/w`,
      "--merge-output-format",
      "mp4",
      ...ffmpegLocationArgs(s.ffmpegPath),
      "-o",
      join(dir, "video.%(ext)s"),
      youTubeWatchUrl(id),
    ],
    60 * 60 * 1000,
  );
  const file = readdirSync(dir)
    .map((f) => join(dir, f))
    .find((f) => /[\\/]video\.(mp4|mkv|webm)$/.test(f));
  if (dl.code !== 0 || !file) {
    throw new Error(
      `download failed (${dl.stderr.trim().split("\n").pop() ?? dl.code})`,
    );
  }

  progress("YouTube : sous-titres…");
  let transcript = await downloadSubtitles(s, meta, dir, false);
  let transcriptNote: string | undefined;
  if (transcript) {
    transcriptNote = "subtitles from YouTube";
  } else if (wantAutoCaptions) {
    transcript = await downloadSubtitles(s, meta, dir, true);
    if (transcript)
      transcriptNote =
        "YouTube auto-generated captions (may contain recognition errors)";
  }

  const video: YouTubeVideo = {
    file,
    source: {
      id,
      url: youTubeWatchUrl(id),
      title: meta.title ?? id,
      channel: meta.channel ?? meta.uploader ?? "",
      uploadDate: meta.upload_date
        ? `${meta.upload_date.slice(0, 4)}-${meta.upload_date.slice(4, 6)}-${meta.upload_date.slice(6, 8)}`
        : undefined,
      description: meta.description?.slice(0, 1500),
    },
    transcript,
    transcriptNote,
  };
  writeFileSync(cached, JSON.stringify(video, null, 1));
  return video;
}
