import { describe, it, expect } from "vitest";
import {
  parseImageUrl,
  limitImages,
  stripImages,
  encryptTurnImages,
  hasPlaintextImages,
  MAX_IMAGES_PER_REQUEST,
  extractGeneratedImages,
  generatedImageMarkdown,
  stableImageId,
  imagePayloadChars,
  shouldOfferImageTools,
  selectImageTools,
} from "../../src/lumo-client/images.js";
import { selectNativeTools } from "../../src/lumo-client/native-tools.js";
import { Role, type Turn } from "../../src/lumo-client/types.js";
import { decryptUint8Array } from "@lumo/crypto/index.js";
import {
  generateRequestId,
  generateRequestKey,
  RequestEncryptionParams,
} from "@lumo/lib/lumo-api-client/core/encryptionParams.js";

const PNG_B64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]).toString("base64");

const img = (id: string) => ({ encrypted: false, image_id: id, data: PNG_B64 });

describe("parseImageUrl", () => {
  it("accepts base64 data URLs of supported types", () => {
    const r = parseImageUrl(`data:image/png;base64,${PNG_B64}`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.image.data).toBe(PNG_B64);
      expect(r.image.encrypted).toBe(false);
      expect(r.image.image_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  });

  it("rejects malformed base64 payloads", () => {
    expect(parseImageUrl("data:image/png;base64,not*base64!!").ok).toBe(false);
    expect(parseImageUrl("data:image/png;base64,abc").ok).toBe(false); // bad length
    expect(parseImageUrl("data:image/png;base64,ab=c").ok).toBe(false); // padding inside
  });

  it("imagePayloadChars counts only image data", () => {
    expect(
      imagePayloadChars([
        { role: Role.User, content: "hello", images: [img("1"), img("2")] },
        { role: Role.Assistant, content: "x" },
      ]),
    ).toBe(PNG_B64.length * 2);
  });

  it("rejects remote URLs (no fetching from the proxy)", () => {
    const r = parseImageUrl("https://example.com/cat.png");
    expect(r.ok).toBe(false);
  });

  it("rejects unsupported MIME types", () => {
    const r = parseImageUrl("data:image/svg+xml;base64,PHN2Zz4=");
    expect(r.ok).toBe(false);
  });
});

describe("generated images", () => {
  it("round-trips markdown -> marker + WireImage", () => {
    const md = `Here:${generatedImageMarkdown("abc", PNG_B64)}Nice?`;
    expect(md).toContain(`![lumo:abc](data:image/png;base64,${PNG_B64})`);
    const { content, images } = extractGeneratedImages(md);
    expect(content).toBe(
      'Here:\n\n<lumo-image id="abc" source="assistant" />\n\nNice?',
    );
    expect(images).toEqual([
      { encrypted: false, image_id: "abc", data: PNG_B64 },
    ]);
  });

  it("leaves ordinary markdown images alone", () => {
    const text = "![cat](https://example.com/cat.png)";
    expect(extractGeneratedImages(text)).toEqual({ content: text, images: [] });
  });

  it("stableImageId is deterministic and UUID-shaped", () => {
    expect(stableImageId(PNG_B64)).toBe(stableImageId(PNG_B64));
    expect(stableImageId(PNG_B64)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe("selectNativeTools", () => {
  it("adds image tools independently of internal tools", () => {
    expect(
      selectNativeTools({
        includeInternal: false,
        webSearch: false,
        imageTools: true,
      }),
    ).toEqual(["generate_image", "describe_image", "edit_image"]);
    expect(
      selectNativeTools({ includeInternal: false, webSearch: false }),
    ).toEqual([]);
    expect(
      selectNativeTools({
        includeInternal: false,
        webSearch: false,
        imageTools: ["describe_image"],
      }),
    ).toEqual(["describe_image"]);
  });
});

describe("shouldOfferImageTools", () => {
  const user = (content: string, images?: ReturnType<typeof img>[]): Turn => ({
    role: Role.User,
    content,
    ...(images ? { images } : {}),
  });

  it("ignores OpenCode instruction notices (skills list, date)", () => {
    const skills =
      "The available skills have changed. This list supersedes the previous available skills list.\n- image-gen: Generate images and draw illustrations\n- web: search the web for the latest news";
    expect(
      selectImageTools([
        user("tu as redémarré la ressource ?"),
        { role: Role.Assistant, content: "ok" },
        user(skills),
      ]),
    ).toEqual([]);
    expect(selectImageTools([user("Today's date is now: Fri Nov 13 2026")])).toEqual([]);
  });

  it("ignores OpenCode's post-compaction checkpoint and shell notices", () => {
    const checkpoint = [
      "## Objective",
      "- Créer une icône pour l'app Compta et générer une image de fond",
      "## Work State",
      "### Completed",
      "- (none)",
      "### Active",
      "- dessine le logo",
      "## Next Move",
      "1. Chercher sur internet la dernière version d'ox_lib",
    ].join("\n");
    expect(selectImageTools([user(checkpoint)])).toEqual([]);
    expect(
      selectImageTools([
        user("dessine-moi un chat"),
        { role: Role.Assistant, content: "ok" },
        user("Fais un résumé"),
        user('<shell id="sh_1" state="completed" command="x">image</shell>'),
      ]),
    ).toEqual([]);
  });
  const asst = (content: string, images?: ReturnType<typeof img>[]): Turn => ({
    role: Role.Assistant,
    content,
    ...(images ? { images } : {}),
  });
  const toolResult = user("[Tool Result: bash]\nok");

  it("offers tools when the user asks for a picture", () => {
    for (const text of [
      "Dessine-moi un chat roux",
      "génère une image de montagne",
      "Peux-tu me créer un logo ?",
      "make a logo for my app",
      "Create an app icon",
      "draw a cat",
      "Pinta un gato",
      "Male einen Hund",
      "genera un'immagine di un cane",
    ]) {
      expect(shouldOfferImageTools([user(text)]), text).toBe(true);
    }
  });

  it("does not offer tools for ordinary requests or mere mentions of images", () => {
    for (const text of [
      "Corrige le bug dans server.ts",
      "lance les tests",
      "Pourquoi cette image ne s'affiche pas dans le README ?",
      "update the docker image",
      "crée une image docker pour le projet",
      "the avatar component crashes",
    ]) {
      expect(shouldOfferImageTools([user(text)]), text).toBe(false);
    }
  });

  it("offers tools when the user attaches an image, even with neutral text", () => {
    expect(shouldOfferImageTools([user("ok", [img("1")])])).toBe(true);
  });

  it("picks only the tools the message asks for", () => {
    // Screenshot sent for context: describe only, never edit or generate.
    expect(
      selectImageTools([
        user("Voici mon serveur FiveM, explore le code pour trouver le bug", [
          img("1"),
        ]),
      ]),
    ).toEqual(["describe_image"]);
    expect(
      selectImageTools([
        user("ajoute un script de spawn, voir la capture", [img("1")]),
      ]),
    ).toEqual(["describe_image"]);
    // Explicit edit of the attached picture.
    expect(
      selectImageTools([
        user("change la couleur du t-shirt sur cette photo en rouge", [
          img("1"),
        ]),
      ]).sort(),
    ).toEqual(["describe_image", "edit_image"]);
    // Generation without attachment.
    expect(selectImageTools([user("dessine un chat")])).toEqual([
      "generate_image",
    ]);
    // Follow-up on a generated image.
    const history = [
      user("dessine un chat"),
      asst('<lumo-image id="a" source="assistant" />', [img("a")]),
    ];
    expect(
      selectImageTools([...history, user("rends-le bleu")]).sort(),
    ).toEqual(["describe_image", "edit_image"]);
    expect(
      selectImageTools([...history, user("merci, maintenant lis server.ts")]),
    ).toEqual([]);
  });

  it("ignores image markers when looking for intent", () => {
    expect(
      shouldOfferImageTools([user('<lumo-image id="1" source="user" /> ok')]),
    ).toBe(false);
  });

  it("never offers tools on title / compaction requests", () => {
    expect(
      shouldOfferImageTools(
        [user("dessine un chat")],
        "You are a title generator. You output ONLY a thread title. Nothing else.",
      ),
    ).toBe(false);
    const history = [
      user("dessine un chat"),
      asst('<lumo-image id="a" source="assistant" />', [img("a")]),
    ];
    expect(
      shouldOfferImageTools([
        ...history,
        user(
          "You MUST summarize the conversation above into a structured summary.",
        ),
      ]),
    ).toBe(false);
  });

  it("does not offer tools just because an older image is in the history", () => {
    expect(
      shouldOfferImageTools([
        user("dessine un chat"),
        asst('<lumo-image id="a" source="assistant" />', [img("a")]),
        user("merci"),
        asst("De rien !"),
        user("corrige le bug dans server.ts"),
      ]),
    ).toBe(false);
  });

  it("does not re-draw on tool-loop steps after an image was generated", () => {
    expect(
      shouldOfferImageTools([
        user("dessine un chat"),
        asst('<lumo-image id="a" source="assistant" />', [img("a")]),
        toolResult,
      ]),
    ).toBe(false);
  });

  it("allows follow-up edits on a conversation with images, but not mid tool loop", () => {
    const history = [
      user("dessine un chat"),
      asst('<lumo-image id="a" source="assistant" />', [img("a")]),
    ];
    expect(shouldOfferImageTools([...history, user("rends-le bleu")])).toBe(
      true,
    );
    expect(
      shouldOfferImageTools([
        ...history,
        user("lis server.ts"),
        asst("```json\n{}\n```"),
        toolResult,
      ]),
    ).toBe(false);
  });
});

describe("limitImages", () => {
  it("keeps only the most recent images", () => {
    const turns: Turn[] = [
      {
        role: Role.User,
        content: "old",
        images: Array.from({ length: 8 }, (_, i) => img(`a${i}`)),
      },
      { role: Role.Assistant, content: "ok" },
      {
        role: Role.User,
        content: "new",
        images: Array.from({ length: 5 }, (_, i) => img(`b${i}`)),
      },
    ];
    const limited = limitImages(turns);
    const ids = limited.flatMap((t) => t.images?.map((i) => i.image_id) ?? []);
    expect(ids).toHaveLength(MAX_IMAGES_PER_REQUEST);
    expect(ids.slice(-5)).toEqual(["b0", "b1", "b2", "b3", "b4"]);
    expect(ids[0]).toBe("a3");
    expect(limited[0].content).toBe("old");
  });

  it("stripImages removes all images", () => {
    const out = stripImages([
      { role: Role.User, content: "x", images: [img("1")] },
    ]);
    expect(out[0]).toEqual({ role: Role.User, content: "x" });
  });
});

describe("encryptTurnImages", () => {
  it("encrypts image bytes with the request key and request AD (U2L)", async () => {
    const params = new RequestEncryptionParams(
      await generateRequestKey(),
      generateRequestId(),
    );
    const turns: Turn[] = [
      { role: Role.User, content: "hi", images: [img("1")] },
    ];

    const out = await encryptTurnImages(turns, params);

    expect(hasPlaintextImages(out)).toBe(false);
    const enc = out[0].images![0];
    expect(enc.encrypted).toBe(true);
    expect(enc.image_id).toBe("1");
    expect(enc.data).not.toBe(PNG_B64);

    // Round-trip with the same AD the server uses for request turns.
    const ad = RequestEncryptionParams.getRequestAd(params.requestId);
    const plain = await decryptUint8Array(enc.data, params.requestKey, ad);
    expect(Buffer.from(plain).toString("base64")).toBe(PNG_B64);

    // Wrong AD must fail (AEAD binding to this request).
    await expect(
      decryptUint8Array(enc.data, params.requestKey, "lumo.request.other.turn"),
    ).rejects.toThrow();
  });

  it("detects plaintext images", () => {
    expect(hasPlaintextImages([{ role: Role.User, images: [img("1")] }])).toBe(
      true,
    );
    expect(hasPlaintextImages([{ role: Role.User, content: "x" }])).toBe(false);
  });
});
