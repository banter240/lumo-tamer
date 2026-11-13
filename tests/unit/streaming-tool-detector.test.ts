/**
 * Unit tests for StreamingToolDetector
 *
 * Tests the state machine that detects JSON tool calls in streaming text,
 * supporting both code fence (```json) and raw JSON formats.
 */

import { describe, it, expect } from "vitest";
import { StreamingToolDetector } from "../../src/api/tools/streaming-tool-detector.js";

/** Feed chunks through detector and return accumulated text + tool calls */
function processAll(detector: StreamingToolDetector, chunks: string[]) {
  let allText = "";
  const allToolCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }> = [];

  for (const chunk of chunks) {
    const result = detector.processChunk(chunk);
    allText += result.textToEmit;
    allToolCalls.push(...result.completedToolCalls);
  }

  const final = detector.finalize();
  allText += final.textToEmit;
  allToolCalls.push(...final.completedToolCalls);

  return { allText, allToolCalls };
}

describe("StreamingToolDetector", () => {
  describe("code fence detection", () => {
    it("detects tool call in code fence format", () => {
      const detector = new StreamingToolDetector();
      const { allText, allToolCalls } = processAll(detector, [
        "Here is the result: ",
        '```json\n{"name":"get_weather",',
        '"arguments":{"city":"Paris"}}',
        "```",
        " Done!",
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe("get_weather");
      expect(allToolCalls[0].arguments).toEqual({ city: "Paris" });
      expect(allText).toContain("Here is the result:");
      expect(allText).toContain("Done!");
      expect(allText).not.toContain("get_weather");
    });

    it("does not leak json language tags before a fence", () => {
      const detector = new StreamingToolDetector({ knownToolNames: ["edit"] });
      const { allText, allToolCalls } = processAll(detector, [
        'Checking files.\njson\njson\njson\n```json\n{"name":"user:edit","arguments":{"filePath":"/tmp/README.md","oldString":"a","newString":"b"}}\n```',
      ]);
      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe("edit");
      expect(allText).toContain("Checking files.");
      expect(allText.replace(/[`\s]/g, "").toLowerCase()).not.toContain("json");
    });

    it("does not leak json/```json when Lumo doubles the fence opener", () => {
      const detector = new StreamingToolDetector({ knownToolNames: ["read"] });
      const { allText, allToolCalls } = processAll(detector, [
        '```json\n```json\n{"name":"user:read","arguments":{"filePath":"/tmp/a"}}\n```',
      ]);
      expect(allToolCalls).toEqual([
        { name: "read", arguments: { filePath: "/tmp/a" } },
      ]);
      expect(allText.replace(/[`\s]/g, "")).not.toContain("json");
    });

    it("detects tool call in code fence without json tag", () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        '```\n{"name":"notag","arguments":{}}\n```',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe("notag");
    });

    it("detects OpenAI-style function_call in code fence and parses string arguments", () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        '```json\n{"type":"function_call","name":"exec","arguments":"{\\"command\\":\\"echo hi\\"}"}\n```',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0]).toEqual({
        name: "exec",
        arguments: { command: "echo hi" },
      });
    });

    it("detects tool call with parameters alias", () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        '```json\n{"name":"search","parameters":{"q":"weather"}}\n```',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0]).toEqual({
        name: "search",
        arguments: { q: "weather" },
      });
    });

    it("detects multiple tool calls", () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        `First tool:\n\`\`\`json\n{"name":"tool1","arguments":{"a":1}}\n\`\`\`\nSecond tool:\n\`\`\`json\n{"name":"tool2","arguments":{"b":2}}\n\`\`\`\nDone`,
      ]);

      expect(allToolCalls).toHaveLength(2);
      expect(allToolCalls[0].name).toBe("tool1");
      expect(allToolCalls[1].name).toBe("tool2");
    });

    it("emits incomplete JSON at stream end as text", () => {
      const detector = new StreamingToolDetector();
      const { allText, allToolCalls } = processAll(detector, [
        '```json\n{"not":"a-tool-call","foo":',
      ]);

      expect(allToolCalls).toHaveLength(0);
      expect(allText).toContain("not");
    });

    it("salvages a complete tool object when the closing fence is missing", () => {
      const detector = new StreamingToolDetector({ knownToolNames: ["Task"] });
      const { allToolCalls, allText } = processAll(detector, [
        '```\njson\n{"name":"user:Task","arguments":{"description":"smoke","prompt":"write the file","subagent_type":"general"}}',
      ]);
      expect(allToolCalls).toEqual([
        {
          name: "Task",
          arguments: {
            description: "smoke",
            prompt: "write the file",
            subagent_type: "general",
          },
        },
      ]);
      expect(allText).not.toContain("user:Task");
    });
  });

  describe("raw JSON detection", () => {
    it("maps user:task onto a client tool named Task, even without a markdown fence", () => {
      const blob =
        'json\n{"name": "user:task", "arguments": {"description": "scan repo", "subagent_type": "general", "prompt": "Read the repo and summarize."}}';
      const detector = new StreamingToolDetector({ knownToolNames: ["Task"] });
      const { allText, allToolCalls } = processAll(detector, [blob]);
      expect(allToolCalls).toEqual([
        {
          name: "Task",
          arguments: {
            description: "scan repo",
            subagent_type: "general",
            prompt: "Read the repo and summarize.",
          },
        },
      ]);
      expect(allText.replace(/[`\s]/g, "").toLowerCase()).not.toContain(
        "user:task",
      );
    });

    it("detects tool call in raw JSON format", () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        "I will call the function:\n",
        '{"name":"search",',
        '"arguments":{"query":"test"}}',
        "\nDone",
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe("search");
      expect(allToolCalls[0].arguments).toEqual({ query: "test" });
    });

    it("handles nested braces in arguments", () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        '\n{"name":"complex","arguments":{"nested":{"deep":{"value":42}}}}',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe("complex");
      expect(allToolCalls[0].arguments).toEqual({
        nested: { deep: { value: 42 } },
      });
    });

    it("handles escaped quotes in arguments", () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        '\n{"name":"quote_test","arguments":{"text":"say \\"hello\\" world"}}',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].arguments).toEqual({ text: 'say "hello" world' });
    });

    it("detects nested OpenAI function shape", () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        '\n{"type":"function","function":{"name":"GetWeather","arguments":"{\\"city\\":\\"Boston\\"}"}}',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0]).toEqual({
        name: "GetWeather",
        arguments: { city: "Boston" },
      });
    });

    it("detects raw JSON with character-by-character streaming", () => {
      const detector = new StreamingToolDetector();
      const json =
        '{\n  "name": "HassTurnOff",\n  "arguments": {\n    "name": "office"\n  }\n}';
      const { allToolCalls } = processAll(detector, [...json]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe("HassTurnOff");
      expect(allToolCalls[0].arguments).toEqual({ name: "office" });
    });

    it("detects raw JSON with chunks splitting strings", () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        '{\n  "na',
        'me": "Has',
        'sTurnOff",\n  "argu',
        'ments": {\n    "na',
        'me": "off',
        'ice"\n  }\n}',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe("HassTurnOff");
      expect(allToolCalls[0].arguments).toEqual({ name: "office" });
    });

    it("handles strings containing brace characters", () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        '{\n  "name": "test",\n  "argu',
        'ments": {\n    "text": "hello {wor',
        'ld} bye"\n  }\n}',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe("test");
      expect(allToolCalls[0].arguments).toEqual({ text: "hello {world} bye" });
    });

    it("detects tool call JSON after prose on the same line", () => {
      const detector = new StreamingToolDetector();
      const { allText, allToolCalls } = processAll(detector, [
        'Here is the file content: {"name":"read","arguments":{"path":"README.md"}}',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0]).toEqual({
        name: "read",
        arguments: { path: "README.md" },
      });
      expect(allText).toContain("Here is the file content:");
      expect(allText).not.toContain('"name":"read"');
    });

    it("detects inline tool JSON split across chunks before the brace", () => {
      const detector = new StreamingToolDetector();
      const { allToolCalls } = processAll(detector, [
        "Calling now: {",
        '"name":"read","arguments":{"path":"a.txt"}}',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe("read");
    });
  });

  describe("non-tool content", () => {
    it("passes non-tool JSON through as text", () => {
      const detector = new StreamingToolDetector();
      const { allText, allToolCalls } = processAll(detector, [
        "Here is some config:\n",
        '{"foo":"bar","baz":123}',
        "\nEnd",
      ]);

      expect(allToolCalls).toHaveLength(0);
      expect(allText).toContain("foo");
      expect(allText).toContain("bar");
    });

    it("leaves mid-line JSON that is not a tool call as text", () => {
      const detector = new StreamingToolDetector();
      const { allText, allToolCalls } = processAll(detector, [
        'Config: {"foo":"bar","baz":123} done',
      ]);

      expect(allToolCalls).toHaveLength(0);
      expect(allText).toContain('{"foo":"bar","baz":123}');
    });
  });

  describe("known tool names", () => {
    it("accepts an inline call only when the name is registered", () => {
      const detector = new StreamingToolDetector({ knownToolNames: ["read"] });
      const { allText, allToolCalls } = processAll(detector, [
        'Here is the file content: {"name":"read","arguments":{"path":"README.md"}}',
      ]);

      expect(allToolCalls).toHaveLength(1);
      expect(allToolCalls[0].name).toBe("read");
      expect(allText).not.toContain('"name":"read"');
    });

    it("emits example JSON as text when the name is not registered", () => {
      const detector = new StreamingToolDetector({ knownToolNames: ["read"] });
      const json = '{"name":"example_tool","arguments":{"param":"value"}}';
      const { allText, allToolCalls } = processAll(detector, [
        `For example ${json} in the docs`,
      ]);

      expect(allToolCalls).toHaveLength(0);
      expect(allText).toContain(json);
    });

    it("counts repeated unknown names for the rejection summary", () => {
      const detector = new StreamingToolDetector({ knownToolNames: ["read"] });
      const fenced = '```json\n{"name":"ghost_tool","arguments":{}}\n```';
      processAll(detector, [fenced, " again ", fenced, " ", fenced]);

      expect(detector.getRejectedToolNames()).toEqual([
        { name: "ghost_tool", count: 3 },
      ]);
    });
  });

  describe("arguments-only fences inferred from client tool parameters", () => {
    // Shapes of OpenCode's tools (parameters trimmed to the relevant ones).
    const toolSignatures = [
      {
        name: "read",
        required: ["filePath"],
        properties: ["filePath", "offset", "limit"],
      },
      {
        name: "edit",
        required: ["filePath", "oldString", "newString"],
        properties: ["filePath", "oldString", "newString", "replaceAll"],
      },
      {
        name: "write",
        required: ["filePath", "content"],
        properties: ["filePath", "content"],
      },
      {
        name: "shell",
        required: ["command"],
        properties: ["command", "timeout", "workdir", "description"],
      },
      { name: "execute", required: ["code"], properties: ["code"] },
    ];
    const opts = {
      knownToolNames: toolSignatures.map((s) => s.name),
      toolSignatures,
    };

    it("runs the unnamed edit + shell fences seen live (turn ended as text)", () => {
      const detector = new StreamingToolDetector(opts);
      const { allText, allToolCalls } = processAll(detector, [
        'Je corrige la requête puis je redémarre la ressource :\n\n```json\n{\n  "filePath": "C:\\\\res\\\\server.lua",\n  "oldString": "a",\n',
        '  "newString": "b"\n}\n```\n\n```json\n{\n  "command": "rcon.ps1 \'restart ano_ledger\'",\n  "timeout": 30000,\n  "workdir": "C:\\\\FXServer-test"\n}\n```\n',
      ]);
      expect(allToolCalls).toEqual([
        {
          name: "edit",
          arguments: {
            filePath: "C:\\res\\server.lua",
            oldString: "a",
            newString: "b",
          },
        },
        {
          name: "shell",
          arguments: {
            command: "rcon.ps1 'restart ano_ledger'",
            timeout: 30000,
            workdir: "C:\\FXServer-test",
          },
        },
      ]);
      expect(allText).toContain("Je corrige");
      expect(allText).not.toContain("oldString");
    });

    it("prefers the tool requiring the most matched parameters", () => {
      const detector = new StreamingToolDetector(opts);
      const { allToolCalls } = processAll(detector, [
        '```json\n{"filePath": "a.lua", "content": "x"}\n```',
      ]);
      expect(allToolCalls).toEqual([
        { name: "write", arguments: { filePath: "a.lua", content: "x" } },
      ]);
    });

    it("leaves data that fits no tool, or several equally, as text", () => {
      for (const body of [
        '{"a": 1}',
        '{"filePath": "a", "unknownKey": 1}',
        "{}",
      ]) {
        const detector = new StreamingToolDetector(opts);
        const { allText, allToolCalls } = processAll(detector, [
          "Exemple :\n```json\n" + body + "\n```",
        ]);
        expect(allToolCalls, body).toHaveLength(0);
        expect(allText, body).toContain(body);
      }
      const twins = [
        { name: "a", required: ["x"], properties: ["x"] },
        { name: "b", required: ["x"], properties: ["x"] },
      ];
      const detector = new StreamingToolDetector({
        knownToolNames: ["a", "b"],
        toolSignatures: twins,
      });
      expect(
        processAll(detector, ['```json\n{"x": 1}\n```']).allToolCalls,
      ).toHaveLength(0);
    });

    it("does nothing without signatures (other clients)", () => {
      const detector = new StreamingToolDetector({ knownToolNames: ["shell"] });
      expect(
        processAll(detector, ['```json\n{"command": "ls"}\n```']).allToolCalls,
      ).toHaveLength(0);
    });
  });

  describe("markdown header + arguments block", () => {
    const tools = { knownToolNames: ["shell", "glob", "read", "write"] };

    it("runs **user:shell** followed by a plain fence (seen live: turn ended as text)", () => {
      const detector = new StreamingToolDetector(tools);
      const { allText, allToolCalls } = processAll(detector, [
        'Je regarde d\'abord ce que contient chaque pack :\n\n\n**user:shell**\n```\n{"command": "Get-ChildItem -LiteralPath \'C:\\\\Users\\\\a\'"}\n```',
      ]);
      expect(allToolCalls).toEqual([
        {
          name: "shell",
          arguments: { command: "Get-ChildItem -LiteralPath 'C:\\Users\\a'" },
        },
      ]);
      expect(allText).toContain("Je regarde");
      expect(allText).not.toContain("user:shell");
      expect(allText).not.toContain("Get-ChildItem");
    });

    it("runs several headed calls in one reply, across chunk boundaries", () => {
      const detector = new StreamingToolDetector(tools);
      const { allText, allToolCalls } = processAll(detector, [
        'Je continue :**user:glob**\n```\n{"path": "C:\\\\res", "pattern": "**/fx',
        'manifest.lua"}\n```\n**user:',
        'shell**\n```json\n{"command": "dir"}\n```',
      ]);
      expect(allToolCalls).toEqual([
        {
          name: "glob",
          arguments: { path: "C:\\res", pattern: "**/fxmanifest.lua" },
        },
        { name: "shell", arguments: { command: "dir" } },
      ]);
      expect(allText.trim()).toBe("Je continue :");
    });

    it("accepts backtick and plain prefixed headers, and a raw object", () => {
      for (const header of ["`user:read`", "user:read", "**read**"]) {
        const detector = new StreamingToolDetector(tools);
        const { allToolCalls } = processAll(detector, [
          `Lecture :\n${header}\n{"filePath": "/tmp/a.lua", "limit": 60}`,
        ]);
        expect(allToolCalls, header).toEqual([
          { name: "read", arguments: { filePath: "/tmp/a.lua", limit: 60 } },
        ]);
      }
    });

    it("leaves prose headers and unknown tools alone", () => {
      for (const reply of [
        'Résumé\n```\n{"a": 1}\n```',
        '**Exemple**\n```json\n{"command": "ls"}\n```',
        '**user:nope**\n```\n{"command": "ls"}\n```',
      ]) {
        const detector = new StreamingToolDetector(tools);
        const { allText, allToolCalls } = processAll(detector, [reply]);
        expect(allToolCalls, reply).toHaveLength(0);
        expect(allText, reply).toContain("```");
      }
    });

    it("keeps the header text when the block under it is not arguments", () => {
      const detector = new StreamingToolDetector(tools);
      const { allText, allToolCalls } = processAll(detector, [
        "**user:shell**\n```\nGet-ChildItem\n```",
      ]);
      expect(allToolCalls).toHaveLength(0);
      expect(allText).toContain("**user:shell**");
      expect(allText).toContain("Get-ChildItem");
    });
  });

  describe("history header echo", () => {
    it("executes Tool Call: name plus args JSON when that is the only call", () => {
      const detector = new StreamingToolDetector({ knownToolNames: ["bash"] });
      const { allText, allToolCalls } = processAll(detector, [
        'fixen:Tool Call: bash\n{"command":"git diff scripts/validate_translations.py"}',
      ]);

      expect(allToolCalls).toEqual([
        {
          name: "bash",
          arguments: { command: "git diff scripts/validate_translations.py" },
        },
      ]);
      expect(allText).toContain("fixen:");
      expect(allText).not.toContain("git diff");
    });

    it("executes [Tool Call: name] plus args JSON when that is the only call", () => {
      const detector = new StreamingToolDetector({ knownToolNames: ["read"] });
      const { allToolCalls, allText } = processAll(detector, [
        '[Tool Call: read]\n{"filePath":"/tmp/a.py","limit":20,"offset":154}',
      ]);

      expect(allToolCalls).toEqual([
        {
          name: "read",
          arguments: { filePath: "/tmp/a.py", limit: 20, offset: 154 },
        },
      ]);
      expect(allText).not.toContain("Tool Call");
    });

    it("drops the history echo when a named JSON call follows", () => {
      const detector = new StreamingToolDetector({
        knownToolNames: ["bash", "grep"],
      });
      const { allToolCalls, allText } = processAll(detector, [
        'Tool Call: bash\n{"command":"rg apply_zone_state"}\n',
        '{"name":"user:grep","arguments":{"pattern":"apply_zone_state"}}',
      ]);

      expect(allToolCalls).toEqual([
        { name: "grep", arguments: { pattern: "apply_zone_state" } },
      ]);
      expect(allText).not.toContain("rg apply_zone_state");
    });

    it("strips the user: prefix from a history header", () => {
      const detector = new StreamingToolDetector({ knownToolNames: ["bash"] });
      const { allToolCalls } = processAll(detector, [
        'Tool Call: user:bash\n{"command":"ls"}',
      ]);

      expect(allToolCalls).toEqual([
        { name: "bash", arguments: { command: "ls" } },
      ]);
    });

    it("executes Done name plus args JSON (flatten copy without brackets)", () => {
      const detector = new StreamingToolDetector({ knownToolNames: ["read"] });
      const { allToolCalls, allText } = processAll(detector, [
        'achte genau auf dein call....\nDone read\n{"filePath":"/tmp/coordinator.py","offset":770,"limit":50}',
      ]);

      expect(allToolCalls).toEqual([
        {
          name: "read",
          arguments: {
            filePath: "/tmp/coordinator.py",
            offset: 770,
            limit: 50,
          },
        },
      ]);
      expect(allText).toContain("achte genau auf dein call....");
      expect(allText).not.toContain("coordinator.py");
    });

    it("leaves an unknown history header as text", () => {
      const detector = new StreamingToolDetector({ knownToolNames: ["bash"] });
      const { allText, allToolCalls } = processAll(detector, [
        'Tool Call: nope\n{"command":"ls"}',
      ]);

      expect(allToolCalls).toHaveLength(0);
      expect(allText).toContain("Tool Call: nope");
      expect(allText).toContain('"command":"ls"');
    });
  });
});

describe("nested fences in tool-call payloads", () => {
  it("re-emits a non-tool fence with its closer on its own line", () => {
    // Live failure seen in the wild: the model closed a plain code block inline
    // ('...dev.3)```'), the re-emitted closer glued to the body and the client
    // rendered everything after as fake code, leaving a lone ``` on screen.
    const { allText, allToolCalls } = processAll(new StreamingToolDetector(), [
      "Branch-Lage\n\n```\nai/dev: c54b0ba phase 2\n        4e3c5da = origin/dev (5.13.1-dev.3)```\n\nDone.",
    ]);
    expect(allToolCalls).toEqual([]);
    expect(allText).toContain(
      "```\nai/dev: c54b0ba phase 2\n        4e3c5da = origin/dev (5.13.1-dev.3)\n```",
    );
    expect(allText).toContain("\n\nDone.");
  });

  it("appends a closer when a plain fence never closes before the stream ends", () => {
    const { allText, allToolCalls } = processAll(new StreamingToolDetector(), [
      "Some intro\n\n```\nunterminated code block, stream ends here",
    ]);
    expect(allToolCalls).toEqual([]);
    expect(allText).toContain("unterminated code block, stream ends here\n```");
  });

  it("treats ``` inside JSON string arguments as content", () => {
    const detector = new StreamingToolDetector({ knownToolNames: ["write"] });
    const md = "Intro\n\n```js\nconsole.log(1);\n```\n\nOutro";
    const call = {
      name: "user:write",
      arguments: { path: "/tmp/nested.md", content: md },
    };
    const payload = JSON.stringify(call);
    const { allToolCalls, allText } = processAll(detector, [
      "```json\n" + payload.slice(0, 37),
      payload.slice(37, 74),
      payload.slice(74) + "\n```",
    ]);
    expect(allToolCalls).toEqual([
      { name: "write", arguments: call.arguments },
    ]);
    expect(allText).toBe("");
  });

  it("handles an even number of inner fences too", () => {
    const detector = new StreamingToolDetector({ knownToolNames: ["write"] });
    const md = "```a\n```\n```b\n```\nmid\n```c\n```";
    const call = { name: "user:write", arguments: { content: md } };
    const { allToolCalls } = processAll(detector, [
      "```json\n" + JSON.stringify(call) + "\n```",
    ]);
    expect(allToolCalls).toEqual([
      { name: "write", arguments: call.arguments },
    ]);
  });

  it("still closes plain markdown fences at the first closer", () => {
    const detector = new StreamingToolDetector();
    const { allToolCalls, allText } = processAll(detector, [
      "```\nplain text, no JSON\n```\nafter",
    ]);
    expect(allToolCalls).toEqual([]);
    expect(allText).toContain("plain text");
  });

  it("closes a JSON fence when the closer is split across chunks", () => {
    const detector = new StreamingToolDetector({ knownToolNames: ["edit"] });
    const payload = JSON.stringify({
      name: "user:edit",
      arguments: { path: "/tmp/a" },
    });
    const { allToolCalls } = processAll(detector, [
      "```json\n" + payload + "\n",
      "``",
      "`",
    ]);
    expect(allToolCalls).toEqual([
      { name: "edit", arguments: { path: "/tmp/a" } },
    ]);
  });

  it("handles an escaped backslash right before a fence inside a JSON string", () => {
    const detector = new StreamingToolDetector({ knownToolNames: ["write"] });
    const md = "quote\\ then " + "```" + " still in string";
    const call = { name: "user:write", arguments: { content: md } };
    const { allToolCalls } = processAll(detector, [
      "```json\n" + JSON.stringify(call) + "\n```",
    ]);
    expect(allToolCalls).toEqual([
      { name: "write", arguments: call.arguments },
    ]);
  });

  it("tolerates long runs of backticks (4+, 5+) inside JSON strings", () => {
    const detector = new StreamingToolDetector({ knownToolNames: ["write"] });
    const md = "x" + "````" + "y" + "```" + "z" + "`````" + "w";
    const call = { name: "user:write", arguments: { content: md } };
    const { allToolCalls } = processAll(detector, [
      "```json\n" + JSON.stringify(call) + "\n```",
    ]);
    expect(allToolCalls).toEqual([
      { name: "write", arguments: call.arguments },
    ]);
  });

  it("salvages an unclosed JSON fence at end of stream (finalize path)", () => {
    const detector = new StreamingToolDetector({ knownToolNames: ["edit"] });
    const payload = JSON.stringify({
      name: "user:edit",
      arguments: { path: "/u" },
    });
    const { allToolCalls } = processAll(detector, [
      "```json\n" + payload + "\n",
    ]);
    expect(allToolCalls).toEqual([{ name: "edit", arguments: { path: "/u" } }]);
  });
});

describe("fence opener gating", () => {
  // Live failure: a bare inline ``` in prose flipped the detector into
  // fence state, buffered the following prose as a fake code body, and
  // swallowed the next real tool call into that buffer instead of
  // executing it.
  it("ignores a bare inline triple backtick in prose and still executes the next tool fence", () => {
    const detector = new StreamingToolDetector({ knownToolNames: ["read"] });
    const { allText, allToolCalls } = processAll(detector, [
      "Fix: re-emit verbatim instead of wrapping ``` again. Then: ",
      '```json\n{"name":"user:read","arguments":{"path":"src/a.ts"}}\n```',
      " Done.",
    ]);
    expect(allText).toContain("wrapping ``` again");
    expect(allText).toContain("Done.");
    expect(allToolCalls).toEqual([
      { name: "read", arguments: { path: "src/a.ts" } },
    ]);
  });

  it("opens a mid-line json fence only directly before its payload", () => {
    const detector = new StreamingToolDetector();
    const { allToolCalls, allText } = processAll(detector, [
      "Result: ",
      '```json\n{"name":"user:read","arguments":{"path":"src/b.ts"}}\n```',
      "Siehe ```json in der Doku, nicht ausführen.",
    ]);
    expect(allToolCalls).toEqual([
      { name: "read", arguments: { path: "src/b.ts" } },
    ]);
    expect(allText).toContain("Siehe ```json in der Doku");
  });

  it("defers a mid-line json tag cut at a chunk boundary until its payload arrives", () => {
    const detector = new StreamingToolDetector({ knownToolNames: ["read"] });
    const { allText, allToolCalls } = processAll(detector, [
      "Result: ```json",
      '\n{"name":"user:read","arguments":{"path":"src/c.ts"}}\n```',
      " Done.",
    ]);
    expect(allToolCalls).toEqual([
      { name: "read", arguments: { path: "src/c.ts" } },
    ]);
    expect(allText).toContain("Result:");
    expect(allText).toContain("Done.");
    expect(allText).not.toContain("user:read");
  });

  it("re-emits a non-tool fence verbatim with its json language tag", () => {
    const detector = new StreamingToolDetector();
    const { allText } = processAll(detector, [
      'Config\n```json\n{"plain":"stuff"}\n```\nmore',
    ]);
    expect(allText).toContain('```json\n{"plain":"stuff"}\n```');
    expect(allText).toContain("more");
  });
});
