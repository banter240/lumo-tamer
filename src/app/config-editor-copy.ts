/**
 * Human copy for /config: one entry per YAML path.
 * Prefix/suffix rules fill in CLI variants and executor rows.
 */

export interface ConfigExample {
  label: string;
  value: string;
}

export interface ConfigCategory {
  id: string;
  title: string;
  blurb: string;
}

export type FieldKindOverride = 'secret' | 'json';

export interface FieldCopy {
  label?: string;
  hint?: string;
  more?: string;
  examples?: ConfigExample[];
  choices?: string[];
  kind?: FieldKindOverride;
}

/** Sidebar groups on /config. `prompts` is titled Advanced (the text Lumo sees). */
export const CONFIG_CATEGORIES: ConfigCategory[] = [
  { id: 'api', title: 'Server', blurb: 'Listen port, API key, and request size. Changing the port does not update Docker.' },
  { id: 'models', title: 'Models', blurb: 'Which Lumo tiers clients can pick, and whether thinking is on by default.' },
  { id: 'tools', title: 'Tools', blurb: 'Native Proton tools and tools[] from Home Assistant, OpenCode, and others.' },
  { id: 'chats', title: 'Conversations', blurb: 'Proton sync, Home Assistant grouping, and where threads are stored.' },
  { id: 'logging', title: 'Logging', blurb: 'How noisy logs are and whether chat text is written to disk.' },
  { id: 'auth', title: 'Sign-in', blurb: 'How this server fetches Proton tokens. Prefer login via /auth on Docker.' },
  { id: 'commands', title: 'Commands', blurb: 'Slash commands in chat, plus an optional spoken wakeword.' },
  { id: 'prompts', title: 'Advanced', blurb: 'Prompt text Lumo actually sees. Tool-call protocol and fallback voice copy.' },
  { id: 'cli', title: 'CLI', blurb: 'Desktop tamer CLI only. Local bash/read/edit blocks on this machine.' },
  { id: 'expert', title: 'Expert', blurb: 'Vault paths, mock mode, Handlebars glue, metrics. Leave these unless you know why.' },
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
  'auth.method': {
    label: 'Sign-in method',
    hint: 'How this server fetches Proton tokens. On Docker/Portainer use login, then open /auth.',
    more: 'login: email and password on /auth (SRP). Chat works; sync is on only if Proton granted Lumo scope.\nbrowser: a real Chrome window (desktop) or CDP. Needed when Proton returns abuse/CAPTCHA on password login.\nrclone: paste an rclone Proton config. Last resort; usually no Lumo scope, so no sync.',
    choices: AUTH_METHODS,
  },
  'auth.autoRefresh.enabled': {
    label: 'Refresh tokens automatically',
    hint: 'Refresh Proton tokens before they expire. Leave on.',
  },
  'auth.autoRefresh.intervalHours': {
    label: 'Refresh interval (hours)',
    hint: 'Hours between refreshes (1–24). Default 20.',
  },
  'auth.autoRefresh.onError': {
    label: 'Refresh on 401',
    hint: 'Refresh immediately when Proton returns 401.',
  },
  'auth.browser.launch': {
    label: 'Launch a browser window',
    hint: 'Open a local Chrome/Edge window, wait for login, extract tokens, close it.',
    more: 'On a desktop with a display, leave this on. Inside Docker there is no window, so set launch off and point cdpEndpoint at a browser sidecar you started yourself.',
  },
  'auth.browser.userDataDir': {
    label: 'Browser profile directory',
    hint: 'Persistent profile for that window (cookies only). Relative to LUMO_HOME.',
  },
  'auth.browser.cdpEndpoint': {
    label: 'Chrome DevTools endpoint',
    hint: 'Chrome DevTools URL when launch is off (Docker sidecar or already-running Chrome).',
    more: 'Used only when launch is false. localhost is a Chrome you started on the same machine. The compose sidecar is reachable as http://browser:9222 from the tamer container.',
    examples: [
      { label: 'Example 1 — desktop Chrome', value: 'http://localhost:9222' },
      { label: 'Example 2 — Docker sidecar', value: 'http://browser:9222' },
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
    hint: 'Push threads to Proton so they show up on lumo.proton.me. Needs a Lumo-scoped login.',
    more: 'Requires a session with Lumo scope (browser cookies from lumo.proton.me, or /auth login that did not fall back to Drive). Without scope, chat still works; Proton will not store the thread.',
  },
  'conversations.projectName': {
    label: 'Proton project name',
    hint: 'Proton project/space name for synced chats.',
    examples: sample('lumo-tamer'),
  },
  'commands.enabled': {
    label: 'Slash commands',
    hint: 'Allow /save, /private, /logout and the wakeword in chats.',
    more: 'When off, /save /help /logout /private are sent to Lumo as normal text. Wakeword is ignored too.',
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
    more: 'none = compact (ZeroTricks / most Assist use). high = always think. lumo-max thinks even when this is none, unless the request sends reasoning_effort "none". OpenCode/Assist that should always think: set high.',
    choices: REASONING,
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
  'server.enableImageTools': {
    label: 'Native image tools',
    hint: 'Lumo native generate/edit/describe image. Off: big data URLs and easy to trigger by accident.',
    more: 'On: generate/edit/describe image. Replies can be multi-megabyte data URLs, and Lumo may draw when you asked it to flip a light. Keep off for HA.',
  },
  'server.images.maxInputBytes': {
    label: 'Max inbound image size',
    hint: 'Max size of an inbound image_url / input_image.',
    examples: sample('4mb'),
  },
  'server.customTools.enabled': {
    label: 'Honor client tools[]',
    hint: 'Honor tools[] from HA, OpenCode, etc. Off ignores client tools.',
    more: 'On: tools[] from the client are forwarded (OpenCode, HA, etc.) and Lumo can trigger those actions. Off: client tools are stripped. Native Proton tools are separate toggles above.',
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
  'cli.enableImageTools': {
    label: 'CLI native image tools',
    hint: 'Native image tools in the CLI.',
  },
  'cli.images.maxInputBytes': {
    label: 'CLI max inbound image size',
    hint: 'Max inbound image size for the CLI.',
    examples: sample('4mb'),
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
  if (
    path.startsWith('auth.vault.')
    || path.startsWith('auth.login.')
    || path.startsWith('auth.browser.')
    || path.startsWith('test.')
    || path.startsWith('server.metrics.')
    || path.endsWith('.template')
    || path.includes('replacePatterns')
    || path === 'log.dumpApiPath'
  ) {
    return 'expert';
  }
  if (path.startsWith('cli.instructions.')) return 'cli';
  if (path.includes('.instructions.')) return 'prompts';
  if (path.startsWith('cli.')) return 'cli';
  if (path.startsWith('auth.')) return 'auth';
  if (path.startsWith('log.') || path.includes('.log.')) return 'logging';
  if (path.startsWith('conversations.')) return 'chats';
  if (path.startsWith('commands.')) return 'commands';
  if (
    path === 'server.enableWebSearch'
    || path === 'server.enableImageTools'
    || path.startsWith('server.images.')
    || path.startsWith('server.customTools.')
  ) {
    return 'tools';
  }
  if (
    path === 'server.apiModelName'
    || path === 'server.defaultModelTier'
    || path === 'server.allowedModels'
    || path === 'server.extraModels'
    || path.startsWith('server.reasoning.')
  ) {
    return 'models';
  }
  if (path.startsWith('server.')) return 'api';
  return 'expert';
}
