# lumo-tamer

```
                        ┌─────────────────┐     ┌─────────────────┐
┌─────────────────┐     │   lumo-tamer    │◄───►│  Home Assistant │
│  Proton Lumo    │     │                 │     └─────────────────┘
│                 │     │   Translation   │     ┌─────────────────┐
│  Your favorite  │◄───►│   Encryption    │◄───►│  Open WebUI     │
│  private AI     │     │   Tooling       │     └─────────────────┘
│                 │     │                 │     ┌─────────────────┐
└─────────────────┘     │                 │◄───►│   CLI           │ 
                        └─────────────────┘     └─────────────────┘
```

Use [Proton Lumo](https://lumo.proton.me/) in your favorite AI-enabled app or on the command line.

> **Official API support [is coming](https://www.reddit.com/r/lumo/comments/1qsa8xq/comment/o304ez3/) to Lumo!**  
> lumo-tamer will be ported to use the new API when it becomes available, and obsolete parts will be stripped out (depending on API features such as OpenAI compatibility, tools, conversation support). If you can't wait, give lumo-tamer a go!



[Lumo](https://lumo.proton.me/about) is Proton's privacy-first AI assistant, powered by open-source LLMs running exclusively on Proton-controlled servers. Your prompts and responses are never logged, stored, or used for training. See Proton's [security model](https://proton.me/blog/lumo-security-model) and [privacy policy](https://proton.me/support/lumo-privacy) for details.

lumo-tamer is a lightweight local proxy that talks to Proton's Lumo API using the same protocol as the official web client. Chat is U2L-encrypted on the wire (same as the official client). Tokens sit in an AES-256-GCM vault. Think "proton-bridge for Lumo".

This tree is a fork of [ZeroTricks/lumo-tamer](https://github.com/ZeroTricks/lumo-tamer). Credit for the original project belongs there.

<a href="https://buymeacoffee.com/banter240" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="50" width="181"></a>

## Features

- OpenAI-compatible API server with experimental tool support.
- Select the Lumo 2.0 model tier (Lite/Max) and thinking mode per request, via the OpenAI `model` and `reasoning_effort` fields.
- Interactive CLI, let Lumo help you execute commands, read, create and edit files.
- Sync your conversations with Proton to access them on https://lumo.proton.me or in mobile apps.
- U2L encryption on every real (non-mock) completion. Mock mode is the only path that turns it off.


## Project Status

This is an unofficial, personal project in early stages of development, not affiliated with or endorsed by Proton. Rough edges are to be expected. Only tested on Linux. Use of this software may violate Proton's terms of service; use at your own risk. See [Full Disclaimer](#full-disclaimer) below.

## Prerequisites

- A Proton account (free works; [Lumo Plus](https://lumo.proton.me/) gives unlimited daily chats)
- Node.js 18+ & npm (CI and the Docker image use Node 22)
- Go 1.25+ (for the `login` auth method)
- Docker (optional, for containerized setup)

## Quick Start

### 1. Install

```bash
git clone https://github.com/banter240/lumo-tamer.git
cd lumo-tamer
git checkout dev
npm install && npm run build:all
# Optionally install command `tamer` globally
# If you don't, replace "tamer" with "npx lumo-tamer" in all commands
npm link
```

For Docker installation, see [Docker](#docker).

User files (`config.yaml`, `sessions/`, logs) live next to the install by default. Override with `LUMO_HOME` or `tamer --home /path`.

### 2. Authenticate

```bash
tamer auth
```

A window opens (Chrome/Edge if installed). Log in to Lumo as usual. Tokens are saved and the window closes. No extra browser container to keep around.

Headless/Docker: open `http://<host>:3003/auth` (see [authentication](docs/authentication.md)). A Chromium sidecar is last resort.

<details>
<summary><strong>I'm asked to enter a CAPTCHA</strong></summary>

Log in to Proton in a regular browser from the same IP first. This often clears the challenge. If you're still hit with a CAPTCHA challenge after, you might want to try an [alternative auth method](docs/authentication.md).
</details>

<details>
<summary><strong>Why do I have to enter my password?</strong></summary>

Proton's security model doesn't allow for a simple OAuth authentication. Your credentials are not saved or logged, and security tokens are stored encrypted.
Alternatively: `tamer auth login` (password, may hit CAPTCHA) or `tamer auth rclone`.

See [docs/authentication.md](docs/authentication.md) for details and troubleshooting.

</details>

<details>
<summary><strong>I get an error saying no secure key storage is available.</strong></summary>

By default, lumo-tamer encrypts tokens with a key in your OS keychain. Without a keychain, the first `/auth` login writes `auth.vault.keyFilePath` (32 bytes, mode 0600) if that path is writable. Docker Compose still needs `secrets/lumo-vault-key` on the host because it mounts the file. To pre-create a key:

```bash
openssl rand -base64 32 > /path/to/your/lumo-vault-key
chmod 600 /path/to/your/lumo-vault-key
```

And add to `config.yaml`:
```yaml
auth:
  vault:
    keyFilePath: "/path/to/your/lumo-vault-key"
```
</details>




### 3. Run

```bash
# One-shot: ask a question directly
tamer "What is 2+2?"

# Interactive CLI
tamer

# Start server
tamer server
```


## Usage

### Server

Set an API key in `config.yaml`:
```yaml
server:
  apiKey: my-super-secret-key
  port: 3003            #Optional, change listening port
  bodyLimit: "1mb"      #Optional, default is 1mb (coding clients send large contexts)
```

Then run:
```bash
tamer server
```

Then, point your favorite OpenAI-compatible app to `http://yourhost:3003/v1` and provide your API key.
See [API clients](#api-clients) for some inspiration.

> **Security:** Keep your API key private and make sure lumo-tamer is only accessible from your local network, not the internet.

> **Tip:** Run `tamer server` as a docker service or use a tool like nohup to run it in the background.

### CLI

Talk to Lumo from the command line like you would via the web interface:
```bash
tamer                   # use Lumo interactively
tamer "make me laugh"   # one-time prompt
```

To give Lumo access to your files and let it execute commands locally, set `cli.localActions.enabled: true` in `config.yaml` (see [Local Actions](#local-actions-cli)).  
You can ask Lumo to give you a demo of its capabilities, or see this [demo chat](docs/demo-cli-chat.md).

### In-chat commands

Both CLI and API accept slash commands (or the `commands.wakeword` prefix, default `tamer`).

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/title <text>` | Set conversation title |
| `/save [title]` | Save / create a conversation on Proton (needs sync) |
| `/load <id>` | Load a conversation from Proton by ID (needs sync) |
| `/private` | Keep this conversation local; do not sync |
| `/refreshtokens` | Manually refresh auth tokens (usually unnecessary) |
| `/logout` | Revoke session, delete tokens, then exit the process |
| `/quit` | Exit the app (CLI only; runs `/save` if sync is on) |

## Configuration

Add configuration options to `config.yaml`. Find all options in [`config.defaults.yaml`](config.defaults.yaml), but don't edit this file directly.

Below is a non-exhaustive overview of the most common config sections and their options. Except for some auth settings (which are set by `tamer auth`), all settings are optional. Sync, native web search, and native image tools stay off until you turn them on. Client `tools[]` are honored by default (`customTools.enabled: true`). 

### Global options

Options in sections `log`, `conversations` and `commands` can be set globally (used by server and CLI), and can optionally be overwritten within `cli` and `server`.  
For example: set the default log output to your terminal at the `info` level, while the CLI logs to a file instead.
```yaml
log:
  # Levels: trace, debug, info, warn, error, fatal
  level: "info"
  # "stdout" or "file"
  target: "stdout"

cli:
  log:
    filePath: "lumo-tamer-cli.log"
```

### Images

Lumo can generate, edit and describe images. Enable the native image tools:

```yaml
server:
  enableImageTools: true
  images:
    maxInputBytes: "4mb"
  bodyLimit: "5mb"    # inbound image_url payloads count against this
```

Inbound: OpenAI `image_url` / `input_image` (data URLs or http(s)) are forwarded as Lumo images.  
Outbound: generated images are streamed as markdown data URLs (`![lumo:<id>](data:image/png;base64,...)`). The `lumo:<id>` alt text is the Proton image id, so a later `edit_image` / `describe_image` can find it.

### Web Search

Native web search (plus weather, stock, cryptocurrency) is off so Lumo does not hit the open web unless you want that (HA-only setups, fewer native/custom mix-ups):

```yaml
server:
  enableWebSearch: true

cli:
  enableWebSearch: true
```

### Model Tiers and Thinking Mode

lumo-tamer maps standard OpenAI request fields to Lumo 2.0's model tier and answer mode:

- `model`: `lumo` (Proton auto-routes), `lumo-lite`, or `lumo-max`. These are advertised on `/v1/models`; an unknown model returns HTTP 400.
- `reasoning_effort`: `high` (also `low`/`medium`) turns on thinking mode, `none` turns it off. In the Responses API, use `reasoning.effort` instead.

Defaults and surfacing are configurable:

```yaml
server:
  # Tier used when a request omits the model field: auto, lumo-lite, lumo-max
  defaultModelTier: "auto"
  # Models advertised on /v1/models and accepted in the model field
  allowedModels: ["lumo", "lumo-lite", "lumo-max"]
  reasoning:
    # Used when a request omits reasoning_effort: "none" or "high".
    # Default none = compact/fast. lumo-max still thinks when effort is omitted.
    default: "none"
    # Forward Lumo's thinking tokens as delta.reasoning_content (streaming)
    # or message.reasoning_content (non-streaming)
    surfaceThinking: false
```

Add your own names that pick a real Lumo tier and a thinking default. They show up on `/v1/models`. A request `reasoning_effort` still wins.

```yaml
server:
  extraModels:
    - id: lumo-lite-thinking
      model: lumo-lite
      reasoning: high
    - id: lumo-max-reasoning
      model: lumo-max
      reasoning: high
    - id: lumo-max-fast
      model: lumo-max
      reasoning: none
```

> **Note:** Availability of `lumo-max` and thinking mode depends on your Proton plan. Requests are end-to-end encrypted the same way as the rest of lumo-tamer.

**Known limitations:**
- `low`/`medium`/`high` effort values are equivalent: Lumo only has binary thinking on/off.
- `"none"` is a lumo-tamer extension; standard OpenAI clients don't send it. Default is compact (no think). `lumo-max` still thinks when effort is omitted; send `reasoning_effort: "none"` to turn that off.
- `reasoning_content` follows Deepseek's convention, not the OpenAI spec. It works with clients that support it (Cursor, Open WebUI with Deepseek config). With `server.reasoning.surfaceThinking: true`, the Responses API emits `reasoning_text` parts.

### Context window

Yes: the window is **128.0K tokens**. That is what the Lumo app shows as "context use for this conversation". The OpenAI facade has no such meter (`/v1/models` is only `id` / `owned_by`).

Lumo's own copy:

> Lumo can only process a limited amount of information per conversation. This is what currently occupies that space; when it is full, older messages are automatically summarized so you can keep chatting.

Example from the app:

| | |
|---|---|
| **99.0K / 128.0K tokens (77%)** | |
| Conversation | 99.0K |
| Files | 0 |
| Reserved, to keep chatting | 12.8K |
| Free space | 16.2K |

12.8K reserved + conversation + files + free = 128.0K. The reserve is 10% of the window, so chatting can continue; when the bar is full, Lumo summarizes older messages. lumo-tamer does not run that summarizer.

Client catalogs need integers. **128.0K = 131072** (128 × 1024). **12.8K = 13107**. Set those as OpenCode `limit.context` / `limit.output` or OpenClaw `contextWindow` / `maxTokens`. See [OpenCode](docs/opencode.md) and [OpenClaw](docs/openclaw.md).

### Instructions

Customize instructions with `server.instructions.template` and `cli.instructions.template`. See [`config.defaults.yaml`](config.defaults.yaml) for more options.

Instructions from API clients will be inserted in the main template. If you can, put instructions on personal preferences within your API client and only use `server.instructions` to define the internal interaction between Lumo and lumo-tamer.


> **Note:** Under the hood, lumo-tamer injects instructions into normal messages (the same way it is done in Lumo's webclient). Instructions set in the webclient's personal or project settings will be ignored and left unchanged.

### Custom Tools (Server)

Let Lumo use tools provided by your OpenAI-compatible client. On by default.

```yaml
server:
  customTools:
    enabled: true   # default; set false to ignore client tools[]
```

`tool_choice` (`auto` / `none` / `required` / named function) is honored via extra instructions. Lumo must emit one raw JSON line (`{"name":"user:…","arguments":{…}}`). See [Custom Tools](docs/custom-tools.md).

> **Warning:** Custom tool support is experimental and can fail in various ways. Experiment with `server.instructions` settings to improve results. 


### Local Actions (CLI)

Let Lumo read, create and edit files, and execute commands on your machine:

```yaml
cli:
  localActions:
    enabled: true
    fileReads:
      enabled: true
    executors:
      bash: ["bash", "-c"]
      python: ["python", "-c"]
```

The CLI always asks for confirmation before executing commands or applying file changes. File reads are automatic.  
Configure available languages for your system in `executors`. By default, `bash`, `python`, and `sh` are enabled.  
See [Local Actions](docs/local-actions.md) for further configuration and troubleshooting.

### Conversation Sync

```yaml
conversations:
  enableSync: true
  projectName: "lumo-tamer" # project conversations will belong to
```
> **Note:** Sync needs a Lumo-scoped session: browser cookies, or password/`/auth` login that got Lumo scope (not the CAPTCHA Drive fallback).

> **Warning:** Projects in Lumo have a limit on the number of conversations per project. When hit, sync will fail. Deleting conversations won't help. Use a new `projectName` as a workaround. See [#16](https://github.com/ZeroTricks/lumo-tamer/issues/16).


## API clients

The server implements a subset of OpenAI-compatible endpoints and has so far been tested with a handful of clients only.

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | [OpenAI chat completions](https://platform.openai.com/docs/api-reference/chat/create) (`response_format` json_schema / json_object is emulated) |
| `POST /v1/responses` | [OpenAI responses API](https://platform.openai.com/docs/api-reference/responses/create) |
| `GET /v1/models` | List available models (`lumo`, `lumo-lite`, `lumo-max`) |
| `GET /v1/models/:id` | Single model |
| `GET /health` | Health check (`status`, queue, auth) |
| `GET /auth` | Proton login page (Docker / Portainer) |
| `POST /auth/login` | Same login, JSON body |
| `POST /auth/logout` | Sign out (no API key; server stays up) |
| `GET /config` | Edit `config.yaml` (toggles / text; API key is write-only) |
| `GET /v1/config` | Config fields as JSON (`server.apiKey` is never returned) |
| `PUT /v1/config` | Save selected keys or `{ resetAll: true }` (keeps apiKey), then restart |
| `GET /v1/auth/status` | Session / sync-capability |
| `POST /v1/auth/refresh` | Force token refresh |
| `POST /v1/auth/logout` | Revoke session and exit the process |
| `GET /metrics` | [Prometheus metrics](docs/development.md#metrics) (off by default) |

Following API clients have been tested and are known to work.

### Home Assistant

See the [full guide](docs/howto-home-assistant.md). TLDR:

- Pass the environment variable `OPENAI_BASE_URL=http://yourhost:3003/v1` to Home Assistant.
- Add the OpenAI integration and create a new Voice Assistant that uses it.
- Set the conversation model to `lumo` or `lumo-max`. Other names (`gpt-4o`, …) return HTTP 400.
- Client `tools[]` are on by default. See [Custom Tools](docs/custom-tools.md).
- Open HA Assist in your dashboard or phone and chat away.

### OpenClaw
Add Lumo to `models.providers` in your OpenClaw config. Window is 128.0K (`contextWindow` 131072). [Example](docs/openclaw.md).

### OpenCode
Add Lumo to your `opencode.json` / `opencode.jsonc`. Set each model `limit.context` to 131072 (128.0K; required for auto-compaction) and `limit.output` to 13107 (12.8K reserved). [Example](docs/opencode.md). [Context window](#context-window).

### Nanocoder
Status: very experimental.

Nanocoder sends many instructions and relies on Lumo calling **a lot** of tools. Lumo will misroute many tool calls and will retry by calling tools with wrong parameters. Basic usage works, but don't expect a fully working coding assistant experience.

### Open WebUI

For your convenience, an Open WebUI service is included in `docker-compose.yml`. Launch `docker compose --profile webui up -d` and open `http://localhost:3080`. It is not started by default.

> **Note:** Open WebUI will by default prompt Lumo for extra information (to set title and tags). Disable these in Open WebUI's settings to avoid cluttering your debugging experience.

### cURL

```bash
curl http://localhost:3003/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "lumo",
    "messages": [{"role": "user", "content": "Tell me a joke."}],
    "stream": true
  }'
```

### Other API clients

Many clients are untested with lumo-tamer but should work if they only use the `/v1/responses` or `/v1/chat/completions` endpoints. As a rule of thumb: basic chatting will most likely work, but the more a client relies on custom tools, the more the experience is degraded.  
To test an API client, increase log levels on both the client and lumo-tamer: `server.log.level: debug` and check for errors.

Please share your experiences with new API clients (both issues and successes) in [the project discussions](https://github.com/ZeroTricks/lumo-tamer/discussions/new?category=general)!


## Docker

It is recommended to run lumo-tamer's server in a Docker container.

### Install

```bash
git clone https://github.com/banter240/lumo-tamer.git
cd lumo-tamer
git checkout dev
# Create secret key to encrypt the token vault (or alternatively, use another secrets manager)
mkdir -p secrets && chmod 700 secrets
openssl rand -base64 32 > secrets/lumo-vault-key
chmod 600 secrets/lumo-vault-key
cp -n .env.example .env
# Compose bind-mounts this file. If it is missing, Docker creates a directory.
touch config.yaml
```

The box runs the GHCR tag in `.env` (`LUMO_TAMER_IMAGE`), not the git branch. Default is `:dev`. Update later:

```bash
docker pull ghcr.io/banter240/lumo-tamer:dev
docker compose up -d tamer
```

`docker compose build tamer` is only if you build the image yourself.

Watchtower is optional (`docker compose --profile watch up -d`) and only logs; it does not recreate the container.

### Configure

Create `config.yaml`:

```yaml
server:
  apiKey: "your-secret-api-key-here"
```

> **Security:** Keep your API key private and make sure lumo-tamer is only accessible from your local network, not the internet. Disable docker port forwarding if API clients belong to the same docker network.

### Authenticate

Start only `tamer`, then open the login page in any browser (your laptop, phone, Portainer host, whatever):

```bash
docker compose up -d tamer
# open http://<host>:3003/auth
```

Type your Proton email, password, and 2FA if you use it. No extra Chromium container.

Settings UI: `http://<host>:3003/config` (see [Configuration](docs/config.md)).

<details>
<summary><strong>CAPTCHA, 2028 abuse lock, or hardware-key login</strong></summary>

First try logging in to [lumo.proton.me](https://lumo.proton.me) in a normal browser from the **same internet** as the server, then `/auth` again.

If Proton still blocks password login, start the optional Chromium sidecar (~1 GB, only for this login):

```bash
docker compose --profile browser up -d browser
# open http://<host>:3001  -> log in at lumo.proton.me
docker compose run --rm tamer auth browser   # CDP http://browser:9222
docker compose --profile browser stop browser
```

Do not leave that container running. Details: [authentication](docs/authentication.md#headless--docker).
</details>

### Run
Server:
```bash
docker compose up -d tamer
```
CLI:
```bash
docker compose run --rm -it -v ./some-dir:/dir/ tamer cli
```

> **Note:** Running the CLI within Docker may not be very useful:
> - Lumo will not have access to your files unless you mount a directory.
> - The image is Alpine-based, so your system may not have the commands Lumo tries to run. You can change config options `cli.localActions.executors` and `cli.instructions.forLocalActions` to be more explicit what commands Lumo should use, or you can rebase the `Dockerfile`.



## Further Reading

See [docs/](docs/) for detailed documentation:

- [Authentication](docs/authentication.md): Auth methods, setup and troubleshooting
- [Configuration](docs/config.md): `config.yaml` and the `/config` page
- [Conversations](docs/conversations.md): Conversation persistence and sync
- [Custom Tools](docs/custom-tools.md): Tool support for API clients
- [Home Assistant Guide](docs/howto-home-assistant.md): Use Lumo as your Voice Assistant
- [OpenClaw](docs/openclaw.md) / [OpenCode](docs/opencode.md): Client config snippets
- [Local Actions](docs/local-actions.md): CLI file operations and code execution
- [Development](docs/development.md): Development setup and workflow
- [Upstream Files](docs/upstream.md): Proton WebClients files, shims and path aliases

## Roadmap

- **Getting feedback**: I'm curious how people use lumo-tamer and what they run into.
- **Test more API clients**: Test new & improve existing integrations with API clients.
- **Better auth**: CAPTCHA still forces a Drive-scoped fallback (chat only). SimpleLogin OAuth is unsolved.

## Full Disclaimer

- **Unofficial project.** This project is not affiliated with, endorsed by, or related to Proton AG in any way.
- **Terms of service.** Use of this software may violate Proton's terms of service.
- **Rate limiting and token usage.** Although care was put into making the app behave, it may make many API calls, potentially getting you rate-limited, or burn through your allowed tokens quickly. I have not experienced either of these issues on Lumo Plus.
- **Security.** This app handles Proton user secrets. Although the code is vetted to the best of my knowledge and follows best practices, this is not my area of expertise. Please verify for yourself.
- **AI-assisted development.** This code was written with the extensive use of Claude Code.
- **Tool execution.** Enabling tools gives Lumo the power to execute actions client-side (API or CLI). I am not responsible for Lumo's actions. lumo-tamer does not prevent prompt injection.

## License

GPLv3 - See [LICENSE](LICENSE). Includes code from [Proton WebClients](https://github.com/ProtonMail/WebClients). Original project: [ZeroTricks/lumo-tamer](https://github.com/ZeroTricks/lumo-tamer).

<a href="https://buymeacoffee.com/banter240" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="50" width="181"></a>
