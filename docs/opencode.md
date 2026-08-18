# OpenCode configuration

Use **`lumo-max`** for coding (GLM). Thinking is on by default for that model. Keep `server.customTools.enabled: true` (the default) so OpenCode tools are forwarded.

Lumo's window is **128.0K tokens** (the in-app meter). Integer form: `limit.context` **131072**, `limit.output` **13107** (12.8K reserved to keep chatting). The proxy does not expose that meter; without these limits OpenCode auto-compaction never runs. Details: [README: Context window](../README.md#context-window).

Add Lumo to `provider` in your OpenCode `opencode.json` / `opencode.jsonc`:

```json
{
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
