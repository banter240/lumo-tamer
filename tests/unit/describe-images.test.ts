import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { describeAttachedImages } from "../../src/vision/describe-images.js";
import { selectImageTools, userWords } from "../../src/lumo-client/images.js";
import { asksForWeb } from "../../src/lumo-client/web-intent.js";
import { setDataDir } from "../../src/app/paths.js";
import { Role, type Turn } from "../../src/lumo-client/types.js";

const img = (id: string) => ({ encrypted: false, image_id: id, data: "AAAA" });

describe("appended descriptions never count as the user's request", () => {
  it("ignores words from the description for web and image intent (seen live: 'YOU NEWS' turned on web search)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lt-desc-"));
    setDataDir(dir);
    try {
      const turns: Turn[] = [
        {
          role: Role.User,
          content: "les menus en bas doivent être plus haut",
          images: [img("tcg")],
        },
      ];
      const out = await describeAttachedImages(turns, {
        describe: async () =>
          'Capture du téléphone : en-tête "TCG MARKET — YOU NEWS COLLECTIBLES", dernières news, bouton "Générer une image", heure 1:59.',
        progress: () => {},
      });
      expect(out[0].content).toContain("YOU NEWS");
      expect(asksForWeb(out)).toBe(false);
      expect(selectImageTools(out)).toEqual(["describe_image"]);
      expect(userWords(out[0].content ?? "")).toBe(
        "les menus en bas doivent être plus haut",
      );
    } finally {
      setDataDir(undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("describeAttachedImages", () => {
  let dir: string;
  let asked: Turn[];
  const ctx = () => ({
    describe: async (turn: Turn) => {
      asked.push(turn);
      return `description of ${turn.images?.[0].image_id}`;
    },
    progress: () => {},
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lt-desc-"));
    setDataDir(dir);
    asked = [];
  });
  afterEach(() => {
    setDataDir(undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds a description next to an attached screenshot, with the user's text as context", async () => {
    const turns: Turn[] = [
      {
        role: Role.User,
        content: "le menu en bas est trop bas",
        images: [img("shot-1")],
      },
    ];
    const out = await describeAttachedImages(turns, ctx());
    expect(asked).toHaveLength(1);
    expect(asked[0].content).toContain("describe_image");
    expect(asked[0].content).toContain("«le menu en bas est trop bas»");
    expect(out[0].content).toContain("le menu en bas est trop bas");
    expect(out[0].content).toContain("[Attached image 1 — what it shows");
    expect(out[0].content).toContain("description of shot-1");
    expect(out[0].images).toHaveLength(1);
  });

  it("describes each image once and reuses it on every later agent step", async () => {
    const step = (n: number): Turn[] => [
      { role: Role.User, content: "regarde", images: [img("shot-2")] },
      ...Array.from({ length: n }, (_, i) => [
        { role: Role.Assistant, content: "```json\n{}\n```" } as Turn,
        {
          role: Role.User,
          content: `[Tool Result: grep]\nresult ${i}`,
        } as Turn,
      ]).flat(),
    ];
    await describeAttachedImages(step(0), ctx());
    const later = await describeAttachedImages(step(3), ctx());
    expect(asked).toHaveLength(1);
    expect(later[0].content).toContain("description of shot-2");
    expect(existsSync(join(dir, "image-descriptions", "shot-2.txt"))).toBe(
      true,
    );
  });

  it("describes images returned by a tool (read of a .png) with the request before it", async () => {
    const turns: Turn[] = [
      {
        role: Role.User,
        content: "ouvre capture.png et dis-moi ce qui cloche",
      },
      { role: Role.Assistant, content: "```json\n{}\n```" },
      {
        role: Role.User,
        content: "[Tool Result: read]\ncapture.png",
        images: [img("read-1")],
      },
    ];
    const out = await describeAttachedImages(turns, ctx());
    expect(asked[0].content).toContain(
      "«ouvre capture.png et dis-moi ce qui cloche»",
    );
    expect(out[2].content).toMatch(/^\[Tool Result: read\]/);
    expect(out[2].content).toContain("description of read-1");
  });

  it("only describes the images Lumo will receive (most recent 10) and never assistant images", async () => {
    const turns: Turn[] = [
      {
        role: Role.User,
        content: "a",
        images: Array.from({ length: 12 }, (_, i) => img(`old-${i}`)),
      },
      { role: Role.Assistant, content: "voilà", images: [img("generated")] },
    ];
    await describeAttachedImages(turns, ctx());
    const ids = asked.map((t) => t.images?.[0].image_id);
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain("old-0");
    expect(ids).not.toContain("generated");
  });

  it("keeps the turn unchanged when the description fails, and returns the same array without images", async () => {
    const turns: Turn[] = [
      { role: Role.User, content: "x", images: [img("bad")] },
    ];
    const out = await describeAttachedImages(turns, {
      describe: async () => {
        throw new Error("upstream 503");
      },
      progress: () => {},
    });
    expect(out[0].content).toBe("x");
    const plain: Turn[] = [{ role: Role.User, content: "bonjour" }];
    expect(await describeAttachedImages(plain, ctx())).toBe(plain);
  });
});
