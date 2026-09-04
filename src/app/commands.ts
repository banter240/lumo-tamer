/**
 * Command handler for CLI and API modes.
 * Supports commands like /save for syncing conversations.
 */

import { logger } from './logger.js';
import { getCommandsConfig, getConversationsConfig } from './config.js';
import { getSyncService, getConversationStore, getAutoSyncService } from '../conversations/index.js';
import { markConversationPrivate, isConversationPrivate } from '../conversations/privacy.js';
import type { AuthManager } from '../auth/index.js';
import type { Turn } from '../lumo-client/index.js';

/**
 * Check if a message is a command (starts with / or wakeword)
 */
export function isCommand(message?: string): boolean {
  if(!message)
    return false;
  const trimmed = message.trim();
  if (trimmed.startsWith('/')) return true;

  const { wakeword } = getCommandsConfig();
  if (wakeword && trimmed.toLowerCase().startsWith(wakeword.toLowerCase() + ' ')) {
    return true;
  }
  return false;
}

/**
 * Command execution context
 */
export interface CommandContext {
  syncInitialized: boolean;
  conversationId?: string;
  /** AuthManager for logout and token refresh commands */
  authManager?: AuthManager;
  /** Turns from the current request (for /save on stateless requests) */
  turns?: Turn[];
}

export interface CommandResult {
  isCommand: true;
  response: string;
}

/**
 * Check if the last user message is a command and execute it.
 * Returns the command result if executed, or undefined if not a command.
 */
export async function tryExecuteCommand(
  turns: Turn[],
  commandContext: CommandContext
): Promise<CommandResult | undefined> {
  if (!getCommandsConfig().enabled) return undefined;

  const lastUserTurn = [...turns].reverse().find(t => t.role === 'user');
  if (!lastUserTurn?.content || !isCommand(lastUserTurn.content)) return undefined;

  const response = await executeCommand(lastUserTurn.content, { ...commandContext, turns });
  logger.info({ command: lastUserTurn.content, response }, 'Command executed via API');

  return { isCommand: true, response };
}

/**
 * Execute a command.
 *
 * @param command - The command string (e.g., "/save")
 * @param context - Optional execution context
 * @returns Result message
 */
export async function executeCommand(
  command: string,
  context?: CommandContext
): Promise<string> {
    const commandsConfig = getCommandsConfig();
    if (!commandsConfig.enabled) {
        logger.debug({ command }, 'Command ignored (commands.enabled=false)');
        return 'Commands are disabled.';
    }

    // Strip prefix (/ or wakeword)
    let commandText: string;
    if (command.startsWith('/')) {
      commandText = command.slice(1).trim();
    } else {
      const { wakeword } = commandsConfig;
      // Strip "wakeword " prefix (case-insensitive match already done in isCommand)
      commandText = command.slice(wakeword.length).trim();
    }

    // Extract command name and parameters: /command param1 param2 ...
    const match = commandText.match(/^(\S+)(?:\s+(.*))?$/);
    const commandName = match?.[1] || commandText;
    const params = match?.[2] || '';
    const lowerCommand = commandName.toLowerCase();

    logger.info(`Executing command: /${lowerCommand}${params ? ` with params: ${params}` : ''}`);

    switch (lowerCommand) {
      case 'help':
        return getHelpText();

      case 'save':
        return await handleSaveCommand(params, context);

      case 'load':
        return await handleLoadCommand(params, context);

      case 'title':
        return handleTitleCommand(params, context);

      case 'logout':
        return await handleLogoutCommand(context);

      case 'refreshtokens':
        return await handleRefreshTokensCommand(context);

      case 'update':
        return await handleUpdateCommand(params);

      case 'ole':
        return 'ole!';

      // Unsupported commands (would need browser)
      case 'new':
      case 'clear':
      case 'reset':
      case 'open':
        return `Command /${lowerCommand} is not available.`;

      case 'private':
        return handlePrivateCommand(context);

      default:
        logger.warn(`Unknown command: /${commandName}`);
        return `Unknown command: /${commandName}\n\n${getHelpText()}`;
    }
}

/**
 * Get help text for available commands
 */
function getHelpText(): string {
  const { wakeword } = getCommandsConfig();
  const wakewordHint = wakeword ? `\n\nAlternatively, use "${wakeword} <command>" instead of "/<command>"` : '';
  return `Available commands:
  /help              - Show this help message
  /title <text>      - Set conversation title
  /save [title]      - Save stateless request to conversation (optionally set title)
  /load <id>         - Load a conversation from Proton by ID
  /refreshtokens     - Manually refresh auth tokens
  /update [apply]    - Check GitHub for a new image; apply recreates this container
  /logout            - Revoke session and delete tokens
  /private           - Keep this conversation local (do not sync)
  /quit              - Exit CLI (CLI mode only)${wakewordHint}`;
}

/**
 * Handle /title command - set conversation title manually
 *
 * Inspired by WebClients ConversationHeader.tsx title editing
 */
function handlePrivateCommand(context?: CommandContext): string {
  if (!context?.conversationId) {
    return 'No active conversation to mark private.';
  }
  markConversationPrivate(context.conversationId);
  try {
    const store = getConversationStore();
    if (store && 'markPrivate' in store && typeof store.markPrivate === 'function') {
      store.markPrivate(context.conversationId);
    }
  } catch {
    // Store not up yet; the in-memory flag is enough to skip sync.
  }
  if (!getConversationsConfig().enableSync) {
    return 'Sync is already off. Marked this conversation private anyway.';
  }
  return 'This conversation will stay local and will not sync to Proton.';
}

function handleTitleCommand(params: string, context?: CommandContext): string {
  if (!params.trim()) {
    return 'Usage: /title <new title>';
  }
  if (!context?.conversationId) {
    return 'No active conversation to rename.';
  }
  const store = getConversationStore();
  if (!store) {
    return 'Conversation store not available.';
  }
  // Enforce max length (same as postProcessTitle)
  const title = params.trim().substring(0, 100);
  store.setTitle(context.conversationId, title);
  return `Title set to: ${title}`;
}

/**
 * Handle /save command - save current conversation only
 * Optionally set title first with /save <title>
 *
 * For stateless requests (no conversationId), creates a new conversation
 * from the provided messages and saves it.
 */
async function handleSaveCommand(params: string, context?: CommandContext): Promise<string> {
  try {
    if (!context?.syncInitialized) {
      return 'Sync not initialized. Persistence may be disabled or KeyManager not ready.';
    }

    const store = getConversationStore();
    let conversationId = context?.conversationId;
    let wasCreated = false;

    if (conversationId && isConversationPrivate(conversationId)) {
      return 'This conversation is private and will not sync.';
    }

    // Handle stateless requests - create conversation from turns
    if (!conversationId) {
      if (!context?.turns || context.turns.length === 0) {
        return 'No messages to save.';
      }

      const result = store.createFromTurns(context.turns, params.trim() || undefined);
      conversationId = result.conversationId;
      wasCreated = true;
    } else {
      // Stateful request - optionally set title
      if (params.trim()) {
        const title = params.trim().substring(0, 100);
        store.setTitle(conversationId, title);
      }
    }

    const syncService = getSyncService();
    const synced = await syncService.syncById(conversationId);

    if (!synced) {
      return 'Conversation not found or could not be saved.';
    }

    const conversation = store.get(conversationId);
    const title = conversation?.title ?? 'Unknown';

    // Different message for newly created vs existing conversation
    if (wasCreated) {
      return `Created and saved conversation: ${title}`;
    }
    return `Saved conversation: ${title}`;
  } catch (error) {
    logger.error({ error }, 'Failed to execute /save command');
    return `Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

/**
 * Handle /load command - load a conversation from server by local ID
 */
async function handleLoadCommand(params: string, context?: CommandContext): Promise<string> {
  try {
    if (!context?.syncInitialized) {
      return 'Sync not initialized. Persistence may be disabled or KeyManager not ready.';
    }

    const localId = params.trim();
    if (!localId) {
      return 'Usage: /load <id>\nExample: /load f0654976-d628-4516-8e80-a0599b6593ac';
    }

    const syncService = getSyncService();
    const conversationId = await syncService.loadExistingConversation(localId);

    if (!conversationId) {
      return `Conversation not found: ${localId}`;
    }

    const store = getConversationStore();
    const conversation = store.get(conversationId);
    const messageCount = conversation?.messages.length ?? 0;
    const title = conversation?.title ?? 'Untitled';

    return `Loaded conversation: ${title}\nLocal ID: ${conversationId}\nMessages: ${messageCount}`;
  } catch (error) {
    logger.error({ error }, 'Failed to execute /load command');
    return `Load failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

/**
 * Handle /refreshtokens command - manually trigger token refresh
 */
async function handleRefreshTokensCommand(context?: CommandContext): Promise<string> {
  try {
    if (!context?.authManager) {
      return 'Token refresh not available - missing auth context.';
    }

    await context.authManager.refreshNow();
    return 'Tokens refreshed successfully.';
  } catch (error) {
    logger.error({ error }, 'Failed to execute /refreshtokens command');
    return `Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}. Open /auth and log in again.`;
  }
}

/**
 * Handle /update [apply] — GitHub check, optional Docker self-update
 */
async function handleUpdateCommand(params: string): Promise<string> {
  const { checkForUpdate, applyUpdate } = await import('./updates.js');
  const apply = /^\s*apply\b/i.test(params);
  try {
    if (apply) {
      const result = await applyUpdate();
      return result.message;
    }
    const status = await checkForUpdate();
    if (status.error) return `Update check failed: ${status.error}`;
    if (!status.available) {
      return `Up to date (${status.current}) on ${status.channel} / ${status.repository}.`;
    }
    const lines = [
      status.action === 'downgrade'
        ? `Downgrade on ${status.channel}/main: ${status.current} → ${status.latest}. Config and the vault may not load.`
        : status.action === 'switch'
          ? `Switch to ${status.channel} ${status.latest} (image :${status.channelTag}).`
          : `Update available: ${status.current} → ${status.latest} (${status.channel}).`,
      status.latestUrl ? status.latestUrl : '',
      status.applyHint || '',
    ].filter(Boolean);
    if (status.canApply) {
      lines.push('Apply with /update apply (pulls the GHCR tag and recreates this container via docker.sock).');
    } else if (status.applyHint) {
      lines.push(status.applyHint);
    }
    return lines.join('\n');
  } catch (error) {
    logger.error({ error }, 'Failed to execute /update command');
    return `Update failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

/**
 * Handle /logout command - revoke session and delete tokens
 */
async function handleLogoutCommand(context?: CommandContext): Promise<string> {
  try {
    if (!context?.authManager) {
      return 'Logout not available - missing auth context.';
    }

    // Stop auto-sync if running
    const autoSync = getAutoSyncService();
    autoSync?.stop();

    // Perform logout (stops refresh timer, revokes session, deletes tokens)
    await context.authManager.logout();

    // Schedule graceful shutdown (high timeout to ensure response is sent)
    setTimeout(() => {
      logger.info('Shutting down after logout...');
      process.exit(0);
    }, 500);

    return 'Logged out successfully. Session revoked and tokens deleted.\nShutting down...';
  } catch (error) {
    logger.error({ error }, 'Failed to execute /logout command');
    return `Logout failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

