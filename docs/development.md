# Development

## Setup

```bash
npm install
npm run build
```

CI and the Docker image use Node 22. User files (`config.yaml`, `sessions/`, logs) live next to the install by default; override with `LUMO_HOME` or `tamer --home /path`.

See the [README](../README.md) for authentication setup.

## Dev Commands

```bash
npm run dev:server           # API server with hot reload (tsx watch)
npm run dev:cli              # CLI

npm run dev:server:debug     # API server with Node inspector (port 9229)
npm run dev:cli:debug        # CLI with Node inspector
```

Hot reload uses `tsx watch`. Edit, save, done.

To attach a debugger, open `chrome://inspect` in Chrome and add `localhost:9229`.

## Local debug home

Keep Proxmox as production. Debug here so logs stay on disk.

```bash
mkdir -p .local
cp config.local.example.yaml .local/config.yaml
LUMO_HOME=.local npm run dev:server
```

`.local/` is gitignored (`config.yaml`, vault, `lumo-tamer.log`, `dump-api.jsonl`).

Mock is on in the example (`historyToolEcho` streams `Done read` plus args JSON). Check the detector without Proton:

```bash
curl -sS http://127.0.0.1:3003/v1/chat/completions \
  -H 'Authorization: Bearer local-dev-key' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "lumo",
    "messages": [{"role": "user", "content": "read the file"}],
    "tools": [{"type": "function", "function": {"name": "read", "parameters": {"type": "object", "properties": {"filePath": {"type": "string"}}}}}]
  }'
```

Expect `tool_calls` with `name: read`, not the string `Done read` in `content`. Tail `.local/lumo-tamer.log`.

Live Lumo: set `test.mock.enabled: false` in `.local/config.yaml`, then **you** open `http://127.0.0.1:3003/auth` in your browser. Do not paste email, password, or vault keys into chat. Agents must not read `.local/config.yaml`, `sessions/vault*`, or `/auth`. The logger redacts login fields (email, username, passwords, tokens, uid, cookies). Debug from `Tool call detected` / `Bouncing` lines (`messageContent` stays false).

### OpenCode against local tamer

Production OpenCode (`~/.config/opencode`) still talks to Proxmox. For this box:

```bash
./scripts/dev-opencode.sh
```

Or in `ai-core/bin/start_ai.sh`: pick scratch **OpenCode → local lumo-tamer**, then OpenCode. That sets `OPENCODE_CONFIG=.local/opencode.json` (`http://127.0.0.1:3003/v1`, key `local-dev-key`) and starts the local server if needed.

## Build

```bash
npm run build                # TypeScript compilation + alias resolution

# Optional: Go binary for login auth method
cd src/auth/login/go && go build -o ../../../../dist/proton-auth && cd -
```

## Project Structure

```
packages/
├── lumo/                      # @lumo/* - synced from Proton WebClients/applications/lumo/src/app/ (do not edit)
└── proton/                    # @proton/* - synced from Proton WebClients/packages (do not edit)
src/
├── tamer.ts                   # Entry point (CLI, server, auth)
├── api/                       # OpenAI-compatible API
│   └── routes/                # /v1/responses, /v1/chat/completions, etc.
├── app/                       # Shared application logic
│   ├── config.ts              # Configuration management
│   ├── commands.ts            # Slash commands (/save, /help, /logout, etc.)
│   └── logger.ts              # Pino logger
├── cli/                       # CLI client (interactive mode, file ops, code execution)
├── auth/                      # Authentication (browser, login, rclone)
│   ├── browser/               # CDP-based browser token extraction
│   ├── login/                 # Go SRP binary integration
│   ├── rclone/                # Rclone config parsing
│   └── vault/                 # Encrypted credential storage
├── lumo-client/               # Bridge to Proton. Chat is U2L-encrypted by default
├── mock/                      # Mock mode: simulated API responses (encryption off)
├── conversations/             # Store + optional Proton sync (AEAD when sync is on)
│   ├── key-manager.ts         # User / space keys for sync
│   └── fallback/sync/         # Default store; encryption-codec.ts for synced payloads
└── shims/                     # Non-Proton polyfills (IndexedDB, lodash, etc.)
```

See [upstream.md](upstream.md) for details on upstream files and shims.

## Upstream Sync

```bash
npm run sync-upstream

# With a visual diff tool:
DIFF_TOOL=meld npm run sync-upstream
```

Fetches files from GitHub, compares with local copies, and provides an interactive menu to review changes, update files, and track the upstream commit.

See [upstream.md](upstream.md) for file mappings.

## Mock Mode

Bypass authentication and use simulated Lumo responses for development:

```yaml
# config.yaml
test:
  mock:
    enabled: true
    scenario: "success"  # success, error, timeout, rejected, toolCall, misroutedToolCall, historyToolEcho, weeklyLimit, cycle
```

Encryption and conversation sync are disabled automatically. Scenarios are adapted from Proton WebClients `applications/lumo/src/app/mocks/handlers.ts`.

## Testing

Framework: Vitest.

```bash
npm test              # All tests (unit + integration + e2e)
npm run test:unit     # Unit tests only
npm run test:integration  # Integration tests only
npm run test:ci       # Same as GitHub: tsc + unit + integration (no e2e)
../.venv/bin/pre-commit install   # run test:ci on every commit
```

### Test Structure

```
tests/
├── unit/             # Pure function/class tests
├── integration/      # HTTP endpoint tests
├── e2e/              # OpenAI SDK compatibility, CLI smoke tests
├── helpers/
│   └── test-server.ts  # Express app with mock dependencies
└── setup.ts          # Initializes config, silences logger
```

### Key Points

- Tests inject `createMockProtonApi()` directly, bypassing Application and config.yaml
- `tests/helpers/test-server.ts` creates an Express app with mock dependencies for integration tests
- `tests/setup.ts` initializes config and silences the logger for all tests

## API dump

Set `log.dumpApiPath` to append one redacted JSON line per Proton call. Auth headers are never written. Empty path keeps dumping off.

## Metrics

The server can expose Prometheus-compatible metrics at `/metrics`. To enable and configure:  
`config.yaml`:
```yaml
server:
  metrics:
    enabled: true
    collectDefaultMetrics: true
    prefix: "lumo_"
```

A Grafana dashboard is included at [`grafana-lumo-tamer-dashboard.json`](../grafana-lumo-tamer-dashboard.json).

## Release

Push to `dev` or `main` runs tests, then semantic-release (tag, CHANGELOG, GitHub Release, GHCR).

- `dev` → `v0.7.0-dev.N` and `…/lumo-tamer:dev` (pre-release)
- `main` → `v0.7.0` and `…/lumo-tamer:latest`

The host runs a **pinned image**, not a git branch. Copy `.env.example` to `.env` and set `LUMO_TAMER_IMAGE` (`:latest` / main, or `:dev`). Create `config.yaml` before the first `compose up` (Docker would otherwise create a directory at that path).

Self-update uses the Docker socket on the tamer container (see [Updates](updates.md)). There is no standing updater.

```bash
docker pull ghcr.io/banter240/lumo-tamer:latest   # or :dev / :0.7.0
docker compose up -d tamer
```
