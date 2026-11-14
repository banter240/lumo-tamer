/**
 * Thin ffmpeg/ffprobe wrappers for local video analysis.
 *
 * Arguments are always passed as an argv array (no shell), so file names with
 * spaces, brackets or quotes are safe.
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(
  command: string,
  args: string[],
  timeoutMs = 10 * 60 * 1000,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `${command} timed out after ${Math.round(timeoutMs / 1000)}s`,
        ),
      );
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => {
      stderr += d;
      if (stderr.length > 4_000_000) stderr = stderr.slice(-2_000_000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export interface VideoProbe {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export async function probe(
  ffprobe: string,
  file: string,
): Promise<VideoProbe> {
  const res = await run(
    ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,width,height",
      "-of",
      "json",
      file,
    ],
    60_000,
  );
  if (res.code !== 0) {
    throw new Error(
      `ffprobe failed: ${res.stderr.trim().split("\n").pop() ?? res.code}`,
    );
  }
  const json = JSON.parse(res.stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };
  const video = json.streams?.find((s) => s.codec_type === "video");
  const duration = Number(json.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("not a readable video (no video stream or duration)");
  }
  return {
    duration,
    width: video.width ?? 0,
    height: video.height ?? 0,
    hasAudio: !!json.streams?.some((s) => s.codec_type === "audio"),
  };
}

/** Timestamps (seconds) where the picture changes more than `threshold`. */
export async function sceneChanges(
  ffmpeg: string,
  file: string,
  threshold: number,
): Promise<number[]> {
  const res = await run(
    ffmpeg,
    [
      "-hide_banner",
      "-nostats",
      "-i",
      file,
      "-an",
      "-sn",
      "-vf",
      `scale=320:-2,select='gt(scene\\,${threshold})',showinfo`,
      "-f",
      "null",
      "-",
    ],
    30 * 60 * 1000,
  );
  if (res.code !== 0) return [];
  const out: number[] = [];
  for (const m of res.stderr.matchAll(/pts_time:([\d.]+)/g))
    out.push(Number(m[1]));
  return out;
}

/** Text for drawtext: `:` and `'` must be escaped inside the filter. */
function drawtextLabel(label: string): string {
  return label.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
}

function fontOption(): string {
  const win = "C:/Windows/Fonts/arial.ttf";
  if (process.platform === "win32" && existsSync(win)) {
    return `fontfile='C\\:/Windows/Fonts/arial.ttf':`;
  }
  return "";
}

/** One frame at `seconds`, letterboxed to width×height, with a time label. */
export async function extractFrame(
  ffmpeg: string,
  file: string,
  seconds: number,
  out: string,
  opts: { width: number; height: number; label: string },
): Promise<void> {
  const { width, height } = opts;
  const fontSize = Math.max(14, Math.round(height / 12));
  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    `drawtext=${fontOption()}text='${drawtextLabel(opts.label)}':x=6:y=6:fontsize=${fontSize}:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=5`,
  ].join(",");
  const res = await run(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      seconds.toFixed(3),
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      vf,
      "-q:v",
      "3",
      out,
    ],
    120_000,
  );
  if (res.code !== 0 || !existsSync(out)) {
    throw new Error(
      `frame at ${seconds.toFixed(1)}s failed: ${res.stderr.trim().split("\n").pop() ?? res.code}`,
    );
  }
}

/** Tile `dir/<prefix>NN.jpg` (1-based, consecutive) into one cols×rows sheet. */
export async function tileSheet(
  ffmpeg: string,
  dir: string,
  prefix: string,
  cols: number,
  rows: number,
  out: string,
): Promise<void> {
  const res = await run(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-framerate",
      "1",
      "-start_number",
      "1",
      "-i",
      join(dir, `${prefix}%02d.jpg`),
      "-vf",
      `tile=${cols}x${rows}:padding=4:color=black`,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      out,
    ],
    120_000,
  );
  if (res.code !== 0 || !existsSync(out)) {
    throw new Error(
      `contact sheet failed: ${res.stderr.trim().split("\n").pop() ?? res.code}`,
    );
  }
}

/** 16 kHz mono WAV for speech-to-text. */
export async function extractAudio(
  ffmpeg: string,
  file: string,
  out: string,
): Promise<void> {
  const res = await run(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      file,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      out,
    ],
    30 * 60 * 1000,
  );
  if (res.code !== 0 || !existsSync(out)) {
    throw new Error(
      `audio extraction failed: ${res.stderr.trim().split("\n").pop() ?? res.code}`,
    );
  }
}
