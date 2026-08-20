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
