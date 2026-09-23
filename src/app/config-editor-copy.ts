/**
 * Human copy for /config: one entry per YAML path.
 * Prefix/suffix rules fill in CLI variants and executor rows.
 */

import { APP, APP_GITHUB_URL, AUTH, CDP, DOCKER_UPDATE, GITHUB, PORTS, TOKEN_ESTIMATE, UPDATES } from './const.js';

export interface ConfigExample {
  label: string;
  value: string;
}

export interface ConfigCategory {
  id: string;
  title: string;
  blurb: string;
  parent?: string; // if set, this is a sub-category shown indented under its parent
}

export type FieldKindOverride = 'secret' | 'json';

export interface FieldCopy {
  label?: string;
  hint?: string;
  more?: string;
  examples?: ConfigExample[];
  choices?: string[];
  kind?: FieldKindOverride;
  noDefault?: boolean;
}

/** Sidebar groups on /config, ordered by priority for a normal user:
 * setup first (Sign-in, Server), then daily knobs (Models, Tools, Conversations,
 * Commands, Prompts), then maintenance (Logging, Updates), niche surfaces (CLI),
 * and Expert last. Every main category has at least one sub.
 * Rule: main categories with subs show no own fields; clicking the parent aggregates all children. */
export const CONFIG_CATEGORIES: ConfigCategory[] = [
  // Setup
  { id: 'auth', title: 'Sign-in', blurb: 'How this server authenticates with Proton.' },
  { id: 'authGeneral', title: 'General', parent: 'auth', blurb: 'Sign-in method selector.' },
  { id: 'refresh', title: 'Token Refresh', parent: 'auth', blurb: 'Keep Proton tokens fresh for long sessions.' },
  { id: 'server', title: 'Server', blurb: 'HTTP surface: port, API key, and request limits.' },
  { id: 'serverGeneral', title: 'General', parent: 'server', blurb: 'Listen port, API key, request size limits.' },
  { id: 'metrics', title: 'Metrics', parent: 'server', blurb: 'Prometheus /metrics endpoint and runtime counters.' },
  // Daily use
  { id: 'models', title: 'Models', blurb: 'Lumo tiers and reasoning defaults.' },
  { id: 'modelTiers', title: 'Tiers', parent: 'models', blurb: 'Model names, default tier, aliases.' },
  { id: 'reasoning', title: 'Reasoning', parent: 'models', blurb: 'Thinking effort defaults.' },
  { id: 'tools', title: 'Tools', blurb: 'Native Proton tools and custom (JSON) tool integration.' },
  { id: 'toolsGeneral', title: 'General', parent: 'tools', blurb: 'Web search and custom tool master switch.' },
  { id: 'routing', title: 'Routing', parent: 'tools', blurb: 'Coexistence of native and custom tools.' },
  { id: 'recovery', title: 'Reply Recovery', parent: 'tools', blurb: 'Bounce malformed tool calls and thinking loops.' },
  { id: 'chats', title: 'Conversations', blurb: 'Thread storage and Proton syncing.' },
  { id: 'chatStorage', title: 'Storage', parent: 'chats', blurb: 'Database path, fallback store, and ID derivation.' },
  { id: 'sync', title: 'Proton Sync', parent: 'chats', blurb: 'Mirror conversations to Proton servers.' },
  { id: 'commands', title: 'Commands', blurb: 'Slash commands and optional spoken wakeword.' },
  { id: 'commandsGeneral', title: 'General', parent: 'commands', blurb: 'Enable commands and configure the wakeword.' },
  { id: 'prompts', title: 'Prompts', blurb: 'Instruction text Lumo sees and injection points.' },
  { id: 'promptsGeneral', title: 'General', parent: 'prompts', blurb: 'Fallback prompt, JSON-format nudge, and injection point.' },
  // Maintenance
  { id: 'logs', title: 'Logging', blurb: 'Log levels, destinations, and privacy settings.' },
  { id: 'logsGeneral', title: 'General', parent: 'logs', blurb: 'Log verbosity, file output, and message privacy.' },
  { id: 'updates', title: 'Updates', blurb: 'GitHub release checks and Docker self-update.' },
  { id: 'updatesGeneral', title: 'General', parent: 'updates', blurb: 'Release channel, repository, check interval.' },
  { id: 'docker', title: 'Docker Self-Update', parent: 'updates', blurb: 'Docker socket access and auto-apply settings.' },
  // Niche surfaces
  { id: 'cli', title: 'CLI', blurb: 'Desktop tamer CLI only.' },
  { id: 'cliGeneral', title: 'General', parent: 'cli', blurb: 'Log level and web search for local chats.' },
  { id: 'cliActions', title: 'Local Actions', parent: 'cli', blurb: 'bash/read/edit blocks the CLI may run locally.' },
  { id: 'cliPrompts', title: 'Instructions', parent: 'cli', blurb: 'Instructions the CLI injects before your message.' },
  // Internals
  { id: 'expert', title: 'Expert', blurb: 'Vault paths, mock mode, raw templates, internals. Leave these alone.' },
  { id: 'expertVault', title: 'Vault', parent: 'expert', blurb: 'Encrypted token storage and its key material.' },
  { id: 'expertLogin', title: 'Login Binary', parent: 'expert', blurb: 'proton-auth Go binary path and spoofed client headers.' },
  { id: 'expertBrowser', title: 'Browser Extract', parent: 'expert', blurb: 'Chromium sidecar extraction for browser sign-in.' },
  { id: 'expertMock', title: 'Mock Mode', parent: 'expert', blurb: 'Canned Proton responses. Development only.' },
  { id: 'expertTemplates', title: 'Raw Templates', parent: 'expert', blurb: 'Handlebars templates and regex replace patterns.' },
  { id: 'expertDump', title: 'API Dump', parent: 'expert', blurb: 'One JSON line per Proton API call, no auth headers.' },
  { id: 'expertCompaction', title: 'Token Estimation', parent: 'expert', blurb: 'Compaction token estimate factor for OpenCode sessions.' },
  { id: 'expertExecutors', title: 'CLI Executors', parent: 'expert', blurb: 'Language-to-command map for CLI code blocks.' },
  { id: 'expertMisc', title: 'Miscellaneous', parent: 'expert', blurb: 'Anything that fits nowhere else. Usually safe to ignore.' },
];

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const LOG_TARGETS = ['stdout', 'file'];
const INJECT_INTO = ['first', 'last'];
const AUTH_METHODS = ['login', 'browser', 'rclone'];
const MOCK_SCENARIOS = [
  'success', 'error', 'timeout', 'rejected', 'toolCall',
  'misroutedToolCall', 'historyToolEcho', 'weeklyLimit', 'cycle',
];
const MODEL_TIERS = ['auto', 'lumo-lite', 'lumo-max'];
const REASONING = ['none', 'high'];

function sample(value: string, label = 'Example'): ConfigExample[] {
  return [{ label, value }];
}

const COPY: Record<string, FieldCopy> = {
  'server.customTools.recovery.bounceDanglingColon': {
    label: 'Bounce dangling-colon replies',
    hint: 'Bounce when Lumo announces an action and ends on a colon without a tool call.',
    more: `Lumo sometimes writes "Let me read the config:" and stops — the tool call never follows. With this on, tamer detects the dangling colon and retries once with a reminder to emit the JSON block. Turn off if you want such half-answers passed through unchanged.`,
  },
  'server.customTools.recovery.bounceNarration': {
    label: 'Bounce narrated tool calls',
    hint: 'Bounce “[Assistant tool call]: …” prose instead of a JSON code block.',
    more: `When custom tools are active, Lumo occasionally narrates the call in prose (“[Assistant tool call]: read the file”) instead of emitting the JSON code block the proxy executes. This detects that pattern and bounces the reply with a corrective instruction.`,
  },
  'server.customTools.recovery.bounceBlankReply': {
    label: 'Bounce thinking-only replies',
    hint: 'Bounce replies with no message text at all (thought loops).',
    more: `Lumo can burn an entire reply on internal reasoning and return zero message text, looping forever while “thinking”. With this on, tamer detects the empty content and retries with a nudge to answer visibly.`,
  },
  'server.customTools.recovery.danglingColonMaxLength': {
    label: 'Dangling-colon max total length',
    hint: 'Chars; longer replies are passed through unmodified. Default 2000.',
    more: `Safety valve for the dangling-colon detector: a long reply ending in a colon is usually a legitimate answer (a list, code), not a stalled tool announcement. Lowering this makes the bounce trigger more often; raising it risks bouncing real answers.`,
  },
  'server.customTools.recovery.danglingColonLastLineMaxLength': {
    label: 'Dangling-colon max last-line length',
    hint: 'Chars for the final line. Default 500.',
    more: `Same idea as the total-length cap, but for the last line of the reply. A very long final line before a colon suggests prose (e.g. pasted output), not an announcement about to emit a tool call.`,
  },
  'server.customTools.routing.nativeTools': {
    label: 'Native tool routing',
    hint: 'auto = hide native tools when custom tools are active. Leave on auto.',
    more: `auto hides Lumo's native tools (web search etc.) whenever a client sends custom tools — mixing both confuses Lumo into announcing instead of calling. always forces native tools on (pre-fix behavior, useful for debugging). never disables them entirely.`,
    choices: ['auto', 'always', 'never'],
  },
  'auth.method': {
    label: 'Sign-in method',
    hint: 'login = /auth. browser and rclone are fallbacks.',
    more: `login: Proton sign-in or password on /auth. That is the normal path.\nbrowser: extract a Chromium session (CDP sidecar). Not everyday login.\nrclone: paste an rclone Proton config. Last resort.`,
    choices: AUTH_METHODS,
    noDefault: true,
  },
  'auth.autoRefresh.enabled': {
    label: 'Refresh tokens automatically',
    hint: 'Refresh Proton tokens before they expire. Leave on.',
  },
  'auth.autoRefresh.intervalHours': {
    label: 'Refresh interval (hours)',
    hint: `Hours between refreshes (${AUTH.REFRESH_INTERVAL_HOURS_MIN}–${AUTH.REFRESH_INTERVAL_HOURS_MAX}). Default ${AUTH.DEFAULT_REFRESH_INTERVAL_HOURS}.`,
  },
  'auth.autoRefresh.onError': {
    label: 'Refresh on 401',
    hint: 'Refresh immediately when Proton returns 401.',
  },
  'auth.browser.launch': {
    label: 'Launch a browser window',
    hint: 'Playwright Chromium extract only. Everyday login is /auth in your own browser.',
    more: 'On a desktop with a display, leave this on. Inside Docker there is no Chrome in the tamer image — leave this off. After a sidecar login, tamer writes launch: false for you. Do not turn it back on in the container.',
  },
  'auth.browser.userDataDir': {
    label: 'Browser profile directory',
    hint: 'Persistent profile for that window (cookies only). Relative to LUMO_HOME.',
  },
  'auth.browser.cdpEndpoint': {
    label: 'Chrome DevTools endpoint',
    hint: 'Chrome DevTools URL when launch is off (Docker sidecar or already-running Chrome).',
    more: `Used only when launch is false. localhost is a Chrome on the same machine (desktop). Inside Docker/Portainer the sidecar is ${CDP.DOCKER} — not localhost. After extraction, stop and remove only ${APP.BROWSER_CONTAINER_NAME}; leave tamer on port ${PORTS.TAMER}.`,
    examples: [
      { label: 'Example 1 — desktop Chrome', value: CDP.DESKTOP },
      { label: 'Example 2 — Docker sidecar', value: CDP.DOCKER },
    ],
  },
  'auth.vault.path': {
    label: 'Vault file',
    hint: 'Encrypted token file (AES-256-GCM). Relative to LUMO_HOME.',
  },
  'auth.vault.keychain.service': {
    label: 'Keychain service',
    hint: 'OS keychain service name for the vault key.',
  },
  'auth.vault.keychain.account': {
    label: 'Keychain account',
    hint: 'OS keychain account name for the vault key.',
  },
  'auth.vault.keyFilePath': {
    label: 'Vault key file',
    hint: 'Vault key file when there is no OS keychain (Docker, headless).',
    more: '32-byte key file when there is no OS keychain. Docker should mount this from a secret. If the file is missing, the first /auth login creates it (mode 0600).',
    examples: [
      { label: 'Example 1 — Docker secret', value: '/run/secrets/lumo-vault-key' },
      { label: 'Example 2 — file on disk', value: '/data/vault-key' },
    ],
  },
  'auth.login.binaryPath': {
    label: 'proton-auth binary',
    hint: 'Path to the proton-auth Go binary used by password login.',
  },
  'auth.login.appVersion': {
    label: 'Login app version header',
    hint: 'App-version header sent with password login (Drive fallback / CAPTCHA dodge).',
  },
  'auth.login.userAgent': {
    label: 'Login User-Agent',
    hint: 'User-Agent sent with password login.',
  },
  'test.mock.enabled': {
    label: 'Mock Proton responses',
    hint: 'Skip Proton and return canned replies. Development only.',
  },
  'test.mock.scenario': {
    label: 'Mock scenario',
    hint: 'Which canned Proton outcome to replay.',
    choices: MOCK_SCENARIOS,
  },
  'log.level': {
    label: 'Log level',
    hint: 'How chatty logs are. debug is noisy; info is enough for normal use.',
    more: 'trace/debug: protocol and tool-call noise. info: start, login, config saves. warn/error: failures only. messageContent is separate and stays off unless you want chat text in the log.',
    choices: LOG_LEVELS,
  },
  'log.target': {
    label: 'Log destination',
    hint: 'Write logs to the terminal or to a file.',
    choices: LOG_TARGETS,
  },
  'log.filePath': {
    label: 'Log file',
    hint: 'Log file when destination is file. Relative to LUMO_HOME.',
  },
  'log.messageContent': {
    label: 'Log chat text',
    hint: 'If on, user/assistant text is written to the log. Off keeps chats private.',
    more: 'Off (default) redacts user/assistant text. Turn on only on a machine you control, for debugging a specific client.',
  },
  'log.dumpApiPath': {
    label: 'Dump Proton API calls',
    hint: 'If set, append one JSON line per Proton API call (no auth headers). Empty = off.',
    more: 'Relative to LUMO_HOME, or empty. Each Proton call becomes one JSON line without cookies or auth headers. Useful when a 400/422 needs the raw body.',
    examples: sample('proton-api.jsonl'),
  },
  'conversations.databasePath': {
    label: 'Conversation database path',
    hint: 'IndexedDB files when the in-memory store is off. Relative to LUMO_HOME.',
  },
  'conversations.deriveIdFromUser': {
    label: 'Group chats by user field',
    hint: 'Home Assistant has no conversation id. Turn this on so HA chats stay grouped.',
    more: 'Home Assistant Assist sends its internal conversation_id as the OpenAI "user" field and omits conversation_id. On: chats with the same user stay one thread. Off: every HA turn looks new. Ignored when the request has no user.',
  },
  'conversations.useFallbackStore': {
    label: 'In-memory conversation store',
    hint: 'In-memory store (default). Off uses Proton IndexedDB. Leave on unless you know.',
    more: 'On: simple in-memory store (the default, matches what most clients need). Off: Proton Redux + IndexedDB under databasePath. Turn off only if you are debugging the upstream store.',
  },
  'conversations.enableSync': {
    label: 'Sync chats to Proton',
    hint: 'Push threads to Proton so they show up on lumo.proton.me. Only available with Lumo-scoped login.',
    more: 'Only works when auth.method is browser or login. rclone has no Lumo scope. Without scope, chat still works; Proton will not store the thread.',
  },
  'conversations.projectName': {
    label: 'Proton project name',
    hint: 'Proton project/space name for synced chats.',
    examples: sample(APP.NAME),
  },
  'commands.enabled': {
    label: 'Slash commands',
    hint: 'Allow /save, /private, /logout and the wakeword in chats.',
    more: 'When off, /save /help /logout /private are sent to Lumo as normal text. Wakeword is ignored too.',
  },
  'updates.enabled': {
    label: 'Check for updates',
    hint: 'Look up GitHub Releases on a timer and show the Update button.',
    more: 'Save applies channel/repo/interval immediately (no Restart). Checking is HTTP only. Applying uses the Docker socket on this container. LUMO_TAMER_IMAGE in .env must match the channel after a switch.',
  },
  'updates.channel': {
    label: 'Release channel',
    hint: `stable (default) = ${GITHUB.STABLE_BRANCH} / GitHub latest + GHCR :${DOCKER_UPDATE.STABLE_TAG}. dev = prereleases + GHCR :${DOCKER_UPDATE.DEV_TAG}.`,
    more: `Each channel is its own track. stable/main = latest GitHub release (not -dev). dev = newest prerelease. Switching to an older main build is a downgrade — config and the vault may not load. After a switch, set LUMO_TAMER_IMAGE in .env to :${DOCKER_UPDATE.STABLE_TAG} or :${DOCKER_UPDATE.DEV_TAG} so compose does not roll back.`,
    choices: ['stable', 'dev'],
    examples: [
      { label: 'Example 1 — main / stable', value: 'stable' },
      { label: 'Example 2 — moving dev', value: 'dev' },
    ],
  },
  'updates.repository': {
    label: 'GitHub repository',
    hint: 'owner/repo or a github.com URL. Forks work.',
    examples: [
      { label: 'Example 1 — this project', value: APP.GITHUB_REPO },
      { label: 'Example 2 — URL', value: APP_GITHUB_URL },
    ],
  },
  'updates.checkIntervalHours': {
    label: 'Check interval (hours)',
    hint: `Hours between GitHub checks (${UPDATES.CHECK_INTERVAL_HOURS_MIN}–${UPDATES.CHECK_INTERVAL_HOURS_MAX}). Default 6.`,
  },
  'updates.autoApply': {
    label: 'Apply updates automatically',
    hint: 'When a check finds a newer image, pull GHCR and recreate this container.',
    more: `Off by default. Needs docker.sock on this container and a matching GHCR tag. A one-shot helper from the new image recreates ${APP.CONTAINER_NAME}, then exits.`,
  },
  'updates.dockerSocket': {
    label: 'Docker socket',
    hint: 'Unix socket bind-mounted from the host so this process can pull and recreate itself.',
    more: 'No extra updater container. The socket is root-equivalent on the host — only mount it on a private box. Default /var/run/docker.sock matches docker-compose.yml.',
    examples: [
      { label: 'Example', value: '/var/run/docker.sock' },
    ],
  },
  'commands.wakeword': {
    label: 'Wakeword',
    hint: 'Spoken prefix instead of a slash, so voice clients do not steal /help.',
    more: 'For Assist and other clients that already own slash commands. "tamer help" runs /help. Case-insensitive. Leave empty to disable the spoken form.',
    examples: sample('tamer'),
  },
  'server.port': {
    label: 'Listen port',
    hint: 'TCP port this process listens on. Changing this does not update docker-compose.yml.',
    more: 'The published Docker port is set in compose, not here. If you change this, also change the host mapping or the process will listen on a port nothing forwards.',
  },
  'server.apiKey': {
    label: 'API key',
    hint: 'Bearer token your clients send. Never shown here; leave blank to keep the current key.',
    more: 'Clients send Authorization: Bearer <key>. This page never displays the current value. Saving with the field empty keeps the existing key. To read it, open config.yaml on the host.',
    kind: 'secret',
  },
  'server.apiModelName': {
    label: 'Default model name',
    hint: 'Name echoed on /v1/models and in replies when a request omits model.',
    more: 'Cosmetic. It does not pick the Proton tier. The tier comes from the request model, extraModels, or defaultModelTier.',
  },
  'server.defaultModelTier': {
    label: 'Default model tier',
    hint: 'Real Lumo tier when the client omits model: auto (Proton picks), lumo-lite, or lumo-max.',
    more: 'Used only when the request has no model (or an empty one). auto is the Proton website behaviour. Must be auto, or a name that is also in allowedModels.',
    choices: MODEL_TIERS,
  },
  'server.allowedModels': {
    label: 'Allowed model names',
    hint: 'Built-in names this proxy accepts in the model field. Unknown names return 400.',
    more: 'Comma-separated, not JSON. These are Proton ids only. Your own aliases belong in Extra model names, not here. Removing lumo-max hides it from /v1/models and rejects it with 400.',
    examples: sample('lumo, lumo-lite, lumo-max'),
  },
  'server.extraModels': {
    label: 'Extra model names',
    hint: 'Your own names on /v1/models. Each maps an id to a real Lumo tier and optional thinking.',
    more: 'JSON array of objects, not YAML and not comma-separated names. Paste over [] — several aliases go in the same array, comma-separated objects. id is what clients send as model. model is the real Proton tier: lumo, lumo-lite, lumo-max, or auto. reasoning is optional (none or high) and applies only when the request omits reasoning_effort; an explicit reasoning_effort still wins. The example below is all four lite/max × none/high combos; delete the rows you do not want. lumo-max and thinking depend on the Proton plan.',
    kind: 'json',
    examples: [{
      label: 'Example — four aliases in one array (delete what you do not need)',
      value: JSON.stringify([
        { id: 'lumo-lite-fast', model: 'lumo-lite', reasoning: 'none' },
        { id: 'lumo-lite-thinking', model: 'lumo-lite', reasoning: 'high' },
        { id: 'lumo-max-fast', model: 'lumo-max', reasoning: 'none' },
        { id: 'lumo-max-thinking', model: 'lumo-max', reasoning: 'high' },
      ], null, 2),
    }],
  },
  'server.reasoning.default': {
    label: 'Thinking when omitted',
    hint: 'Thinking when the client omits reasoning_effort. none = compact/fast; high = think. lumo-max still thinks.',
    more: 'none = compact / most Assist use). high = always think. lumo-max thinks even when this is none, unless the request sends reasoning_effort "none". OpenCode/Assist that should always think: set high.',
    choices: REASONING,
  },
  'server.reasoning.autoVariants': {
    label: 'Auto thinking variants',
    hint: 'Advertise a `-thinking` variant of every allowed model on /v1/models.',
    more: 'On: /v1/models additionally lists lumo-thinking, lumo-lite-thinking, lumo-max-thinking (one per allowedModels entry). Each variant pins thinking ON — it thinks even when a client explicitly sends reasoning_effort "none" (e.g. OpenCode). Ids you define yourself in extraModels take precedence and are not duplicated. Off: only your configured models are advertised.',
  },
  'server.reasoning.surfaceThinking': {
    label: 'Forward thinking tokens',
    hint: 'Forward Lumo thinking tokens to the client (Deepseek-style reasoning_content).',
    more: 'On: streaming delta.reasoning_content and non-stream message.reasoning_content (Deepseek convention). Responses API emits reasoning_text parts. Off: the client never sees the thinking tokens.',
  },
  'server.bodyLimit': {
    label: 'Max request body',
    hint: 'Max request body. Raise for OpenCode / large contexts.',
    more: 'One size string, parsed by the bytes library. 1mb is about 60k tokens of ASCII. 360kb is roughly Lumo\'s 22.5K warning level. Use 50mb only if a client sends huge tool/context payloads.',
    examples: sample('1mb'),
  },
  'server.metrics.enabled': {
    label: 'Prometheus /metrics',
    hint: 'Expose Prometheus metrics at /metrics. Off by default.',
  },
  'server.metrics.collectDefaultMetrics': {
    label: 'Include Node runtime metrics',
    hint: 'Include Node runtime gauges (memory, CPU, event loop).',
  },
  'server.metrics.prefix': {
    label: 'Metrics name prefix',
    hint: 'Prefix for every metric name.',
    examples: sample('lumo_'),
  },
  'server.enableWebSearch': {
    label: 'Native web search',
    hint: 'Lumo native web_search, weather, stock, crypto. Off so Lumo does not search unless you turn it on. On matches the Lumo website.',
    more: 'On: Lumo may call native web_search / weather / stock / crypto like the website. That mixes with custom tools and is a common source of misrouted calls. Off unless you want those extras.',
  },
  'server.customTools.enabled': {
    label: 'Honor client tools',
    hint: 'Honor tools from HA, OpenCode, etc. Off ignores client tools.',
    more: 'On: tools from the client are forwarded (OpenCode, HA, etc.) and Lumo can trigger those actions. Off: client tools are stripped. Native Proton tools are separate toggles above.',
  },
  'server.promptTokenEstimation': {
    label: 'Token estimation (Beta)',
    hint: 'Estimates input tokens for OpenCode compaction. Proton does not report them. Experimental — may be inaccurate.',
    more: `auto is ${TOKEN_ESTIMATE.NAIVE_BYTES_PER_TOKEN} bytes/token scaled by ${TOKEN_ESTIMATE.AUTO_CALIBRATION} (the Lumo baseline). Factor 1.0 is that value. off: prompt_tokens=0. A number is a raw chars-per-token divisor without ${TOKEN_ESTIMATE.AUTO_CALIBRATION}.`,
    choices: ['auto', 'off'],
  },
  'server.promptTokenEstimationFactor': {
    label: 'Token estimation factor (Beta)',
    hint: 'Multiplier on the auto estimate. 1.0 = unchanged, below 1 counts fewer tokens, above 1 counts more.',
    more: 'Only used when Token estimation is auto. 0.9 = 90% of the estimate (compaction later). 1.1 = 110% (compaction sooner).',
  },
  'server.customTools.prefix': {
    label: 'Custom tool prefix',
    hint: 'Prefix added to client tool names so they are not mixed with native Proton tools.',
    more: 'Applied to tool names sent to Lumo, stripped again before the client sees a call. Stops native/custom name clashes. Empty string disables prefixing (easier collisions).',
    examples: sample('user:'),
  },
  'server.instructions.template': {
    label: 'Instruction template (Handlebars)',
    hint: 'Handlebars glue that assembles the other instruction blocks. Edit forTools / fallback instead.',
    more: 'Handlebars: {{var}}, {{#if var}}…{{/if}}. Variables: tools, clientInstructions, forTools, fallback, prefix. Wrong braces here break every request. Change the blocks below, not this glue.',
  },
  'server.instructions.replacePatterns': {
    label: 'Client-prompt replacements',
    hint: 'Regex cleanup of client system prompts. The default just turns "tool" into "custom tool". Leave it.',
    more: 'JSON array of { "pattern": "regex", "replacement": "text" }. Case-insensitive. Omit replacement to strip the match. The shipped pattern rewrites "tool" to "custom tool" so Lumo does not mix native and client tools.',
    examples: sample(JSON.stringify([{ pattern: '\\bOpenAI\\b', replacement: 'Lumo' }], null, 2)),
  },
  'server.instructions.fallback': {
    label: 'Fallback when there is no system prompt',
    hint: 'Used when the client sends no system prompt (HA voice). Keep this spoken-friendly.',
    more: 'HA Assist reads the reply aloud, so this should stay plain sentences: no tables, lists, or markdown.',
  },
  'server.instructions.forTools': {
    label: 'Tool-call protocol (first turn)',
    hint: 'Tool-call protocol sent on the first user turn. Put HA nesting examples here if you need them.',
    more: 'This is the contract for JSON-in-a-fence custom tools. Keep the MUST-fence wording unless you know the client. HA nested tools belong in your override of this block, not in the template.',
  },
  'server.instructions.forToolsCompact': {
    label: 'Tool-call protocol (follow-ups)',
    hint: 'Shorter protocol on follow-up turns. Copy any HA nesting you added to the first-turn block.',
    more: 'Follow-up turns. Tool schemas are still sent in full; this is only the reminder. If you customized forTools, copy the same nesting rules here.',
  },
  'server.instructions.injectInto': {
    label: 'Where to inject instructions',
    hint: 'Where to inject instructions when there are no client tools. With tools the proxy always uses last.',
    more: 'first: cheaper, may be forgotten in long chats. last: attached to every turn (website behaviour, more tokens). Ignored when the request includes tools[] — those always inject last so the protocol cannot fall out of the window.',
    choices: INJECT_INTO,
  },
  'server.instructions.forJsonFormat': {
    label: 'JSON response format',
    hint: 'Added when the client asks for json_schema / json_object.',
    more: '{{schema}} is replaced with the JSON Schema or the words "a JSON object".',
  },
  'server.instructions.forToolRequired': {
    label: 'When a tool is required',
    hint: 'Added when tool_choice is required.',
  },
  'server.instructions.forToolNamed': {
    label: 'When a named tool is required',
    hint: 'Added when tool_choice names one function. {{name}} is filled in at runtime.',
    more: '{{name}} is the function the client demanded. Lumo must call that custom tool this turn.',
  },
  'server.instructions.forToolBounce': {
    label: 'Bounce misrouted native calls',
    hint: 'Sent when Lumo misroutes a custom tool through its native pipeline.',
    more: 'The misrouted JSON is appended at runtime after this text. Keep the "like this:" shape so Lumo retries as a fence, not as another native call.',
  },
  'server.instructions.forAnnounceBounce': {
    label: 'Bounce announce-without-tool',
    hint: 'Sent once when the model announces a tool action but emits no tool-call JSON.',
    more: 'One bounce per turn. Triggers on a short reply that ends with a dangling colon and has no tool-call JSON.',
  },
  'cli.log.target': {
    label: 'CLI log destination',
    hint: 'Where the desktop CLI writes logs.',
    choices: LOG_TARGETS,
  },
  'cli.log.filePath': {
    label: 'CLI log file',
    hint: 'CLI log file when destination is file. Relative to LUMO_HOME.',
  },
  'cli.enableWebSearch': {
    label: 'CLI native web search',
    hint: 'Native web search in the CLI. Same caveats as the server toggle.',
  },
  'cli.localActions.enabled': {
    label: 'Run local code blocks',
    hint: 'Let the CLI run bash/read/edit/create blocks on this machine. Confirmations still apply.',
    more: 'Desktop tamer CLI only, not the API server. When on, fenced bash/python/read/edit/create in the model output can run on this machine. You still get a confirm prompt except for ```read if fileReads is on.',
  },
  'cli.localActions.fileReads.enabled': {
    label: 'Allow ```read without confirm',
    hint: 'Allow ```read blocks without a confirmation prompt.',
    more: '```read returns file contents without asking. Shell tools (cat) can still read if local actions are on and you confirm the command.',
  },
  'cli.localActions.fileReads.maxFileSize': {
    label: 'Max ```read size',
    hint: 'Reject ```read above this size.',
    examples: sample('360kb'),
  },
  'cli.instructions.forLocalActions': {
    label: 'CLI local-action protocol',
    hint: 'Told to the CLI model when local bash/read/edit blocks are enabled.',
    more: 'Explains ```read / ```edit / ```create / ```bash to the CLI model. The {{executors}} list is filled in from the executor map below.',
  },
  'cli.instructions.injectInto': {
    label: 'CLI: where to inject instructions',
    hint: 'Where the CLI injects its instructions into the user turn.',
  },
  'cli.instructions.forToolBounce': {
    label: 'CLI: bounce native calls to code blocks',
    hint: 'Told to the CLI model when it used a native tool instead of a code block.',
  },
};

const SUFFIX_ALIAS: Array<[string, string]> = [
  ['.injectInto', 'server.instructions.injectInto'],
  ['.forToolBounce', 'server.instructions.forToolBounce'],
  ['.template', 'server.instructions.template'],
];

const PREFIX_COPY: Array<[string, FieldCopy]> = [
  ['cli.localActions.executors.', {
    hint: 'Command used for that language tag. Space-separated; the code is appended as the last argument.',
    more: 'Space-separated binary and flags only, not a shell line. The model output is passed as one extra argument. Restrict this if you do not want Python/Node available.',
  }],
  ['auth.vault.', {
    hint: 'Where the encrypted token vault and its key live. Docker uses the secret file.',
    more: 'The vault holds refresh tokens. The key lives in the OS keychain on a desktop, or in keyFilePath on Docker. Losing the key makes the vault unreadable; you will need to log in again.',
  }],
  ['auth.browser.', {
    hint: 'Desktop window vs already-running Chrome (CDP). Prefer /auth on Docker.',
    more: 'Prefer /auth (login) on Docker/Portainer. Browser mode is for a machine with a display, or for a sidecar whose CDP URL you set below.',
  }],
  ['auth.login.', {
    hint: 'Go SRP binary and Drive-fallback headers if Lumo-scope hits CAPTCHA.',
    more: 'Used only for method login. App version / User-Agent mimic the Drive client so Proton is less likely to throw a CAPTCHA. Leave the shipped values unless Proton starts blocking them.',
  }],
  ['server.metrics.', {
    hint: 'Prometheus /metrics. Off by default.',
    more: '/metrics is unauthenticated like this page. Do not expose it on the public internet.',
  }],
  ['test.', {
    hint: 'Mock Proton responses. Only for development.',
    more: 'When mock is on, nothing hits Proton. scenario picks the canned stream (success, error, toolCall, …). Turn it off for a real Lumo session.',
  }],
];

/** Child path → parent + values that make the child visible. Serializable for the browser. */
export interface FieldDependency {
  parent: string;
  showValues: unknown[];
}

export const FIELD_DEPENDENCIES: Record<string, FieldDependency> = {
  'auth.browser.launch': { parent: 'auth.method', showValues: ['browser'] },
  'auth.browser.userDataDir': { parent: 'auth.method', showValues: ['browser'] },
  'auth.browser.cdpEndpoint': { parent: 'auth.method', showValues: ['browser'] },
  'auth.login.binaryPath': { parent: 'auth.method', showValues: ['login'] },
  'auth.login.appVersion': { parent: 'auth.method', showValues: ['login'] },
  'auth.login.userAgent': { parent: 'auth.method', showValues: ['login'] },
  'conversations.enableSync': { parent: 'auth.method', showValues: ['browser', 'login'] },
  'conversations.projectName': { parent: 'conversations.enableSync', showValues: [true] },
  'server.customTools.prefix': { parent: 'server.customTools.enabled', showValues: [true] },
  'server.metrics.collectDefaultMetrics': { parent: 'server.metrics.enabled', showValues: [true] },
  'server.metrics.prefix': { parent: 'server.metrics.enabled', showValues: [true] },
  'server.promptTokenEstimationFactor': { parent: 'server.promptTokenEstimation', showValues: ['auto'] },
  'updates.channel': { parent: 'updates.enabled', showValues: [true] },
  'updates.repository': { parent: 'updates.enabled', showValues: [true] },
  'updates.checkIntervalHours': { parent: 'updates.enabled', showValues: [true] },
  'updates.autoApply': { parent: 'updates.enabled', showValues: [true] },
  'updates.dockerSocket': { parent: 'updates.enabled', showValues: [true] },
};

const DEFAULT_HINT = 'See config.defaults.yaml and docs/config.md.';

export const SECRET_PATHS = new Set(
  Object.entries(COPY).filter(([, copy]) => copy.kind === 'secret').map(([path]) => path),
);

function pickCopy(base: FieldCopy, overlay: FieldCopy): FieldCopy {
  return {
    label: overlay.label ?? base.label,
    hint: overlay.hint ?? base.hint,
    more: overlay.more ?? base.more,
    examples: overlay.examples ?? base.examples,
    choices: overlay.choices ?? base.choices,
    kind: overlay.kind ?? base.kind,
    noDefault: overlay.noDefault ?? base.noDefault,
  };
}

export function fieldCopy(path: string): FieldCopy {
  let out: FieldCopy = {};
  for (const [prefix, copy] of PREFIX_COPY) {
    if (path.startsWith(prefix)) out = pickCopy(out, copy);
  }
  for (const [suffix, alias] of SUFFIX_ALIAS) {
    if (path.endsWith(suffix) && COPY[alias]) out = pickCopy(out, COPY[alias]);
  }
  if (COPY[path]) out = pickCopy(out, COPY[path]);

  if (!out.choices) {
    if (path.endsWith('.injectInto')) out.choices = INJECT_INTO;
    else if (path === 'log.level' || path.endsWith('.log.level')) out.choices = LOG_LEVELS;
    else if (path === 'log.target' || path.endsWith('.log.target')) out.choices = LOG_TARGETS;
  }

  if (path.startsWith('cli.localActions.executors.')) {
    const lang = path.split('.').pop() ?? 'bash';
    if (!out.label) out.label = `CLI executor (${lang})`;
    if (!out.examples?.length) {
      out.examples = sample(lang === 'python' ? 'python -c' : `${lang} -c`);
    }
  }

  if (!out.hint) out.hint = DEFAULT_HINT;
  return out;
}

export function humanLabel(path: string): string {
  const leaf = path.split('.').pop() ?? path;
  return leaf
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

export function labelFor(path: string): string {
  return fieldCopy(path).label ?? humanLabel(path);
}

export function hintFor(path: string): string {
  return fieldCopy(path).hint ?? DEFAULT_HINT;
}

export function moreFor(path: string): string | undefined {
  return fieldCopy(path).more;
}

export function exampleFor(path: string): ConfigExample[] | undefined {
  const examples = fieldCopy(path).examples;
  return examples?.length ? examples : undefined;
}

export function choicesFor(path: string): string[] | undefined {
  return fieldCopy(path).choices;
}

export function fieldCategory(path: string): string {
  // Sub-categories (specific paths before their parents' broad prefixes).
  // Rule: parents with sub-categories keep no fields of their own.
  if (path.startsWith('server.customTools.recovery.')) return 'recovery';
  if (path.startsWith('server.customTools.routing.')) return 'routing';
  if (path === 'server.customTools.enabled' || path === 'server.customTools.prefix') return 'toolsGeneral';
  if (path === 'server.enableWebSearch') return 'toolsGeneral';
  if (path.startsWith('server.metrics.')) return 'metrics';
  if (path.startsWith('server.reasoning.')) return 'reasoning';
  if (
    path === 'server.apiModelName'
    || path === 'server.defaultModelTier'
    || path === 'server.allowedModels'
    || path === 'server.extraModels'
  ) {
    return 'modelTiers';
  }
  if (path === 'conversations.enableSync' || path === 'conversations.projectName') return 'sync';
  if (path.startsWith('conversations.')) return 'chatStorage';
  if (path.startsWith('auth.autoRefresh.')) return 'refresh';

  // Expert internals — things a normal user should never need to touch.
  if (path.startsWith('auth.vault.')) return 'expertVault';
  if (path.startsWith('auth.login.')) return 'expertLogin';
  if (path.startsWith('auth.browser.')) return 'expertBrowser';
  if (path.startsWith('test.')) return 'expertMock';
  if (path.endsWith('.template') || path.includes('replacePatterns')) return 'expertTemplates';
  if (path === 'log.dumpApiPath') return 'expertDump';
  if (path.startsWith('server.promptTokenEstimation')) return 'expertCompaction';

  if (path.startsWith('cli.instructions.')) return 'cliPrompts';
  if (path.startsWith('cli.localActions.executors.')) return 'expertExecutors';
  if (path.startsWith('cli.localActions.')) return 'cliActions';
  if (path.startsWith('cli.')) return 'cliGeneral';

  if (path.includes('.instructions.')) return 'promptsGeneral';
  if (path.startsWith('auth.')) return 'authGeneral';
  if (path.startsWith('log.') || path.includes('.log.')) return 'logsGeneral';
  if (path.startsWith('commands.')) return 'commandsGeneral';
  if (path === 'updates.autoApply' || path === 'updates.dockerSocket') return 'docker';
  if (path.startsWith('updates.')) return 'updatesGeneral';
  if (path.startsWith('server.')) return 'serverGeneral';
  return 'expertMisc';
}
