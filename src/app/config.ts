import { z } from 'zod';
import merge from 'lodash/merge.js';
import mergeWith from 'lodash/mergeWith.js';

/**
 * Merge config layers, but REPLACE arrays wholesale instead of merging them by
 * index. Index-wise array merge means a user override like
 * `allowedModels: ["lumo-max"]` would leave the other defaults in place; config
 * arrays should fully replace the default.
 */
function mergeConfigLayers(...sources: unknown[]): Record<string, unknown> {
  return mergeWith({}, ...sources, (_objValue: unknown, srcValue: unknown) =>
    Array.isArray(srcValue) ? srcValue : undefined,
  );
}
import bytes from 'bytes';
import { fatalExit, loadConfigYaml, loadDefaultsYaml } from './config-file.js';
import { isDefaultTierAllowed } from '../lumo-client/model-tier.js';
import { AUTH, UPDATES } from './const.js';

// Load defaults from YAML (single source of truth)
const configDefaults = loadDefaultsYaml();

// Config loading
export type ConfigMode = 'server' | 'cli';

// Shared keys that can be overridden per mode
const SHARED_KEYS = ['log', 'conversations', 'commands'] as const;

// ============================================
// Schemas (validation only, no defaults)
// ============================================

const logConfigSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
  target: z.enum(['stdout', 'file']),
  filePath: z.string(),
  messageContent: z.boolean(),
  dumpApiPath: z.string(),
});


const conversationsConfigSchema = z.object({
  deriveIdFromUser: z.boolean(),
  databasePath: z.string(),
  useFallbackStore: z.boolean(),
  enableSync: z.boolean(),
  projectName: z.string().min(1),
});

// Replace pattern entry schema
const replacePatternSchema = z.object({
  pattern: z.string(),
  replacement: z.string().optional(),
});

// Server-specific custom tools config
const customToolsConfigSchema = z.object({
  enabled: z.boolean(),
  prefix: z.string(),
});

// Metrics config
const metricsConfigSchema = z.object({
  enabled: z.boolean(),
  collectDefaultMetrics: z.boolean(),
  prefix: z.string(),
});

// Prompt token estimation: Proton doesn't report input tokens; we estimate
// them so clients like OpenCode can make compaction decisions.
const promptTokenEstimationSchema = z.union([
  z.literal('auto'),
  z.literal('off'),
  z.number().positive(),
]);
const promptTokenEstimationFactorSchema = z.number().positive().max(10);

// Validates size strings using the bytes library (same parser Express uses)
const byteSizeSchema = z.union([
  z.string().refine((val) => bytes.parse(val) !== null, 'Invalid size format (e.g., "360kb", "1mb")'),
  z.number().positive(),
]);

// Injection location enum
const injectIntoSchema = z.enum(['first', 'last']);

// Instructions schemas
const cliInstructionsConfigSchema = z.object({
  injectInto: injectIntoSchema,
  template: z.string(),
  forLocalActions: z.string(),
  forToolBounce: z.string(),
});
const serverInstructionsConfigSchema = z.object({
  injectInto: injectIntoSchema,
  template: z.string(),
  forTools: z.string(),
  fallback: z.string(),
  forToolBounce: z.string(),
  forJsonFormat: z.string(),
  forToolRequired: z.string(),
  forToolNamed: z.string(),
  forToolsCompact: z.string(),
  replacePatterns: z.array(replacePatternSchema),
});

// CLI local actions config
const localActionsConfigSchema = z.object({
  enabled: z.boolean(),
  fileReads: z.object({
    enabled: z.boolean(),
    maxFileSize: byteSizeSchema,
  }),
  executors: z.record(z.string(), z.array(z.string())),
});

export const authMethodSchema = z.enum(['login', 'browser', 'rclone']);

const authConfigSchema = z.object({
  method: authMethodSchema,
  vault: z.object({
    path: z.string(),
    keychain: z.object({
      service: z.string(),
      account: z.string(),
    }),
    keyFilePath: z.string(),
  }),
  autoRefresh: z.object({
    enabled: z.boolean(),
    intervalHours: z.number().min(AUTH.REFRESH_INTERVAL_HOURS_MIN).max(AUTH.REFRESH_INTERVAL_HOURS_MAX),
    onError: z.boolean(),
  }),
  browser: z.object({
    launch: z.boolean(),
    userDataDir: z.string(),
    cdpEndpoint: z.string(),
  }),
  login: z.object({
    binaryPath: z.string(),
    appVersion: z.string(),
    userAgent: z.string(),
  }),
});

const commandsConfigSchema = z.object({ enabled: z.boolean(), wakeword: z.string() });

const updatesConfigSchema = z.object({
  enabled: z.boolean(),
  channel: z.enum(['stable', 'dev']),
  repository: z.string().min(1),
  checkIntervalHours: z.number().min(UPDATES.CHECK_INTERVAL_HOURS_MIN).max(UPDATES.CHECK_INTERVAL_HOURS_MAX),
  autoApply: z.boolean(),
  dockerSocket: z.string(),
});

const sharedMergedFields = {
  auth: authConfigSchema,
  log: logConfigSchema,
  conversations: conversationsConfigSchema,
  commands: commandsConfigSchema,
  updates: updatesConfigSchema,
  enableWebSearch: z.boolean(),
};

const serverMergedConfigSchema = z.object({
  ...sharedMergedFields,
  customTools: customToolsConfigSchema,
  promptTokenEstimation: promptTokenEstimationSchema,
  promptTokenEstimationFactor: promptTokenEstimationFactorSchema,
  instructions: serverInstructionsConfigSchema,
  metrics: metricsConfigSchema,
  bodyLimit: byteSizeSchema,
  port: z.number().int().positive(),
  apiKey: z.string().min(1, 'server.apiKey is required'),
  apiModelName: z.string().min(1),
  defaultModelTier: z.enum(['auto', 'lumo-lite', 'lumo-max']),
  allowedModels: z.array(z.string().min(1)).min(1),
  extraModels: z.array(z.object({
    id: z.string().min(1),
    model: z.enum(['lumo', 'lumo-lite', 'lumo-max', 'auto']),
    reasoning: z.enum(['none', 'high']).optional(),
  })),
  reasoning: z.object({
    default: z.enum(['none', 'high']),
    surfaceThinking: z.boolean(),
  }),
}).refine(
  (cfg) => isDefaultTierAllowed(cfg.defaultModelTier, cfg.allowedModels),
  { message: 'defaultModelTier must be in allowedModels or "auto"', path: ['defaultModelTier'] },
);

const cliMergedConfigSchema = z.object({
  ...sharedMergedFields,
  localActions: localActionsConfigSchema,
  instructions: cliInstructionsConfigSchema,
});

type ServerMergedConfig = z.infer<typeof serverMergedConfigSchema>;
type CliMergedConfig = z.infer<typeof cliMergedConfigSchema>;
type MergedConfig = ServerMergedConfig | CliMergedConfig;

// ============================================
// Config Loading
// ============================================

// Cache user config (loaded once)
let userConfigCache: Record<string, unknown> | null = null;
let usingConfigDefaults = false;

function loadUserYaml(): Record<string, unknown> {
  if (userConfigCache !== null) return userConfigCache;

  userConfigCache = loadConfigYaml();
  if (Object.keys(userConfigCache).length === 0) usingConfigDefaults = true;
  return userConfigCache;
}

export function isUsingConfigDefaults(): boolean {
  return usingConfigDefaults;
}

function loadMergedConfig(mode: ConfigMode): MergedConfig {
  try {
    const userConfig = loadUserYaml();
    const defaultModeConfig = (mode === 'server' ? configDefaults.server : configDefaults.cli) as Record<string, unknown>;
    const userModeConfig = (mode === 'server' ? userConfig.server : userConfig.cli) as Record<string, unknown> | undefined;

    // Stage 1: defaults -> user (for all keys including mode-specific)
    const merged = mergeConfigLayers(configDefaults, defaultModeConfig, userConfig, userModeConfig);

    // Stage 2: apply user mode overrides for shared keys only
    for (const key of SHARED_KEYS) {
      if (userModeConfig?.[key]) {
        merged[key] = mergeConfigLayers(merged[key], userModeConfig[key]);
      }
    }

    // Remove server/cli sections from final config
    delete merged.server;
    delete merged.cli;

    return (mode === 'server' ? serverMergedConfigSchema : cliMergedConfigSchema).parse(merged);
  } catch (error) {
    catchZodErrors(error);
    throw error;
  }
}

/** Validate a user config.yaml object as the server would. Throws ZodError. */
export function parseServerUserConfig(userConfig: Record<string, unknown>): void {
  const defaultModeConfig = (configDefaults.server ?? {}) as Record<string, unknown>;
  const userModeConfig = userConfig.server as Record<string, unknown> | undefined;
  const merged = mergeConfigLayers(configDefaults, defaultModeConfig, userConfig, userModeConfig);
  for (const key of SHARED_KEYS) {
    if (userModeConfig?.[key]) {
      merged[key] = mergeConfigLayers(merged[key], userModeConfig[key]);
    }
  }
  delete merged.server;
  delete merged.cli;
  serverMergedConfigSchema.parse(merged);
}

// ============================================
// State
// ============================================

let config: MergedConfig | null = null;
let configMode: ConfigMode | null = null;

function catchZodErrors(error: unknown, path="") {
  if (error instanceof z.ZodError) {
    const errors = error.issues.map((e) => `  - ${path ? (path + '.') : ""}${e.path.join('.')}: ${e.message}`).join('\n');
    fatalExit(`Configuration validation for config.yaml failed:\n${errors}`);
  }
}

export function initConfig(mode: ConfigMode): void {
  configMode = mode;
  config = loadMergedConfig(mode);
  // Note: replacePatterns regex validation happens in src/api/instructions/
  // at module load time, when logger is available
}

/** Re-read config.yaml into the live process (Save). Listen port still needs Restart. */
export function reloadConfig(): void {
  if (!configMode) throw new Error('Config not initialized. Call initConfig() first.');
  userConfigCache = null;
  usingConfigDefaults = false;
  config = loadMergedConfig(configMode);
}

export function getConfigMode(): ConfigMode | null {
  return configMode;
}

function getConfig(): MergedConfig {
  if (!config) throw new Error('Config not initialized. Call initConfig() first.');
  return config;
}

// ============================================
// Getters
// ============================================

export const getLogConfig = () => getConfig().log;
export const getConversationsConfig = () => getConfig().conversations;
export const getCommandsConfig = () => getConfig().commands;
export const getUpdatesConfig = () => getConfig().updates;
export const getEnableWebSearch = () => getConfig().enableWebSearch;
export type UpdatesConfig = z.infer<typeof updatesConfigSchema>;

// Server-specific getters
export function getServerConfig(): ServerMergedConfig {
  if (configMode !== 'server' || !config) throw new Error('Server configuration required. Run in server mode.');
  return config as ServerMergedConfig;
}

export function getCustomToolsConfig() {
  const cfg = getServerConfig();
  return cfg.customTools;
}

export function getServerInstructionsConfig() {
  const cfg = getServerConfig();
  return cfg.instructions;
}

export function getMetricsConfig() {
  const cfg = getServerConfig();
  return cfg.metrics;
}

export function getReasoningConfig() {
  const cfg = getServerConfig();
  return cfg.reasoning;
}

// CLI-specific getters
export function getCliConfig(): CliMergedConfig {
  if (configMode !== 'cli' || !config) throw new Error('CLI configuration required. Run in CLI mode.');
  return config as CliMergedConfig;
}

export function getLocalActionsConfig() {
  const cfg = getCliConfig();
  return cfg.localActions;
}

export function getCliInstructionsConfig() {
  const cfg = getCliConfig();
  return cfg.instructions;
}

// Generic instructions getter (works for both modes)
export function getInstructionsConfig() {
  return getConfig().instructions;
}

// ============================================
// Legacy/Eager Configs
// ============================================

// Legacy export (for scripts before initConfig, e.g. auth)
export const authConfig = ((): z.infer<typeof authConfigSchema> => {
  try {
    const userConfig = loadUserYaml();
    const merged = merge({}, configDefaults.auth, userConfig.auth);
    return authConfigSchema.parse(merged);
  } catch (error) {
    catchZodErrors(error, "auth");
    throw error;
  }
})();

// Mock config (eagerly loaded, needed before initConfig to decide auth vs mock)
const mockConfigSchema = z.object({
  enabled: z.boolean(),
  scenario: z.enum(['success', 'error', 'timeout', 'rejected', 'toolCall', 'misroutedToolCall', 'historyToolEcho', 'weeklyLimit', 'cycle']),
});

export const mockConfig = ((): z.infer<typeof mockConfigSchema> => {
  const userConfig = loadUserYaml();
  const defaults = (configDefaults as any).test?.mock ?? {};
  const user = (userConfig as any).test?.mock ?? {};
  const merged = merge({}, defaults, user);
  return mockConfigSchema.parse(merged);
})();

// ============================================
// Types (only export those used externally)
// ============================================

export type MockConfig = z.infer<typeof mockConfigSchema>;
export type LogConfig = z.infer<typeof logConfigSchema>;
export type ConversationsConfig = z.infer<typeof conversationsConfigSchema>;

