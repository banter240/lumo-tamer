/**
 * Lumo API client (Lumo 2.0).
 *
 * Talks to Proton's unified `ai/v1/chat/completions` endpoint with optional U2L
 * encryption, streams the OpenAI-style SSE response, surfaces reasoning/thinking,
 * detects native tool calls, and bounces misrouted custom tools.
 */

import { decryptString, decryptUint8Array } from "@lumo/crypto/index.js";
import {
  DEFAULT_LUMO_PUB_KEY,
  encryptTurns,
} from "@lumo/lib/lumo-api-client/core/encryption.js";
import {
  generateRequestId,
  generateRequestKey,
  RequestEncryptionParams,
} from "@lumo/lib/lumo-api-client/core/encryptionParams.js";
import { logger } from "../app/logger.js";
import {
  Role,
  type AesGcmCryptoKey,
  type ProtonApi,
  type RequestId,
  type ToolName,
  type Turn,
  type ParsedToolCall,
  type AssistantMessageData,
  type LumoClientOptions,
  type LumoModelTier,
  type LumoUsage,
  type ChatResult,
} from "./types.js";
import {
  buildChatCompletionsBody,
  LUMO_CHAT_ENDPOINT,
  type LumoCompletionTarget,
} from "./v2-body.js";
import { V2StreamProcessor } from "./v2-stream.js";
import { selectNativeTools } from "./native-tools.js";
import { asksForWeb } from "./web-intent.js";
import {
  getInstructionsConfig,
  getServerInstructionsConfig,
  getLogConfig,
  getConfigMode,
  getCustomToolsConfig,
  getEnableWebSearch,
  getEnableImageTools,
  getServerConfig,
} from "../app/config.js";
import {
  isAnnounceWithoutToolCall,
  isToolCallNarration,
  isBounceableBlankReply,
} from "../api/tools/announce.js";
import { estimatePromptTokens } from "../app/token-estimate.js";
import { injectInstructionsIntoTurns } from "./instructions.js";
import {
  NativeToolCallProcessor,
  type NativeToolCallResult,
} from "../api/tools/native-tool-call-processor.js";
import { postProcessTitle } from "@lumo/lib/lumo-api-client/utils.js";
import {
  bytesToBase64,
  countImages,
  encryptTurnImages,
  generatedImageMarkdown,
  hasPlaintextImages,
  imagePayloadChars,
  limitImages,
  lumoImageMarker,
  stripImages,
  selectImageTools,
} from "./images.js";

/** Native image tool arguments (describe/edit take an image_id) written as text. */
const IMAGE_ARGS_AS_TEXT_RE = /"image_id"\s*:\s*"/;

// Re-export types for external consumers
export type { LumoClientOptions, ChatResult };

/** Encryption context for decrypting a response stream. */
interface EncryptionContext {
  requestKey: AesGcmCryptoKey;
  requestId: RequestId;
}

/** Raw result of a single chat/completions request. */
interface CompletionResult {
  content: string;
  reasoning: string;
  usage?: LumoUsage;
  native: NativeToolCallResult;
}

/** Build the bounce instruction: config text + the misrouted tool call as JSON example.
 *  Includes the prefix in the example JSON so Lumo outputs it correctly. */
function buildBounceInstruction(toolCall: ParsedToolCall): string {
  const instruction = getInstructionsConfig().forToolBounce;

  // In server mode, add the prefix to the tool name in the example
  // (the tool name in toolCall has already been stripped, so we re-add it)
  let toolName = toolCall.name;
  if (getConfigMode() === "server") {
    const prefix = getCustomToolsConfig().prefix;
    if (prefix && !toolName.startsWith(prefix)) {
      toolName = `${prefix}${toolName}`;
    }
  }

  const toolCallJson = JSON.stringify(
    { name: toolName, arguments: toolCall.arguments },
    null,
    2,
  );
  return `${instruction}\n${toolCallJson}`;
}

function buildAnnounceBounceInstruction(): string {
  if (getConfigMode() === "server") {
    return getServerInstructionsConfig().forAnnounceBounce;
  }
  return (
    "Note: your last message announced a tool action but did not emit a tool call. " +
    "Output the tool call NOW as JSON text in a ```json code block. No preamble."
  );
}

export class LumoClient {
  constructor(
    private protonApi: ProtonApi,
    private defaultOptions?: Partial<LumoClientOptions>,
  ) {}

  /**
   * Send a message and stream the response
   */
  async chat(
    message: string,
    onChunk?: (content: string) => void,
    options: LumoClientOptions = {},
  ): Promise<ChatResult> {
    const turns: Turn[] = [{ role: Role.User, content: message }];
    return this.chatWithHistory(turns, onChunk, options);
  }

  /**
   * Process the OpenAI-style SSE stream: decrypt content/reasoning, drain
   * reasoning to its sink, feed native tool calls/results, capture usage.
   */
  private async processStream(
    stream: ReadableStream<Uint8Array>,
    encryptionContext: EncryptionContext | undefined,
    opts: {
      onChunk?: (content: string) => void;
      onReasoning?: (content: string) => void;
      suppressBounce: boolean;
    },
  ): Promise<CompletionResult> {
    const reader = stream.getReader();
    const decoder = new TextDecoder("utf-8");
    const processor = new V2StreamProcessor();
    const nativeToolProcessor = new NativeToolCallProcessor(
      opts.suppressBounce,
    );

    let content = "";
    let reasoning = "";
    let usage: LumoUsage | undefined;
    let suppressChunks = false;
    let abortEarly = false;
    let streamEnded = false;

    // Response chunks (text and image) share one AEAD associated-data string
    // (upstream transforms/decrypt.ts); a divergence here silently breaks decryption.
    const responseChunkAd = () =>
      encryptionContext
        ? `lumo.response.${encryptionContext.requestId}.chunk`
        : "";

    // Decrypt an encrypted chunk. On failure, return null so the caller drops
    // the chunk (matching Proton's client) rather than emitting ciphertext.
    const decrypt = async (
      text: string,
      encrypted?: boolean,
    ): Promise<string | null> => {
      if (encrypted && encryptionContext) {
        const adString = responseChunkAd();
        try {
          return await decryptString(
            text,
            encryptionContext.requestKey,
            adString,
          );
        } catch (error) {
          logger.error({ error }, "Failed to decrypt chunk; dropping");
          return null;
        }
      }
      return text;
    };

    const processMessage = async (
      msg: ReturnType<V2StreamProcessor["processChunk"]>[number],
    ) => {
      switch (msg.type) {
        case "token_data": {
          if (msg.target === "message") {
            const text = await decrypt(msg.content, msg.encrypted);
            if (text === null) break;
            content += text;
            if (!suppressChunks) {
              opts.onChunk?.(text);
            }
          } else if (msg.target === "reasoning") {
            const text = await decrypt(msg.content, msg.encrypted);
            if (text === null) break;
            reasoning += text;
            opts.onReasoning?.(text);
          } else if (msg.target === "tool_call") {
            // Complete tool call (custom-tool misroute path); emitted by finalize().
            if (nativeToolProcessor.feedToolCall(msg.content)) {
              suppressChunks = true;
              abortEarly = true;
            }
          }
          break;
        }
        case "server_tool_call": {
          // Native tool call (e.g. proton_info); normalize into the tool processor.
          const args =
            msg.arguments !== undefined
              ? await decrypt(msg.arguments, msg.encrypted)
              : "";
          if (args === null) break;
          let parsedArgs: unknown = {};
          try {
            parsedArgs = args ? JSON.parse(args) : {};
          } catch {
            parsedArgs = args;
          }
          const json = JSON.stringify({
            name: msg.name,
            arguments: parsedArgs,
          });
          if (nativeToolProcessor.feedToolCall(json)) {
            suppressChunks = true;
            abortEarly = true;
          }
          break;
        }
        case "server_tool_result": {
          const result = await decrypt(msg.content, msg.encrypted);
          if (result === null) break;
          nativeToolProcessor.feedToolResult(result);
          break;
        }
        case "image_data": {
          // Generated/edited image. Encrypted images are AES-GCM ciphertext of the
          // raw bytes under the response AD (upstream transforms/decrypt.ts).
          let base64: string;
          if (msg.encrypted) {
            if (!encryptionContext) {
              logger.error("Encrypted image without request key; dropping");
              break;
            }
            try {
              const adString = responseChunkAd();
              const bytes = await decryptUint8Array(
                msg.data,
                encryptionContext.requestKey,
                adString,
              );
              base64 = bytesToBase64(bytes);
            } catch (error) {
              logger.error({ error }, "Failed to decrypt image; dropping");
              break;
            }
          } else {
            base64 = msg.data;
          }
          logger.info(
            {
              imageId: msg.image_id,
              bytes: Math.floor((base64.length * 3) / 4),
            },
            "Received generated image",
          );
          // Client sees markdown with the image; persisted text keeps only Lumo's marker.
          content += `\n\n${lumoImageMarker(msg.image_id, "assistant")}\n\n`;
          if (!suppressChunks) {
            opts.onChunk?.(generatedImageMarkdown(msg.image_id, base64));
          }
          break;
        }
        case "usage":
          usage = msg.usage;
          break;
        case "harmful":
          throw new Error("API returned harmful");
        case "error":
          throw new Error(
            `API returned error${msg.message ? `: ${msg.message}` : ""}`,
          );
        case "done":
          abortEarly = true;
          break;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          streamEnded = true;
          break;
        }
        const chunk = decoder.decode(value, { stream: true });
        for (const msg of processor.processChunk(chunk)) {
          await processMessage(msg);
        }
        if (abortEarly) break;
      }
      // Flush the decoder and any trailing buffered line + accumulated tool calls.
      const tail = decoder.decode();
      if (tail) {
        for (const msg of processor.processChunk(tail)) {
          await processMessage(msg);
        }
      }
      for (const msg of processor.finalize()) {
        await processMessage(msg);
      }

      nativeToolProcessor.finalize();
      return {
        content,
        reasoning,
        usage,
        native: nativeToolProcessor.getResult(),
      };
    } finally {
      // Cancel the upstream body if we stopped early (e.g. misrouted-tool abort).
      if (!streamEnded) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
      }
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  }

  /** Encrypt (optionally), build the body, POST, and process one completion. */
  private async runCompletion(
    turns: Turn[],
    params: {
      endpoint: string;
      tier: LumoModelTier;
      enableReasoning: boolean;
      tools: ToolName[];
      enableEncryption: boolean;
      target: LumoCompletionTarget;
      onChunk?: (content: string) => void;
      onReasoning?: (content: string) => void;
      suppressBounce: boolean;
    },
  ): Promise<CompletionResult> {
    let processedTurns = turns;
    let encryption: { requestKeyEncB64: string; requestId: string } | undefined;
    let encryptionContext: EncryptionContext | undefined;

    if (params.enableEncryption) {
      const requestKey = await generateRequestKey();
      const requestId = generateRequestId();
      const encryptionParams = new RequestEncryptionParams(
        requestKey,
        requestId,
      );
      const requestKeyEncB64 =
        await encryptionParams.encryptRequestKey(DEFAULT_LUMO_PUB_KEY);
      processedTurns = await encryptTurnImages(
        await encryptTurns(turns, encryptionParams),
        encryptionParams,
      );
      if (hasPlaintextImages(processedTurns)) {
        // Never let an image leave the proxy unencrypted when U2L is on.
        throw new Error(
          "Refusing to send unencrypted image with encryption enabled",
        );
      }
      encryption = { requestKeyEncB64, requestId: encryptionParams.requestId };
      encryptionContext = {
        requestKey: encryptionParams.requestKey,
        requestId: encryptionParams.requestId,
      };
      logger.debug(
        { requestId: encryptionParams.requestId },
        "Completion encryption context",
      );
    }

    const body = buildChatCompletionsBody({
      turns: processedTurns,
      tier: params.tier,
      enableReasoning: params.enableReasoning,
      tools: params.tools,
      encryption,
      encrypted: params.enableEncryption,
      target: params.target,
    });

    // Proton doesn't report prompt_tokens; estimate from request body so
    // clients like OpenCode can make compaction decisions. Image payloads are
    // excluded: base64 bytes are not text tokens and would trigger early compaction.
    const bytes = Math.max(
      0,
      Buffer.byteLength(JSON.stringify(body), "utf8") -
        imagePayloadChars(processedTurns),
    );
    const estimatedPromptTokens = estimatePromptTokens(
      bytes,
      getServerConfig().promptTokenEstimation,
      getServerConfig().promptTokenEstimationFactor ?? 1.0,
    );

    const stream = (await this.protonApi({
      url: params.endpoint,
      method: "post",
      data: body,
      output: "stream",
    })) as ReadableStream<Uint8Array>;

    const result = await this.processStream(stream, encryptionContext, {
      onChunk: params.onChunk,
      onReasoning: params.onReasoning,
      suppressBounce: params.suppressBounce,
    });

    // Attach estimated prompt tokens to usage for downstream reporting.
    if (result.usage) {
      result.usage.prompt_tokens = estimatedPromptTokens;
    }

    return result;
  }

  /**
   * Multi-turn conversation support.
   *
   * Titles use a separate `lumo.target:'title'` completion (Lumo 2.0 no longer
   * co-streams title with the message); it runs concurrently and is non-fatal.
   */
  async chatWithHistory(
    turns: Turn[],
    onChunk?: (content: string) => void,
    options: LumoClientOptions = {},
    /** Internal: prevents infinite bounce loops. Do not set externally. */
    isBounce = false,
  ): Promise<ChatResult> {
    const {
      enableEncryption = this.defaultOptions?.enableEncryption ?? true,
      endpoint = LUMO_CHAT_ENDPOINT,
      requestTitle = false,
      instructions,
      injectInstructionsInto = "first",
      modelTier = this.defaultOptions?.modelTier ?? "auto",
      enableReasoning = this.defaultOptions?.enableReasoning ?? false,
      onReasoning = this.defaultOptions?.onReasoning,
      coachAnnounceWithoutTool = this.defaultOptions
        ?.coachAnnounceWithoutTool ?? false,
    } = options;

    // Routing config: auto (default) defers to the caller's useNativeTools flag
    // (routes pass !ctx.hasCustomTools), always/never force the behavior.
    const routingMode = getServerConfig().customTools.routing.nativeTools;
    const useNativeTools =
      routingMode === "always"
        ? true
        : routingMode === "never"
          ? false
          : (options.useNativeTools ?? true);
    const coachAnnounce = coachAnnounceWithoutTool && !isBounce;
    const bufferedChunks: string[] = [];
    const mainOnChunk = coachAnnounce
      ? (chunk: string) => {
          bufferedChunks.push(chunk);
        }
      : onChunk;

    // Only the most recent images are sent (upstream MAX_IMAGES_PER_REQUEST).
    const imageCount = countImages(turns);
    if (imageCount > 0) {
      const limited = limitImages(turns);
      const dropped = imageCount - countImages(limited);
      logger.info(
        { images: imageCount - dropped, dropped },
        "Sending image input",
      );
      turns = limited;
    }

    const turn = turns[turns.length - 1];
    const logConfig = getLogConfig();

    // Structured per-request anchor: correlates the stream logs that follow
    // (tool detections, bounces, rejections) with this completion.
    logger.debug(
      {
        tier: modelTier,
        turns: turns.length,
        images: countImages(turns),
        encrypted: enableEncryption,
        isBounce,
      },
      "Completion request",
    );

    if (logConfig.messageContent) {
      logger.info(
        `[${turn.role}] ${
          turn.content && turn.content.length > 200
            ? turn.content.substring(0, 200) + "..."
            : turn.content
        } `,
      );
    }

    // Never on bounces (unless the bounce is about an image tool); otherwise
    // only when this turn is about images.
    const offerImageTools = !getEnableImageTools()
      ? []
      : options.imageToolsOverride
        ? options.imageToolsOverride
        : !isBounce
          ? selectImageTools(turns, instructions)
          : [];
    if (offerImageTools.length > 0)
      logger.info(
        { tools: offerImageTools },
        "Offering image tools on this request",
      );

    // Web tools: always in plain chat; in agent mode (client tools, useNativeTools
    // false) only when the user asks for something online, never on bounces.
    const offerWebTools =
      getEnableWebSearch() &&
      (useNativeTools || (!isBounce && asksForWeb(turns, instructions)));
    if (offerWebTools && !useNativeTools)
      logger.info("Offering web search tools on this agent request");

    // Read from config - applies to both server and CLI modes
    const tools = selectNativeTools({
      includeInternal: useNativeTools,
      webSearch: offerWebTools,
      imageTools: offerImageTools,
    });

    // Inject instructions at the last moment (kept out of persisted turns).
    const turnsWithInstructions = instructions
      ? injectInstructionsIntoTurns(turns, instructions, injectInstructionsInto)
      : turns;

    // Title generation is a separate, concurrent, non-fatal completion.
    // Only at the top level: a bounce must not launch its own title request.
    const titlePromise =
      requestTitle && !isBounce
        ? this.runCompletion(stripImages(turns), {
            endpoint,
            tier: modelTier,
            enableReasoning: false,
            tools: [],
            enableEncryption,
            target: "title",
            suppressBounce: true,
          }).catch((error) => {
            logger.warn({ error }, "Title generation failed");
            return null;
          })
        : null;

    const main = await this.runCompletion(turnsWithInstructions, {
      endpoint,
      tier: modelTier,
      enableReasoning,
      tools,
      enableEncryption,
      target: "message",
      onChunk: mainOnChunk,
      onReasoning,
      suppressBounce: isBounce,
    });

    logger.debug(
      {
        usage: main.usage,
        tier: modelTier,
        enableReasoning,
      },
      "Lumo completion usage",
    );

    if (logConfig.messageContent) {
      const responsePreview =
        main.content.length > 200
          ? main.content.substring(0, 200) + "..."
          : main.content;
      logger.info(`[Lumo] ${responsePreview}`);
    }

    // Bounce misrouted tool calls: ask Lumo to re-output as JSON text.
    if (!isBounce && main.native.misrouted && main.native.toolCall) {
      const bounceInstruction = buildBounceInstruction(main.native.toolCall);
      logger.info(
        { tool: main.native.toolCall.name },
        "Bouncing misrouted tool call",
      );

      const bounceTurns: Turn[] = [
        ...turns,
        { role: Role.Assistant, content: main.content },
        { role: Role.User, content: bounceInstruction },
      ];

      // The bounce runs with isBounce=true (no title of its own); carry the
      // title from this top-level attempt so it isn't wasted or re-derived
      // from the synthetic bounce transcript.
      const bounced = await this.chatWithHistory(
        bounceTurns,
        onChunk,
        options,
        true,
      );
      const titleResult = titlePromise ? await titlePromise : null;
      const title = titleResult?.content
        ? postProcessTitle(titleResult.content)
        : bounced.title;
      return { ...bounced, title };
    }

    // Image tool arguments written as text ({"image_id": …} in a code block)
    // instead of calling the native function: nothing runs and the agent
    // stops. Ask once more, with the same image tools offered.
    if (
      !isBounce &&
      offerImageTools.length > 0 &&
      !main.native.toolCall &&
      IMAGE_ARGS_AS_TEXT_RE.test(main.content)
    ) {
      logger.info(
        { tools: offerImageTools },
        "Bouncing image tool call written as text",
      );
      const bounceTurns: Turn[] = [
        ...turns,
        { role: Role.Assistant, content: main.content },
        {
          role: Role.User,
          content:
            `Note: you wrote the image tool's arguments as text, so nothing ran. ` +
            `Call your built-in ${offerImageTools.join(" / ")} function directly now ` +
            `(native function calling, not a JSON code block), then continue.`,
        },
      ];
      const bounced = await this.chatWithHistory(
        bounceTurns,
        onChunk,
        { ...options, imageToolsOverride: offerImageTools },
        true,
      );
      const titleResult = titlePromise ? await titlePromise : null;
      const title = titleResult?.content
        ? postProcessTitle(titleResult.content)
        : bounced.title;
      return { ...bounced, title };
    }

    if (
      coachAnnounce &&
      (isBounceableBlankReply(main.content) ||
        isAnnounceWithoutToolCall(main.content) ||
        isToolCallNarration(main.content))
    ) {
      const bounceInstruction = buildAnnounceBounceInstruction();
      logger.info("Bouncing announce-without-tool narration");
      const bounceTurns: Turn[] = [
        ...turns,
        { role: Role.Assistant, content: main.content },
        { role: Role.User, content: bounceInstruction },
      ];
      const bounced = await this.chatWithHistory(
        bounceTurns,
        onChunk,
        options,
        true,
      );
      const titleResult = titlePromise ? await titlePromise : null;
      const title = titleResult?.content
        ? postProcessTitle(titleResult.content)
        : bounced.title;
      return { ...bounced, title };
    }

    if (coachAnnounce && onChunk && bufferedChunks.length > 0) {
      onChunk(bufferedChunks.join(""));
    }

    // Build message data for persistence.
    const message: AssistantMessageData = { content: main.content };
    if (main.native.toolCall && !main.native.misrouted) {
      message.toolCall = JSON.stringify({
        name: main.native.toolCall.name,
        arguments: main.native.toolCall.arguments,
      });
      if (main.native.toolResult) {
        message.toolResult = main.native.toolResult;
      }
    }

    const titleResult = titlePromise ? await titlePromise : null;
    const title = titleResult?.content
      ? postProcessTitle(titleResult.content)
      : undefined;

    return {
      message,
      reasoning: main.reasoning || undefined,
      usage: main.usage,
      title,
      nativeToolCallFailed: main.native.toolCall
        ? main.native.failed
        : undefined,
      misrouted: main.native.misrouted,
    };
  }
}
