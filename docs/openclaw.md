# OpenClaw configuration

Use `lumo-max` when you want thinking on by default. Client `tools[]` are honored unless you set `customTools.enabled: false`.

Window is **128.0K** (`contextWindow` 131072) with **12.8K** reserved (`maxTokens` 13107). The Lumo app meter is not on the OpenAI facade. See [README: Context window](../README.md#context-window).

Add Lumo to `models.providers` in your OpenClaw config:

```json
{
    "models": {
        "providers": {
            "lumo": {
                "baseUrl": "http://127.0.0.1:3003/v1",
                "apiKey": "...",
                "api": "openai-completions",
                "models": [
                    {
                        "id": "lumo-max",
                        "name": "lumo-max",
                        "reasoning": true,
                        "input": ["text"],
                        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
                        "contextWindow": 131072,
                        "maxTokens": 13107
                    },
                    {
                        "id": "lumo",
                        "name": "Lumo",
                        "reasoning": false,
                        "input": [
                            "text"
                        ],
                        "cost": {
                            "input": 0,
                            "output": 0,
                            "cacheRead": 0,
                            "cacheWrite": 0
                        },
                        "contextWindow": 131072,
                        "maxTokens": 13107
                    }
                ]
            }
        }
    }
}
```

More information: https://open-claw.bot/docs/concepts/model-providers/#local-proxies-lm-studio--vllm
