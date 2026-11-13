/**
 * Streaming Tool Detector
 *
 * Locate: fence first, then a raw {"name": blob.
 * Extract: strict JSON, jammed objects, then lenient strings.
 * History [Tool Call]/Done is leftover from older flatten; new history
 * is the same fenced JSON Lumo is instructed to emit.
 *
 * Buffers tool JSON and emits it separately from normal text.
 * Raw JSON brace tracking is delegated to JsonBraceTracker.
 *
 * Own-line `{ "` is treated as a candidate object (pretty-print, OpenAI nested
 * shape). Mid-line only `{"name":` is, so prose JSON is left alone.
 * History echo `[Tool Call: name]` / `Tool Call: name` plus args-only JSON is
 * held until finalize. If a real {"name","arguments"} call arrives in the same
 * stream, the echo is dropped (Lumo often writes both). Otherwise the echo is
 * executed so a lone history-format call still runs.
 * Optional `knownToolNames` rejects example JSON that names a tool the client
 * did not register.
 */

import { JsonBraceTracker } from "./json-brace-tracker.js";
import { advanceJsonScan, newJsonScanState } from "./json-scan.js";
import {
  isToolCallJson,
  parseToolCallJson,
  type ParsedToolCall,
} from "./types.js";
import { logger } from "../../app/logger.js";
import { contentForLog } from "../../app/log-content.js";
import { getCustomToolsConfig } from "../../app/config.js";
import {
  inferToolFromArguments,
  stripToolPrefix,
  type ToolSignature,
} from "./prefix.js";
import { getMetrics } from "../../app/metrics.js";
import {
  extractToolCalls,
  stripFenceNoise,
  stripTrailingFenceJunk,
} from "./extract.js";

type DetectorState = "normal" | "in_code_fence" | "in_raw_json";

export interface ProcessResult {
  /** Normal text to emit as content delta */
  textToEmit: string;
  /** Completed tool calls detected in this chunk */
  completedToolCalls: ParsedToolCall[];
}

export interface StreamingToolDetectorOptions {
  /**
   * Client tool names (unprefixed). When set, JSON that looks like a tool call
   * but names an unknown tool is left as text instead of being executed.
   */
  knownToolNames?: Iterable<string>;
  /**
   * Client tool parameter signatures. A fenced arguments-only object
   * ({"filePath":…,"oldString":…}) with no name and no header is run as the
   * one tool whose parameters it fits.
   */
  toolSignatures?: ToolSignature[];
}

export class StreamingToolDetector {
  private state: DetectorState = "normal";
  private buffer = "";
  /** Opener of the fence currently being buffered, for verbatim re-emit. */
  private fenceOpener = "```\n";
  private pendingText = "";
  private jsonTracker = new JsonBraceTracker();
  private readonly knownToolNames: Set<string> | null;
  /** Set when Lumo echoed `[Tool Call: name]` and the next JSON is arguments-only. */
  private headerToolName: string | null = null;
  /** History-format call held until we know whether a named JSON call follows. */
  private pendingHistoryCall: ParsedToolCall | null = null;
  private sawNamedCall = false;
  /** Unregistered tool names rejected this stream, with how often. Lumo
   * retries the same unknown name when nothing tells it to stop (live:
   * 4x one name, then the upstream 503). */
  private rejectedNames = new Map<string, number>();
  private static readonly REJECT_WARN_THRESHOLD = 2;

  // Line-start / own-line object: any `{ "` (pretty-printed, OpenAI nested shape, …)
  private static readonly LINE_START_JSON = /(?:^|\n)\s*(\{[\n\s]*")/;
  // Mid-line: only objects that start with `"name"` so prose `{ "foo": … }` is left alone.
  // Optional whitespace so both `{"name":` and `{\n  "name":` match.
  private static readonly INLINE_TOOL_JSON = /\{\s*"name"\s*:/;
  // Flattened history Lumo copies: `[Tool Call: bash]`, `Tool Call: bash`, `[Done read]`, `Done read`
  private static readonly HISTORY_HEADER =
    /(?:^|\n|[.:!?])[ \t]*(\[(?:Tool Call:|Done)\s+([^\]]+?)\]|(?:Tool Call:|Done)\s+([A-Za-z0-9_:-]+))[ \t]*(?=\n|$)/i;
  // Markdown title Lumo sometimes puts above an arguments-only block:
  // `**user:shell**` / `` `user:read` `` / `user:edit` on its own line (or
  // glued to the end of a sentence: `…installées :**user:glob**`), then
  // ```{"command":…}``` or {"command":…}. Only matched once that block starts.
  private static readonly MARKDOWN_HEADER =
    /(?:^|\n|[.:!?])[ \t]*((?:\*\*|__|`)?([A-Za-z0-9_-]+:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+)(?:\*\*|__|`)?:?)[ \t]*\n[ \t]*(?:\n[ \t]*)?(?=```|\{)/;
  /** Text of a markdown header, re-emitted if what follows is not a call. */
  private markdownHeaderText: string | null = null;

  constructor(options: StreamingToolDetectorOptions = {}) {
    const names = options.knownToolNames
      ? [...options.knownToolNames].filter(Boolean)
      : [];
    this.knownToolNames = names.length > 0 ? new Set(names) : null;
    this.toolSignatures = options.toolSignatures ?? [];
  }

  private readonly toolSignatures: ToolSignature[];

  /** Fenced arguments-only object → the one client tool it fits, if any. */
  private inferFromArguments(content: string): ParsedToolCall | null {
    if (this.toolSignatures.length === 0) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const args = parsed as Record<string, unknown>;
    if ("name" in args && "arguments" in args) return null;
    const name = inferToolFromArguments(args, this.toolSignatures);
    if (!name || !this.isKnownTool(name)) return null;
    logger.info(
      `Tool call detected (inferred from arguments): ${name} ${contentForLog(args, 80)}`,
    );
    return { name, arguments: args };
  }

  private showSnippet(index: number) {
    return contentForLog(
      this.pendingText.substring(Math.max(index - 7, 0), index + 7),
    );
  }

  /** Why a fence opened at this index — mirrors the opensFenceAt rules. */
  private openedBecause(index: number): string {
    const before = this.pendingText.slice(0, index);
    if (before === "" || /(?:^|\n)[ \t]{0,3}$/.test(before)) {
      return "line-start";
    }
    return "json-tag-before-payload";
  }

  /** First backtick run that actually opens a fence, or null. */
  private findFenceOpener(): { index: number; matched: string } | null {
    const re = /```(?:json)?\s*\n?/g;
    for (const m of this.pendingText.matchAll(re)) {
      if (m.index !== undefined && this.opensFenceAt(m.index, m[0])) {
        return { index: m.index, matched: m[0] };
      }
    }
    return null;
  }

  /**
   * CommonMark: fences open at line start (up to 3 spaces indent).
   * Mid-line, only a ```json tag directly before its payload opens a fence
   * (Lumo emits tool fences right after a colon). A bare inline ``` in
   * prose never does: it would buffer prose as a fake code body and
   * swallow the next real tool call into that buffer.
   */
  private opensFenceAt(index: number, matched: string): boolean {
    const before = this.pendingText.slice(0, index);
    if (before === "" || /(?:^|\n)[ \t]{0,3}$/.test(before)) return true;
    if (!matched.startsWith("```json")) return false;
    // Chunk boundary: defer instead of opening speculatively — prose after
    // the tag must not become fence body. The keep-tail holds the tag until
    // the next chunk shows what follows.
    const after = this.pendingText.slice(index + matched.length);
    return /^\{/.test(after);
  }

  public getPendingText() {
    return this.pendingText;
  }

  /**
   * Process an incoming chunk and return what should be emitted.
   */
  processChunk(chunk: string): ProcessResult {
    const result: ProcessResult = {
      textToEmit: "",
      completedToolCalls: [],
    };

    // Add chunk to pending for processing
    this.pendingText += chunk;

    while (this.pendingText.length > 0) {
      const prevPendingLength = this.pendingText.length;
      const prevState = this.state;

      if (this.state === "normal") {
        this.processNormalState(result);
      } else if (this.state === "in_code_fence") {
        this.processCodeFenceState(result);
      } else if (this.state === "in_raw_json") {
        this.processRawJsonState(result);
      }

      // Safety: if we didn't make any progress, break to avoid infinite loop
      // Progress = consumed pending text OR changed state
      const madeProgress =
        this.pendingText.length < prevPendingLength || this.state !== prevState;
      if (!madeProgress) {
        // Need more data - keep buffering
        break;
      }
    }

    return result;
  }

  /**
   * Process normal state - looking for start of JSON patterns.
   */
  private processNormalState(result: ProcessResult): void {
    if (this.headerToolName) {
      const ws = this.pendingText.match(/^[ \t\n]*/)?.[0] ?? "";
      const rest = this.pendingText.slice(ws.length);
      if (rest.startsWith("{")) {
        this.pendingText = rest;
        this.state = "in_raw_json";
        this.jsonTracker.reset();
        return;
      }
      if (rest.startsWith("```") && this.markdownHeaderText !== null) {
        // Fall through to fence detection; the header waits for its block.
      } else if (rest.length > 0) {
        this.dropHeader(result);
      } else {
        return;
      }
    }

    // `**user:shell**` + block: the header comes before the fence it names.
    const opener = this.findFenceOpener();
    if (!this.headerToolName) {
      const md = this.findMarkdownHeader();
      if (md && (!opener || md.index < opener.index)) {
        logger.debug({ tool: md.name }, "[tools] markdown tool header found");
        if (md.index > 0) {
          result.textToEmit += this.pendingText.slice(0, md.index);
        }
        this.markdownHeaderText = this.pendingText.slice(md.index, md.end);
        this.pendingText = this.pendingText.slice(md.end);
        this.headerToolName = md.name;
        return;
      }
    }

    // Look for code fence start
    if (opener) {
      logger.debug(
        {
          reason: this.openedBecause(opener.index),
          at: this.showSnippet(opener.index),
        },
        "[tools] fence opened",
      );

      const before = stripTrailingFenceJunk(
        this.pendingText.slice(0, opener.index),
      );
      if (before) {
        result.textToEmit += before;
      }
      this.pendingText = this.pendingText.slice(
        opener.index + opener.matched.length,
      );
      this.state = "in_code_fence";
      this.buffer = "";
      this.fenceOpener = opener.matched.endsWith("\n")
        ? opener.matched
        : opener.matched + "\n";
      return;
    }

    // History echo before raw JSON: otherwise `{"command":…}` is treated as prose.
    const header = this.findHistoryHeader();
    const startIdx = this.findRawJsonStart();
    if (header && (startIdx === null || header.index <= startIdx)) {
      logger.debug(`History tool header found: ${header.name}`);
      if (header.index > 0) {
        result.textToEmit += this.pendingText.slice(0, header.index);
      }
      this.pendingText = this.pendingText.slice(header.end);
      this.headerToolName = header.name;
      return;
    }

    // Look for raw JSON start. Line-start matches any `{ "`; mid-line only `{"name":`.
    if (startIdx !== null) {
      logger.debug(`Raw JSON opener found: ${this.showSnippet(startIdx)}`);

      // Emit text before the JSON (without leftover `json` / incomplete fence tags)
      if (startIdx > 0) {
        result.textToEmit += stripTrailingFenceJunk(
          this.pendingText.slice(0, startIdx),
        );
      }
      this.pendingText = this.pendingText.slice(startIdx);
      this.state = "in_raw_json";
      this.jsonTracker.reset();
      return;
    }

    // No pattern found - emit all but keep last few chars for partial match detection
    // Long enough for `Tool Call: name` / ```json / `{"name":` across chunk boundaries
    const keepChars = 64;
    if (this.pendingText.length > keepChars) {
      result.textToEmit += this.pendingText.slice(0, -keepChars);
      this.pendingText = this.pendingText.slice(-keepChars);
    } else {
      // Not enough chars to be safe, emit nothing and wait for more
      // Actually, emit it all since we're likely at the end
      // result.textToEmit = "";
      // result.textToEmit += this.pendingText;
      // this.pendingText = '';
      // BUG: last 3 letters are dropped
    }
  }

  /**
   * Process code fence state - accumulate until the closing ```.
   *
   * Tool-call fences carry JSON whose string values may contain ```
   * (user:write of markdown etc). Inner fences are string content, not
   * closers: a JSON fence closes only on a fence outside a string.
   * Plain markdown fences keep the legacy first-fence-wins behavior.
   */
  private processCodeFenceState(result: ProcessResult): void {
    const content = this.buffer + this.pendingText;

    // Tool-call JSON payload: inner fences are string content, not closers.
    if (/^\s*\{/.test(content)) {
      const scan = newJsonScanState();
      let closeIndex = -1;
      for (let i = 0; i < content.length; i++) {
        const ch = content[i];
        if (scan.inString || ch === '"') {
          advanceJsonScan(scan, ch);
          continue;
        }
        if (ch === "`" && content.startsWith("```", i)) {
          closeIndex = i;
          break;
        }
      }
      if (closeIndex !== -1) {
        logger.debug("Code block ending found (fence outside JSON string)");
        this.buffer = content.slice(0, closeIndex);
        this.pendingText = content.slice(closeIndex + 3);
        this.completeCodeFence(result);
        return;
      }
      // No closer outside a string yet. Keep buffering; a partial fence at
      // the tail is re-scanned once more characters arrive.
      this.buffer = content;
      this.pendingText = "";
      return;
    }

    // First check pendingText for closing fence
    const endMatch = this.pendingText.match(/```/);
    if (endMatch && endMatch.index !== undefined) {
      const before = this.pendingText.slice(0, endMatch.index);
      const after = this.pendingText.slice(endMatch.index + 3);
      // ```json```json{...} — the second ``` is another opener, not a close.
      if (
        (this.buffer + before).trim() === "" &&
        /^(?:json)?\s*(?:\n|\{|`)/i.test(after)
      ) {
        this.pendingText = after.replace(/^json\s*/i, "");
        logger.debug("[tools] nested ```json opener, still in fence");
        return;
      }

      logger.debug(
        `Code block ending found: ${this.showSnippet(endMatch.index)}`,
      );
      this.buffer += before;
      this.pendingText = after;
      this.completeCodeFence(result);
      return;
    }

    // No closing fence in pendingText - buffer it and check if buffer now ends with ```
    this.buffer += this.pendingText;
    this.pendingText = "";

    if (this.buffer.endsWith("```")) {
      logger.debug("Code block ending found at end of buffer");
      this.buffer = this.buffer.slice(0, -3);
      this.completeCodeFence(result);
    }
  }

  /** Complete a code fence: parse buffer as tool call or emit as text. */
  private completeCodeFence(result: ProcessResult): void {
    this.state = "normal";

    this.buffer = stripFenceNoise(this.buffer);

    const calls = this.parseAllToolCalls(this.buffer);
    const fromMarkdown =
      calls.length === 0 ? this.takeMarkdownHeaderArgs(this.buffer) : null;
    const inferred =
      calls.length === 0 && !fromMarkdown && this.markdownHeaderText === null
        ? this.inferFromArguments(this.buffer)
        : null;
    if (calls.length > 0) {
      for (const call of calls) this.noteNamedCall(call, result);
    } else if (fromMarkdown) {
      this.noteNamedCall(fromMarkdown, result);
    } else if (inferred) {
      this.noteNamedCall(inferred, result);
    } else if (this.buffer === "") {
      logger.debug("[tools] dropped empty json fence");
    } else {
      this.dropHeader(result);
      logger.debug(
        {
          reason: "no tool call in fence body",
          snippet: this.buffer.replace(/\n/g, " ").substring(0, 120),
        },
        "[tools] fence re-emitted as text",
      );
      // Re-emit verbatim with the opener's language tag: the closer must
      // sit on its own line. An inline closer (text right before the
      // ticks) never terminates the block in the client renderer, which
      // then swallows the rest of the reply as fake code.
      const body = this.buffer.replace(/\n+$/, "");
      result.textToEmit += this.fenceOpener + body + "\n```";
    }
    this.buffer = "";
  }

  /**
   * Process raw JSON state - delegates to JsonBraceTracker for brace-depth
   * tracking with proper string/escape handling across chunk boundaries.
   */
  private processRawJsonState(result: ProcessResult): void {
    const { results: completedJsons, remainder } =
      this.jsonTracker.feedWithRemainder(this.pendingText);

    if (completedJsons.length > 0) {
      // At least one JSON object completed
      for (const json of completedJsons) {
        logger.debug("Raw JSON ending found");
        const trimmed = json.trim();
        const calls = this.parseAllToolCalls(trimmed);
        if (calls.length > 0) {
          for (const call of calls) this.noteNamedCall(call, result);
        } else {
          const fromMarkdown = this.takeMarkdownHeaderArgs(trimmed);
          const fromHeader = fromMarkdown ? null : this.takeHeaderArgs(trimmed);
          if (fromMarkdown) {
            this.noteNamedCall(fromMarkdown, result);
          } else if (fromHeader) {
            this.holdHistoryCall(fromHeader);
          } else {
            this.dropHeader(result);
            logger.info(
              { snippet: contentForLog(json, 180) },
              "[tools] not executed: JSON is not a tool call, leaked as text",
            );
            result.textToEmit += json;
          }
        }
      }

      // Remainder goes back to pendingText for normal-state processing
      this.pendingText = remainder;
      this.state = "normal";
    } else {
      const buf = this.jsonTracker.getBuffer();
      const nameHits = buf.match(/\{\s*"name"\s*:\s*"user:/g);
      if (nameHits && nameHits.length >= 2) {
        const calls = this.parseAllToolCalls(buf);
        if (calls.length > 0) {
          for (const call of calls) this.noteNamedCall(call, result);
          this.jsonTracker.reset();
          this.pendingText = "";
          this.state = "normal";
          return;
        }
      }
      this.pendingText = "";
    }
  }

  /**
   * Lumo sometimes copies the flatten marker instead of {"name","arguments"}.
   */
  private findHistoryHeader(): {
    index: number;
    end: number;
    name: string;
  } | null {
    const match = this.pendingText.match(StreamingToolDetector.HISTORY_HEADER);
    if (!match || match.index === undefined) return null;
    const rawName = (match[2] ?? match[3] ?? "").trim();
    if (!rawName) return null;
    const prefix = getCustomToolsConfig().prefix;
    const name = stripToolPrefix(rawName, prefix);
    if (!this.isKnownTool(name)) return null;
    const token = match[1];
    const tokenAt = match[0].lastIndexOf(token);
    if (tokenAt < 0) return null;
    return {
      index: match.index + tokenAt,
      end: match.index + match[0].length,
      name,
    };
  }

  /** `**user:shell**` right before a ``` or `{` block. */
  private findMarkdownHeader(): {
    index: number;
    end: number;
    name: string;
  } | null {
    const match = this.pendingText.match(StreamingToolDetector.MARKDOWN_HEADER);
    if (!match || match.index === undefined) return null;
    const token = match[1];
    const raw = match[2];
    const prefix = getCustomToolsConfig().prefix;
    const decorated = /^(?:\*\*|__|`)/.test(token);
    const tokenAt = match[0].indexOf(token);
    const ownLine = /^\n?$/.test(
      match[0].slice(0, tokenAt).replace(/[ \t]/g, ""),
    );
    // A bare word (e.g. "read") is prose unless it carries the tool prefix;
    // glued to a sentence, only a decorated header counts.
    if (!decorated && !(prefix && raw.startsWith(prefix) && ownLine)) {
      return null;
    }
    const name = stripToolPrefix(raw, prefix);
    if (!this.isKnownTool(name)) return null;
    return {
      index: match.index + tokenAt,
      end: match.index + match[0].length,
      name,
    };
  }

  /** Arguments-only JSON under a markdown header: a real call, not a history echo. */
  private takeMarkdownHeaderArgs(content: string): ParsedToolCall | null {
    if (this.markdownHeaderText === null) return null;
    const call = this.takeHeaderArgs(content);
    if (call) {
      this.markdownHeaderText = null;
      logger.info(
        `Tool call detected (markdown header): ${call.name} ${contentForLog(call.arguments, 80)}`,
      );
    }
    return call;
  }

  /** Forget a pending header; re-emit a markdown one since it was not a call. */
  private dropHeader(result: ProcessResult): void {
    if (this.markdownHeaderText !== null) {
      result.textToEmit += this.markdownHeaderText;
      this.markdownHeaderText = null;
    }
    this.headerToolName = null;
  }

  private noteNamedCall(toolCall: ParsedToolCall, result: ProcessResult): void {
    this.sawNamedCall = true;
    this.markdownHeaderText = null;
    this.headerToolName = null;
    this.pendingHistoryCall = null;
    result.completedToolCalls.push(toolCall);
  }

  private holdHistoryCall(toolCall: ParsedToolCall): void {
    if (this.sawNamedCall) {
      logger.debug(
        { tool: toolCall.name },
        "Dropping history-format echo; named call already seen",
      );
      return;
    }
    this.pendingHistoryCall = toolCall;
    logger.debug(
      { tool: toolCall.name },
      "Holding history-format echo until stream end",
    );
  }

  /**
   * Arguments-only JSON after a history header: {"command":"ls"} → bash.
   */
  private takeHeaderArgs(content: string): ParsedToolCall | null {
    if (!this.headerToolName) return null;
    try {
      const parsed = JSON.parse(content) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return null;
      }
      const name = this.headerToolName;
      this.headerToolName = null;
      return { name, arguments: parsed as Record<string, unknown> };
    } catch {
      return null;
    }
  }

  /**
   * Find the start index of a raw JSON object that might be a tool call.
   * Prefers the earliest of: own-line `{ "`, or mid-line `{"name":`.
   */
  private findRawJsonStart(): number | null {
    const lineMatch = this.pendingText.match(
      StreamingToolDetector.LINE_START_JSON,
    );
    const inlineMatch = this.pendingText.match(
      StreamingToolDetector.INLINE_TOOL_JSON,
    );

    let startIdx: number | undefined;
    if (lineMatch && lineMatch.index !== undefined) {
      startIdx = lineMatch.index + (lineMatch[0].length - lineMatch[1].length);
    }
    if (inlineMatch && inlineMatch.index !== undefined) {
      if (startIdx === undefined || inlineMatch.index < startIdx) {
        startIdx = inlineMatch.index;
      }
    }
    return startIdx ?? null;
  }

  /** Match client tools[] case-insensitively; return the registered name. */
  private matchKnownTool(toolName: string): string | null {
    if (!this.knownToolNames) return toolName;
    if (this.knownToolNames.has(toolName)) return toolName;
    const lower = toolName.toLowerCase();
    for (const known of this.knownToolNames) {
      if (known.toLowerCase() === lower) return known;
    }
    return null;
  }

  /** True when this name is allowed (or no allow-list was configured). */
  private isKnownTool(toolName: string): boolean {
    return this.matchKnownTool(toolName) !== null;
  }

  /** Record a rejected tool name; escalate to warn on repeats so the
   * retry loop is visible without changing log levels. */
  private noteRejectedToolName(toolName: string): void {
    const count = (this.rejectedNames.get(toolName) ?? 0) + 1;
    this.rejectedNames.set(toolName, count);
    const entry = { toolName, count };
    if (count >= StreamingToolDetector.REJECT_WARN_THRESHOLD) {
      logger.warn(
        entry,
        "[tools] repeated unknown tool name; not in client tools[]",
      );
    } else {
      logger.info(entry, "[tools] not executed: name not in client tools[]");
    }
  }

  /** Rejected names and counts, for end-of-stream summaries. */
  getRejectedToolNames(): Array<{ name: string; count: number }> {
    return [...this.rejectedNames.entries()].map(([name, count]) => ({
      name,
      count,
    }));
  }

  /**
   * Try to extract a tool name from content, even if JSON is malformed.
   * Uses regex to find "name": "..." pattern.
   * Returns null if no name found (indicating this isn't a tool call attempt).
   */
  private extractToolName(content: string): string | null {
    const match = content.match(/"name"\s*:\s*"([^"]+)"/);
    if (match) {
      const prefix = getCustomToolsConfig().prefix;
      return stripToolPrefix(match[1], prefix);
    }
    return null;
  }

  /**
   * Log and track an invalid tool call attempt.
   * Only called when we've determined this was actually a tool call attempt (has a name).
   */
  private trackInvalidToolCall(
    reason: string,
    content: string,
    toolName: string,
  ): void {
    logger.info(
      `Invalid tool call (${reason}): ${contentForLog(content, 300)}`,
    );
    getMetrics()?.toolCallsTotal.inc({
      type: "custom",
      status: "invalid",
      tool_name: toolName,
    });
  }

  /** Strict JSON, then jammed objects, then lenient strings (newlines / quotes). */
  private parseAllToolCalls(content: string): ParsedToolCall[] {
    const prefix = getCustomToolsConfig().prefix;
    const extracted = extractToolCalls(content);
    const calls: ParsedToolCall[] = [];
    for (const call of extracted) {
      const toolName = stripToolPrefix(call.name, prefix);
      const canonical = this.matchKnownTool(toolName);
      if (!canonical) {
        this.noteRejectedToolName(toolName);
        continue;
      }
      logger.info(
        `Tool call detected: ${canonical} ${contentForLog(call.arguments, 80)}`,
      );
      calls.push({ name: canonical, arguments: call.arguments });
    }
    // Fallback only when extraction found nothing; when it found calls whose
    // names were rejected, re-parsing the same content would double-count.
    if (calls.length === 0 && extracted.length === 0) {
      this.tryParseToolCall(content);
    } else if (extracted.length > 1) {
      logger.info(
        { count: calls.length },
        "[tools] recovered multiple tool calls from one blob",
      );
    }
    return calls;
  }

  private tryParseToolCall(
    content: string,
    logInvalid = true,
  ): ParsedToolCall | null {
    try {
      const parsed = JSON.parse(content);
      if (isToolCallJson(parsed)) {
        const normalized = parseToolCallJson(parsed);
        if (!normalized) return null;
        const prefix = getCustomToolsConfig().prefix;
        const toolName = stripToolPrefix(normalized.name, prefix);
        const canonical = this.matchKnownTool(toolName);
        if (!canonical) {
          this.noteRejectedToolName(toolName);
          return null;
        }
        logger.info(
          `Tool call detected: ${content.replace(/\n/g, " ").substring(0, 100)}...`,
        );
        return {
          name: canonical,
          arguments: normalized.arguments,
        };
      }
      // JSON parsed but schema invalid - only track if it has a name (looks like attempted tool call)
      if ("name" in parsed && typeof parsed.name === "string") {
        const prefix = getCustomToolsConfig().prefix;
        const toolName = stripToolPrefix(parsed.name, prefix);
        if (!this.isKnownTool(toolName)) {
          return null;
        }
        if (logInvalid)
          this.trackInvalidToolCall("missing arguments", content, toolName);
      }
      // Otherwise it's just regular JSON, don't track
    } catch {
      // JSON parse failed - only track if regex finds a name (looks like attempted tool call)
      const toolName = this.extractToolName(content);
      if (logInvalid && toolName && this.isKnownTool(toolName)) {
        this.trackInvalidToolCall("malformed JSON", content, toolName);
      }
      // Otherwise it's just broken/regular JSON, don't track
    }
    return null;
  }

  /**
   * Finalize - emit any remaining buffered content.
   */
  finalize(): ProcessResult {
    const result: ProcessResult = {
      textToEmit: "",
      completedToolCalls: [],
    };

    // A markdown header still waiting for its block is just text.
    if (this.state === "normal") this.dropHeader(result);

    // Emit any remaining pending text
    if (this.pendingText) {
      result.textToEmit += this.pendingText;
      this.pendingText = "";
    }

    // If we were in the middle of parsing, try to salvage before emitting as text
    if (this.state !== "normal") {
      const trackerBuffer =
        this.state === "in_raw_json"
          ? this.jsonTracker.getBuffer()
          : this.buffer;

      if (trackerBuffer) {
        // End-of-stream fallback: try JSON.parse on the complete buffer.
        // Catches edge cases where char-by-char tracking failed but JSON is actually complete.
        if (this.state === "in_raw_json") {
          const trimmed = trackerBuffer.trim();
          const calls = this.parseAllToolCalls(trimmed);
          if (calls.length > 0) {
            for (const call of calls) this.noteNamedCall(call, result);
            this.jsonTracker.reset();
            this.state = "normal";
            this.flushHistoryCall(result);
            return result;
          }
          const fromMarkdown = this.takeMarkdownHeaderArgs(trimmed);
          if (fromMarkdown) {
            this.noteNamedCall(fromMarkdown, result);
            this.jsonTracker.reset();
            this.state = "normal";
            this.flushHistoryCall(result);
            return result;
          }
          const fromHeader = this.takeHeaderArgs(trimmed);
          if (fromHeader) {
            this.holdHistoryCall(fromHeader);
            this.jsonTracker.reset();
            this.state = "normal";
            this.flushHistoryCall(result);
            return result;
          }
        }

        if (this.state === "in_code_fence") {
          const cleaned = stripFenceNoise(trackerBuffer);
          const calls = this.parseAllToolCalls(cleaned);
          const fromMarkdown =
            calls.length === 0 ? this.takeMarkdownHeaderArgs(cleaned) : null;
          if (fromMarkdown) calls.push(fromMarkdown);
          const inferred =
            calls.length === 0 && this.markdownHeaderText === null
              ? this.inferFromArguments(cleaned)
              : null;
          if (inferred) calls.push(inferred);
          if (calls.length > 0) {
            logger.debug("[tools] salvaged tool call from unclosed fence");
            for (const call of calls) this.noteNamedCall(call, result);
            this.buffer = "";
            this.jsonTracker.reset();
            this.state = "normal";
            this.flushHistoryCall(result);
            return result;
          }
          // Unclosed fence at stream end: emit WITH a closer so the
          // client never receives a lone ``` that swallows
          // everything after it as fake code.
          this.dropHeader(result);
          const body = trackerBuffer.replace(/\n+$/, "");
          logger.debug(
            {
              reason: "stream ended before fence closed",
              snippet: body.replace(/\n/g, " ").substring(0, 120),
            },
            "[tools] unclosed fence re-emitted with closer",
          );
          result.textToEmit += this.fenceOpener + body + "\n```";
        } else {
          result.textToEmit += trackerBuffer;
        }
      }

      this.buffer = "";
      this.jsonTracker.reset();
    }

    this.dropHeader(result);
    this.state = "normal";
    this.flushHistoryCall(result);
    return result;
  }

  private flushHistoryCall(result: ProcessResult): void {
    if (!this.pendingHistoryCall || this.sawNamedCall) {
      this.pendingHistoryCall = null;
      return;
    }
    logger.info(
      `Tool call detected (history header): ${this.pendingHistoryCall.name} ${contentForLog(this.pendingHistoryCall.arguments, 80)}`,
    );
    result.completedToolCalls.push(this.pendingHistoryCall);
    this.pendingHistoryCall = null;
  }
}
