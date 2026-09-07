# OpenCode configuration

## Lead + worker split

| Role | OpenCode model | Tamer behaviour |
|---|---|---|
| **Primary / Lead** | `lumo-tamer/lumo-lead` | Built-in id → **lumo-max + thinking**. Applies `server.agentProfiles.lead`. **Strips client `tools[]`** — never injects `forTools` / custom-tools MITM. Chat orchestrator only. |
| **Worker subagent** | `lumo-tamer/lumo-max` | Coding path. `agent: worker`. **Gets `forTools`** when the client sends tools (keep `server.customTools.enabled: true`). |

`lumo-lead` is a **built-in** model id (like `lumo` / `lumo-lite` / `lumo-max`), listed in `server.allowedModels`. It is **not** an `extraModels` alias. Under the hood it resolves to `{ tier: lumo-max, reasoning: high, agent: lead }`.

When Lead dispatches a worker, that request must use `lumo-max` (or another model with `agent: worker` / default worker). Those requests keep the coding custom-tools path.

### Tool allowlist (Lead)

Lead does **not** strip every `tools[]` entry. Tamer keeps orchestration tools (`task` / `Task` / similar) and strips coding tools (`read` / `write` / `edit` / `bash` / `glob` / `grep` / …). Lead gets a slim `agentProfiles.lead.forOrchestrationTools` protocol — **not** the coding `forTools` MITM dump.

### Announce-without-tool coach (worker)

If a **worker** (`lumo-max`) announces an action (“Let me read…”, “reading all files…”) but emits no tool-call JSON, Tamer bounces once with `server.instructions.forAnnounceBounce` (same turn, `isBounce` prevents loops). Lead’s fallback prompt tells Lead to coach the **same** worker first and only spawn a new subagent after that repeats.

Lumo's window is **128.0K tokens** (the in-app meter). Integer form: `limit.context` **131072**, `limit.output` **13107** (12.8K reserved to keep chatting). The proxy does not expose that meter; without these limits OpenCode auto-compaction never runs. Details: [README: Context window](../README.md#context-window).

## Provider block

Add Lumo to `provider` in your OpenCode `opencode.json` / `opencode.jsonc`. Set the primary model to **Lead**; use **lumo-max** for the worker subagent:

```json
{
  "model": "lumo-tamer/lumo-lead",
  "small_model": "lumo-tamer/lumo-lite",
  "provider": {
    "lumo-tamer": {
      "models": {
        "lumo": {
          "name": "Lumo",
          "limit": { "context": 131072, "output": 13107 }
        },
        "lumo-lite": {
          "name": "lumo-lite",
          "limit": { "context": 131072, "output": 13107 }
        },
        "lumo-max": {
          "name": "lumo-max",
          "limit": { "context": 131072, "output": 13107 }
        },
        "lumo-lead": {
          "name": "Lumo Lead",
          "limit": { "context": 131072, "output": 13107 }
        }
      },
      "name": "Lumo (local)",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:3003/v1",
        "apiKey": "your-super-secret-key"
      }
    }
  }
}
```

Point the primary/default agent at `lumo-tamer/lumo-lead` and any coding worker / Task subagent at `lumo-tamer/lumo-max`. Lead plans and delegates; the worker implements with real tool calls.
