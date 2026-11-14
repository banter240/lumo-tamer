/**
 * Pure helpers for video analysis: time formatting, frame picking, and
 * finding video paths / times in user text.
 */

// No "ts": MPEG transport streams share the extension with TypeScript, and
// agent conversations are full of src/**/*.ts paths.
export const VIDEO_EXTENSIONS = [
  "mp4",
  "m4v",
  "mkv",
  "mov",
  "webm",
  "avi",
  "wmv",
  "flv",
  "mpg",
  "mpeg",
  "m2ts",
  "3gp",
];

const EXT = VIDEO_EXTENSIONS.join("|");
// C:\dir\clip.mp4, C:/dir/my clip (1).mov — lazy up to the extension.
const WINDOWS_PATH_RE = new RegExp(
  String.raw`[A-Za-z]:[\\/][^\n"'<>|*?]*?\.(?:${EXT})(?![A-Za-z0-9])`,
  "gi",
);
// /home/me/clip.mp4, ~/Videos/clip.mkv (start of text or after a space/quote/paren).
const POSIX_PATH_RE = new RegExp(
  String.raw`(?:^|[\s"'(\x60])((?:~|\/)[^\n"'<>|*?]*?\.(?:${EXT}))(?![A-Za-z0-9])`,
  "gi",
);
// OpenCode replaces an attached video it cannot send with this line.
const OPENCODE_UNSUPPORTED_VIDEO_RE =
  /ERROR: Cannot read "([^"]+)" \(this model does not support video input\)\. Inform the user\./g;

/** 75 → "01:15", 3725 → "1:02:05". */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * `count` frame times in [from, to): every scene change (just after the cut)
 * plus an even grid, thinned to `count` by repeatedly dropping the point
 * closest to a neighbour (grid points go before scene cuts).
 */
export function pickTimestamps(
  from: number,
  to: number,
  scenes: number[],
  count: number,
): number[] {
  const span = to - from;
  if (span <= 0 || count <= 0) return [];
  const grid = Array.from(
    { length: count },
    (_, i) => from + ((i + 0.5) * span) / count,
  );
  const cuts = scenes
    .map((t) => t + 0.5)
    .filter((t) => t > from && t < to - 0.1);
  const points = [
    ...grid.map((t) => ({ t, cut: false })),
    ...cuts.map((t) => ({ t, cut: true })),
  ].sort((a, b) => a.t - b.t);

  while (points.length > count) {
    let drop = -1;
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
      const prev = i > 0 ? points[i].t - points[i - 1].t : Infinity;
      const next =
        i < points.length - 1 ? points[i + 1].t - points[i].t : Infinity;
      // Grid points are cheaper to drop than real scene cuts.
      const gap = Math.min(prev, next) * (points[i].cut ? 2 : 1);
      if (gap < best) {
        best = gap;
        drop = i;
      }
    }
    points.splice(drop, 1);
  }
  return points.map((p) => Math.round(p.t * 10) / 10);
}

/** Local video paths named in the text, in order, without duplicates. */
export function findVideoPaths(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(WINDOWS_PATH_RE)) found.push(m[0].trim());
  for (const m of text.matchAll(POSIX_PATH_RE)) found.push(m[1].trim());
  return [...new Set(found)];
}

/** File names OpenCode could not send ("ERROR: Cannot read …video input"). */
export function findUnsupportedVideoNotices(text: string): string[] {
  return [...text.matchAll(OPENCODE_UNSUPPORTED_VIDEO_RE)].map((m) => m[1]);
}

export function replaceUnsupportedVideoNotices(
  text: string,
  hint: (name: string) => string,
): string {
  return text.replace(OPENCODE_UNSUPPORTED_VIDEO_RE, (_all, name: string) =>
    hint(name),
  );
}

/**
 * Times like "14:20", "1:02:05" or "à 3:07" mentioned in the text, within
 * [0, duration]. Clock-like values beyond the duration are ignored.
 */
export function findTimestamps(text: string, duration: number): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(
    /(?<![\d:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?![\d:])/g,
  )) {
    const h = m[1] ? Number(m[1]) : 0;
    const min = Number(m[2]);
    const sec = Number(m[3]);
    if (sec >= 60 || (m[1] && min >= 60)) continue;
    const t = h * 3600 + min * 60 + sec;
    if (t <= duration + 1) out.push(t);
  }
  return [...new Set(out)];
}
