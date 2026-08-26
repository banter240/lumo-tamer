## [0.7.0-dev.6](https://github.com/banter240/lumo-tamer/compare/v0.7.0-dev.5...v0.7.0-dev.6) (2026-08-26)

### Features

* feat(web-ui): toast notifications replace toolbar messages

  - Added toast container with slideIn animation (ok/err/muted variants).
  - Save success/error: toast-only, no msgEl updates.
  - Restart: muted toast on start, waiting, success (via localStorage post-reload), err on failure.

## [0.7.0-dev.5](https://github.com/banter240/lumo-tamer/compare/v0.7.0-dev.4...v0.7.0-dev.5) (2026-08-26)

### Bug Fixes

* fix(ui): theme toggle wipes DOM, broken tool protocol newlines, stale number input check

  - Theme toggle used btn.innerHTML, wiping DOM elements on every switch; now renders both icons once and toggles display.
  - config.defaults.yaml had literal 'n' instead of newlines in custom tool protocol text.
  - onEdit checked el.type === 'number' but inputs use type='text' inputmode='decimal'; switched to el.inputMode.
  - Removed duplicate button.secondary CSS rules.

## [0.7.0-dev.4](https://github.com/banter240/lumo-tamer/compare/v0.7.0-dev.3...v0.7.0-dev.4) (2026-08-24)

### Features

* feat(web-ui): split save and restart, add server-down banner, fix number inputs

  Overhaul the /config page so saving config no longer forces a server
  restart. A dedicated /v1/restart endpoint handles voluntary restarts.
  Number fields switched from type=number to text+inputmode to dodge
  browser locale commas.

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SAVE AND RESTART SEPARATED
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  - PUT /v1/config no longer calls hooks.onSaved(); it writes the YAML
    and returns immediately. The UI reloads the form without a restart.
  - New POST /v1/restart endpoint exits the process so Docker/tsx-watch
    can bring it back up. Added to isOpenUiPath and setupReadyMiddleware
    so it bypasses API-key and auth-readiness checks.
  - Toolbar has three buttons now: Reset to defaults (UI-only, no save),
    Save (enabled only when dirty), Restart (always enabled, secondary).
  - Save clears dirty/resets, reloads fields, shows 'Saved.' status.
  - Restart confirms, posts /v1/restart, polls /health, reloads page.
  - Reset to defaults sets all visible fields to their defaultValue in
    the UI only. No server call. Refresh the page to undo.

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SERVER-DOWN BANNER
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  - New red banner element shown when /health is unreachable or non-ok.
  - Auth banner hidden when server is down instead of falsely showing
    'Not logged in'.
  - Polling logic distinguishes: 200+auth.valid -> green, 200+no auth ->
    auth banner, non-ok or network error -> server-down banner.

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  NUMBER INPUT FIXES
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  - Switched from type=number (spinner arrows, locale comma) to type=text
    with inputmode=decimal for all numeric config fields.
  - parseCurrent replaces commas with dots before Number() conversion.
  - onEdit also sanitises commas on every keystroke.

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  CSS AND UX POLISH
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  - background-attachment: fixed on body prevents glow gradient jump
    when switching between config categories of different heights.
  - cursor: not-allowed replaces cursor: wait on disabled buttons.
  - Duplicate button.secondary CSS rules cleaned up.
  - Config category persisted to localStorage on nav click, restored
    on page load.
  - Layout min-height ensures sidebar reaches viewport bottom.
  - updateButtons() called after every edit/reset/undo to keep the
    Save button state correct.

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SERVER RESTART LOGGING
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  - restartAfterConfigSave logs each path: Docker/k8s exit, tsx-watch
    poke, fallback respawn. Previously only a single 'Shutting down'
    line appeared with no indication of which restart strategy fired.

## [0.7.0-dev.3](https://github.com/banter240/lumo-tamer/compare/v0.7.0-dev.2...v0.7.0-dev.3) (2026-08-21)

### Features

* feat(usage): estimate prompt_tokens from request body

  Proton does not report prompt/input token counts, only completion
  tokens. This caused OpenCode's auto-compact to never trigger —
  it saw prompt_tokens: 0 and thought the context was empty.

  Estimate prompt_tokens from the serialized request body size
  (~4 chars/token). Not exact, but sufficient for compaction
  decisions. Also fix total_tokens to include both prompt and
  completion instead of completion only.

  Changes:
  - LumoUsage: add prompt_tokens field
  - client.ts: estimate after buildChatCompletionsBody(), attach to usage
  - shared.ts: use estimated prompt_tokens instead of hardcoded 0
  - request-handlers.ts: estimate input_tokens from request.input for
    Responses API
  - Tests updated to expect prompt_tokens in usage

## [0.7.0-dev.2](https://github.com/banter240/lumo-tamer/compare/v0.7.0-dev.1...v0.7.0-dev.2) (2026-08-21)

### Bug Fixes

* fix(lumo-client): remove image tool infrastructure

  Image tools were half-implemented: no Proton Attachment API, Base64
  inflation past 131k context, and OpenCode ignores /v1/models vision
  capabilities. Rather than ship broken code, delete every trace and
  start fresh if image support returns.

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STREAM AND ENCRYPTION
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  - Drop image_data V2StreamMessage variant and SSE handler in v2-stream
  - Remove encryptImage, base64StringToUint8Array, uint8ArrayToBase64String
    from encryption.ts; encryptTurn no longer touches images
  - Strip decryptImage, finishImage, pendingImages from client.ts
  - onImage callback removed from LumoClientOptions; ChatResult.images gone

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  TYPES AND WIRE FORMAT
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  - Delete GeneratedImage type; images field dropped from ChatCompletionsMessage
    and MessageForStore
  - WireImage import removed from encryption.ts
  - v2-body.ts no longer maps turn.images onto the wire
  - instructions.ts filters user turns by content only, not images

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  CONFIG AND TOOLS
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  - Delete getEnableImageTools, getImagesMaxBytes from config.ts
  - Remove enableImageTools and images.maxInputBytes from config-editor-copy
  - IMAGE_TOOLS removed from native-tools.ts; selectNativeTools drops images param
  - generate_image, describe_image, edit_image no longer in KNOWN_NATIVE_TOOLS
  - extractImagesFromContent, fetchImageAsBase64 removed from message-converter
  - redactGeneratedImages removed from cli/client.ts
  - vision capability stripped from /v1/models endpoint

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  TESTS
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  - Delete tests/unit/images.test.ts entirely
  - Remove image_data tests from v2-stream.test.ts
  - Remove image_url forwarding test from message-converter.test.ts
  - Switch native-tool-call-processor test from generate_image to proton_info
  - Remove images assertion from v2-body.test.ts

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  INTACT
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  - Client tools flattening, extraModels aliases from commit 3c63eae
  - Upstream WireImage type in packages/lumo/src/types-api.ts
  - decryptUint8Array re-export (may be used by upstream consumers)

## [0.7.0-dev.1](https://github.com/banter240/lumo-tamer/compare/v0.6.0...v0.7.0-dev.1) (2026-08-20)

* ci: GHCR images and semantic-release on dev and main

  Publish ghcr.io/banter240/lumo-tamer from GitHub Actions.
  dev builds :dev. main builds :latest plus a version tag.
  semantic-release writes CHANGELOG.md and package.json from
  conventional commits. Do not edit CHANGELOG.md by hand.

  - workflows: ci.yml and release.yml
  - .releaserc conventionalcommits; no GitHub PR comments
  - scripts/ci-local.sh matches GitHub (tsc + unit + integration)
  - Go 1.25 in the login helper image
  - FUNDING.yml Buy Me a Coffee (banter240)

### Features

* feat(api): flatten client tools, extraModels aliases, and image tools

  OpenAI-style tools[] from OpenCode, Home Assistant, and similar clients
  must not reach Proton as native tool definitions. Flatten every client
  tool into the prompt, detect JSON tool calls in the stream, and keep
  schemas compact so context stays small. Operators can advertise extra
  model names, and optional Lumo image tools stay off unless enabled.

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  CLIENT TOOLS
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Proton rejects or misroutes custom tool protocols. Clients such as
  OpenCode send large tools[] payloads; those have to become text.

  - Flatten all client tools before the Lumo 2.0 request
  - StreamingToolDetector: LINE_START plus inline {"name":
  - forTools and forToolsCompact with {{prefix}} substitution
  - Honor tool_choice none / auto / required
  - Force injectInto last when the client sent tools
  - Prefix user: so Lumo does not treat client names as native tools

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  EXTRAMODELS
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /v1/models can list extra names the operator chooses. Each alias maps
  to a real Lumo tier and an optional thinking override. A request that
  sets reasoning_effort still wins.

  - extraModels: {id, model, reasoning?}
  - resolveReasoning: request > alias > global default
  - lumo-max still thinks when nothing sets effort

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  IMAGE TOOLS
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Optional generate / edit / describe. Off by default so replies do not
  turn into huge data URLs when you asked Lumo to toggle a light.

  - enableImageTools plus images.maxInputBytes
  - Return generated images as data URLs
* feat(app): /config editor, LUMO_HOME, and safer proxy defaults

  A browser form writes config.yaml and restarts. Data lives under
  LUMO_HOME or --home. Defaults match a proxy: search, images, and
  sync off; custom tools on; reasoning none; fallback store on.

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  CONFIG EDITOR
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  - GET /config plus GET/PUT /v1/config
  - Category nav (Server, Models, Tools, …); Advanced is prompt text
  - Human labels, short copy, YAML key, More/Example when needed
  - Default on the right (not on the API key); Undo after edits
  - Dark/light theme shared with /auth
  - server.apiKey is write-only and never returned
  - After save, poll /health then reload the page
  - Reset to defaults keeps server.apiKey; confirm, then restart like Save
  - After save, Docker exits; local tsx watch is poked so it restarts

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PATHS AND PRIVACY
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  - LUMO_HOME / --home for vault, logs, and browser profile
  - /private for conversation dumps (not /health)
  - deriveIdFromUser and fallback store stay the Home Assistant path
  - Broken vault at startup is skipped so /auth can mint a new one

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DEFAULTS
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  - auth.method browser, bodyLimit 1mb, extraModels []
  - enableWebSearch / enableImageTools / enableSync false
  - customTools.enabled true, reasoning.default none
* feat(auth): Lumo-scoped login page and password flow

  Add a /auth WebUI and make password login request Lumo scope first,
  then fall back to Drive plus CAPTCHA when Proton challenges the
  client. Tokens stay in the AES-256-GCM vault and refresh without
  dropping the session. Proton 2028 (abuse lock) cannot retry SRP;
  on a desktop a Chrome window opens instead.

  - GET /auth plus POST /auth/login, logout, refresh, and status
  - Proton-like login card; dark/light theme shared with /config
  - Shared header: GitHub, theme, Settings/Account swap; same brand on both pages
  - Login-fail details (CAPTCHA, 2028 desktop, Docker sidecar)
  - Proton Pass OTP field (autocomplete=one-time-code)
  - Signed-in status: Lumo API Ready plus lumo.proton.me On/Off/Unavailable
  - Log out without killing the server
  - Missing vault key file is created so /auth can start
  - Go SRP helper: try web-lumo before the Drive client
  - Resolve the helper as .exe on Windows
  - Skip title generation unless conversation sync is initialized
  - Surface whether the session can sync
  - Optional dumpApiPath traces Proton calls without auth headers

### Bug Fixes

* fix(app): register fallback store in mock mode

  In initializeMock(), when useFallbackStore is true the else-branch
  called getFallbackStore() but never registered it as the active
  conversation store via setConversationStore(). This left the
  activeStore singleton null, so APIServer.getDependencies() threw
  'ConversationStore not initialized - call initializeConversationStore()
  first' on startup, causing a crash loop in mock mode.

  Wrap the call in setConversationStore(), mirroring the primary-store
  branch above.
* fix(docker): pin GHCR tag and optional compose profiles

  The host runs the image in LUMO_TAMER_IMAGE, not a git branch.
  Watchtower, browser, and Open WebUI stay behind compose profiles.
  Watchtower is notify-only so a moving tag cannot restart the box
  without an explicit pull.

  - image: ${LUMO_TAMER_IMAGE:-ghcr.io/banter240/lumo-tamer:dev}
  - pull_policy: missing
  - .env.example documents pin vs moving tags
  - Drop .vscode and CLAUDE.md from the published tree

### Documentation

* docs: describe the fork against current code

  Document /auth, /config (categories, examples, dark/light, reset), extraModels,
  image tools, LUMO_HOME, and deploy. Credit ZeroTricks. Keep docs matched
  to the code so a later merge from upstream is reviewable file by file.
