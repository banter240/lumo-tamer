import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  findTimestamps,
  findUnsupportedVideoNotices,
  findVideoPaths,
  formatTimestamp,
  pickTimestamps,
} from "../../src/video/timestamps.js";
import { parseSrt, type VideoSettings } from "../../src/video/analyze.js";
import { prepareVideoTurns } from "../../src/video/inject.js";
import {
  findYouTubeIds,
  parseRollingSrt,
  youTubeWatchUrl,
} from "../../src/video/youtube.js";
import { setDataDir } from "../../src/app/paths.js";
import { Role, type Turn } from "../../src/lumo-client/types.js";

describe("YouTube links", () => {
  it("extracts video ids from the usual link shapes, nothing else", () => {
    expect(
      findYouTubeIds(
        "regarde https://www.youtube.com/watch?v=jNQXAC9IVRw&t=5s et youtu.be/dQw4w9WgXcQ?si=x, " +
          "m.youtube.com/shorts/abcdefghijk puis https://www.youtube.com/watch?feature=share&v=jNQXAC9IVRw",
      ),
    ).toEqual(["jNQXAC9IVRw", "dQw4w9WgXcQ", "abcdefghijk"]);
    expect(
      findYouTubeIds(
        "https://evil.example/watch?v=jNQXAC9IVRw https://youtube.com.evil.example/x",
      ),
    ).toEqual([]);
    expect(
      findYouTubeIds(
        "youtube.com/@channel https://www.youtube.com/playlist?list=PL123",
      ),
    ).toEqual([]);
  });

  it("always rebuilds the URL on youtube.com", () => {
    expect(youTubeWatchUrl("jNQXAC9IVRw")).toBe(
      "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    );
  });

  it("un-rolls YouTube auto-captions", () => {
    const srt = [
      "1\n00:00:00,000 --> 00:00:02,000\nbonjour à tous\n",
      "2\n00:00:02,000 --> 00:00:04,000\nbonjour à tous\naujourd'hui on va voir\n",
      "3\n00:00:04,000 --> 00:00:06,000\naujourd'hui on va voir\nle serveur dev\n",
    ].join("\n");
    expect(parseRollingSrt(srt).map((l) => l.text)).toEqual([
      "bonjour à tous",
      "aujourd'hui on va voir",
      "le serveur dev",
    ]);
  });
});

describe("video helpers", () => {
  it("formats times", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(75.9)).toBe("01:15");
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });

  it("finds Windows and POSIX video paths, with spaces and brackets", () => {
    expect(
      findVideoPaths(
        "regarde C:\\Users\\aloiz\\Videos\\bug [test] (1).mp4 et dis-moi, puis /home/me/clip.MKV ou ~/v/a.webm",
      ),
    ).toEqual([
      "C:\\Users\\aloiz\\Videos\\bug [test] (1).mp4",
      "/home/me/clip.MKV",
      "~/v/a.webm",
    ]);
    expect(
      findVideoPaths("le fichier config.ts et https://x.y/a.mp4html"),
    ).toEqual([]);
    // TypeScript sources are not MPEG-TS videos (seen live: every message ran ffprobe on *.ts).
    expect(
      findVideoPaths(
        "regarde C:\\Users\\aloiz\\lumo-tamer\\src\\lumo-client\\images.ts et C:/x/tests/unit/video.test.ts",
      ),
    ).toEqual([]);
  });

  it("detects OpenCode's unsupported-video notice", () => {
    expect(
      findUnsupportedVideoNotices(
        'ERROR: Cannot read "clip.mp4" (this model does not support video input). Inform the user.',
      ),
    ).toEqual(["clip.mp4"]);
  });

  it("finds asked-about times within the video", () => {
    expect(
      findTimestamps("que se passe-t-il à 14:20 puis 1:02:05 ?", 4000),
    ).toEqual([860, 3725]);
    expect(findTimestamps("à 14:20", 600)).toEqual([]);
    expect(findTimestamps("ratio 3:75", 600)).toEqual([]);
  });

  it("keeps scene cuts and spreads the rest", () => {
    const t = pickTimestamps(0, 180, [60, 120], 9);
    expect(t).toHaveLength(9);
    expect(t).toContain(60.5);
    expect(t).toContain(120.5);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    expect(pickTimestamps(0, 10, [], 3)).toEqual([1.7, 5, 8.3]);
  });

  it("drops Whisper's repeated filler lines on silence", () => {
    const srt =
      [0, 30, 60, 90]
        .map(
          (s, i) =>
            `${i + 1}\n00:0${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")},000 --> 00:0${Math.floor(s / 60)}:${String((s % 60) + 2).padStart(2, "0")},000\nThank you.\n`,
        )
        .join("\n") +
      "\n5\n00:03:05,000 --> 00:03:10,000\nBonjour, on redémarre la ressource.\n";
    expect(parseSrt(srt)).toEqual([
      { start: 185, end: 190, text: "Bonjour, on redémarre la ressource." },
    ]);
  });

  it("parses SRT", () => {
    expect(
      parseSrt(
        "1\r\n00:00:01,000 --> 00:00:02,500\r\nBonjour\r\ntout le monde\r\n\r\n2\r\n00:01:00,000 --> 00:01:01,000\r\nSalut\r\n",
      ),
    ).toEqual([
      { start: 1, end: 2.5, text: "Bonjour tout le monde" },
      { start: 60, end: 61, text: "Salut" },
    ]);
  });
});

const hasFfmpeg =
  spawnSync("ffmpeg", ["-version"], { windowsHide: true }).status === 0;

describe.skipIf(!hasFfmpeg)("prepareVideoTurns with ffmpeg", () => {
  let dir: string;
  let shortVideo: string;
  let longVideo: string;
  const settings: VideoSettings = {
    ffmpegPath: "ffmpeg",
    ffprobePath: "ffprobe",
    shortVideoSeconds: 30,
    segmentSeconds: 20,
    overviewSheets: 2,
    sceneThreshold: 0.3,
    transcribeCommand: [],
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lt-video-"));
    setDataDir(dir);
    shortVideo = join(dir, "short clip.mp4");
    longVideo = join(dir, "long.mp4");
    for (const [out, secs] of [
      [shortVideo, 12],
      [longVideo, 50],
    ] as const) {
      const r = spawnSync(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          `testsrc2=size=320x180:rate=10:duration=${secs}`,
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          out,
        ],
        { windowsHide: true },
      );
      expect(r.status).toBe(0);
    }
  }, 60_000);

  afterAll(() => {
    setDataDir(undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  const user = (content: string): Turn => ({ role: Role.User, content });
  const noSummary = async () => {
    throw new Error("should not summarize a short video");
  };

  it("attaches contact sheets and a legend for a short video", async () => {
    const turns = [user(`Que montre ${shortVideo} ?`)];
    const out = await prepareVideoTurns(turns, {
      settings,
      summarize: noSummary,
      progress: () => {},
    });
    expect(out[0].images?.length).toBe(1);
    expect(out[0].content).toContain('[Video "short clip.mp4" — 00:12');
    expect(out[0].content).toMatch(/Sheet 1: 00:0\d/);
    expect(out[0].content).toContain("No transcript");
  }, 60_000);

  it("summarizes a long video by segment, caches, and zooms on asked times", async () => {
    const asked: string[] = [];
    const summarize = async (turn: Turn) => {
      asked.push(turn.content ?? "");
      expect(turn.images).toHaveLength(1);
      return `- résumé ${asked.length}`;
    };
    const turns = [user(`Résume ${longVideo}`)];
    const out = await prepareVideoTurns(turns, {
      settings,
      summarize,
      progress: () => {},
    });
    expect(asked).toHaveLength(3); // 0–20, 20–40, 40–50
    expect(out[0].content).toContain("## 00:20–00:40\n- résumé 2");
    expect(out[0].images?.length).toBe(2); // overview sheets

    // Second question: cached summaries, older turn reduced to a reminder,
    // dense frames around the asked time.
    const follow = [
      user(`Résume ${longVideo}`),
      { role: Role.Assistant, content: "ok" } as Turn,
      user("que se passe-t-il à 00:31 ?"),
    ];
    const out2 = await prepareVideoTurns(follow, {
      settings,
      summarize,
      progress: () => {},
    });
    expect(asked).toHaveLength(3);
    expect(out2[0].images ?? []).toHaveLength(0);
    expect(out2[0].content).toContain("analysed locally earlier");
    expect(out2[2].images).toHaveLength(1);
    expect(out2[2].content).toContain("Detail sheet around 00:31");
    expect(existsSync(join(dir, "video-cache"))).toBe(true);
  }, 120_000);

  it("leaves turns without videos untouched and explains unsupported attachments", async () => {
    const plain = [user("bonjour")];
    expect(
      await prepareVideoTurns(plain, {
        settings,
        summarize: noSummary,
        progress: () => {},
      }),
    ).toBe(plain);
    const notice = [
      user(
        'ERROR: Cannot read "x.mp4" (this model does not support video input). Inform the user.',
      ),
    ];
    const out = await prepareVideoTurns(notice, {
      settings,
      summarize: noSummary,
      progress: () => {},
    });
    expect(out[0].content).toContain("paste its full path");
  });
});
