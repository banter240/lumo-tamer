#!/usr/bin/env bash
# OpenCode against the local lumo-tamer (127.0.0.1:3003), not Proxmox.
# Usage: ./scripts/dev-opencode.sh [-c]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export LUMO_HOME="$ROOT/.local"
mkdir -p "$LUMO_HOME"

if [ ! -f "$LUMO_HOME/config.yaml" ]; then
  cp "$ROOT/config.local.example.yaml" "$LUMO_HOME/config.yaml"
  echo "wrote $LUMO_HOME/config.yaml from example"
fi

if [ ! -f "$LUMO_HOME/vault-key" ]; then
  umask 077
  openssl rand 32 >"$LUMO_HOME/vault-key"
  chmod 600 "$LUMO_HOME/vault-key"
fi

cat >"$LUMO_HOME/opencode.json" <<'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "model": "lumo-tamer/lumo-max",
  "small_model": "lumo-tamer/lumo-lite",
  "provider": {
    "lumo-tamer": {
      "name": "Lumo (local tamer)",
      "npm": "@ai-sdk/openai",
      "options": {
        "baseURL": "http://127.0.0.1:3003/v1",
        "apiKey": "local-dev-key"
      },
      "models": {
        "lumo-max": {
          "name": "Lumo Max (local)",
          "limit": { "context": 131072, "output": 13107 },
          "options": { "reasoning_effort": "high" }
        },
        "lumo": {
          "name": "Lumo (local)",
          "limit": { "context": 131072, "output": 13107 }
        },
        "lumo-lite": {
          "name": "Lumo Lite (local)",
          "limit": { "context": 131072, "output": 13107 },
          "options": { "reasoning_effort": "none" }
        }
      }
    }
  },
  "compaction": {
    "auto": true,
    "prune": true
  }
}
EOF
export OPENCODE_CONFIG="$LUMO_HOME/opencode.json"

if ! curl -sf --max-time 1 http://127.0.0.1:3003/health >/dev/null; then
  echo "Starting lumo-tamer on :3003 (LUMO_HOME=.local)…"
  (
    cd "$ROOT"
    exec npm run dev:server
  ) >>"$LUMO_HOME/server.stdout.log" 2>&1 &
  echo $! >"$LUMO_HOME/server.pid"
  ok=0
  for _ in $(seq 1 40); do
    if curl -sf --max-time 1 http://127.0.0.1:3003/health >/dev/null; then
      ok=1
      break
    fi
    sleep 0.25
  done
  if [ "$ok" != 1 ]; then
    echo "lumo-tamer did not come up. See $LUMO_HOME/server.stdout.log" >&2
    exit 1
  fi
fi

echo "OpenCode → http://127.0.0.1:3003 (local). Proxmox config is unused."
cd "$ROOT"
exec opencode "$@"
