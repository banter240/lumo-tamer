/**
 * Authentication module for lumo-tamer
 *
 * Usage (via CLI):
 *   tamer auth              - Open /auth (Proton sign-in)
 *   tamer auth login        - Password SRP (scripts)
 *   tamer auth browser      - Sidecar / CDP extract
 *   tamer auth rclone       - Paste rclone config
 *   tamer auth status
 *
 * Updates config.yaml with selected values after successful auth.
 */

import { authMethodSchema, getConversationsConfig } from '../app/config.js';
import { logger } from '../app/logger.js';
import { runBrowserAuthentication } from './browser/authenticate.js';
import { runRcloneAuthentication } from './rclone/authenticate.js';
import { runLoginAuthentication } from './login/authenticate.js';
import { isDesktopLoginNeededError, beginDesktopLogin, checkDesktopLogin } from './desktop-login.js';
import { AuthProvider } from './providers/index.js';
import { printStatus, printSummary, runStatus } from './status.js';
import { updateAuthConfig } from './update-config.js';
import { sidecarTeardownHint } from './sidecar.js';
import { print } from '../app/terminal.js';
import { openInSystemBrowser } from '../app/open-url.js';
import { getServerConfig } from '../app/config.js';
import { PORTS } from '../app/const.js';



interface BrowserAuthResult {
  cdpEndpoint: string;
}

async function authenticateBrowser(): Promise<BrowserAuthResult> {
  const result = await runBrowserAuthentication();

  // Log warnings
  for (const warning of result.warnings) {
    logger.warn(warning);
  }

  // Summary
  const syncEnabled = getConversationsConfig().enableSync;
  if (!syncEnabled) {
    logger.info('Sync disabled - encryption keys not fetched');
  } else if (result.tokens.keyPassword) {
    logger.info('Extended auth data extracted - conversation persistence enabled');
  } else {
    logger.warn('Conversation persistence will use local-only encryption');
  }

  return { cdpEndpoint: result.cdpEndpoint };
}

/**
 * Run the auth command with the given arguments.
 * Called from CLI after config/logger are initialized.
 */
function localAuthUrl(): string {
  return `http://127.0.0.1:${getServerConfig().port || PORTS.TAMER}/auth`;
}

function offerLocalAuthPage(): void {
  const url = localAuthUrl();
  print(`Log in in your browser (any OS):\n  ${url}\n`);
  try {
    openInSystemBrowser(url);
  } catch (error) {
    logger.warn({ error }, 'Could not open the system browser');
  }
}

export async function runAuthCommand(argv: string[]): Promise<void> {
  const subArg = argv[0];

  // Handle status subcommand
  if (subArg === 'status') {
    return runStatus();
  }

  print('=== lumo-tamer authentication ===\n');

  if (!subArg) {
    offerLocalAuthPage();
    print('The server must be running (`tamer server`). Sign in on that page.');
    print('Fallbacks: tamer auth login | tamer auth browser | tamer auth rclone');
    return;
  }

  const method = authMethodSchema.safeParse(subArg).data;
  if (!method) {
    print(`Unknown method: ${subArg}`);
    print('Use: tamer auth | tamer auth login | tamer auth browser | tamer auth rclone | tamer auth status');
    process.exit(1);
  }

  print(`Auth method: ${method}\n`);

  try {
    let cdpEndpoint: string | undefined;
    let persistedMethod = method;

    switch (method) {
      case 'browser': {
        const result = await authenticateBrowser();
        cdpEndpoint = result.cdpEndpoint;
        break;
      }
      case 'rclone':
        await runRcloneAuthentication();
        break;
      case 'login': {
        try {
          const login = await runLoginAuthentication();
          persistedMethod = login.method;
          if (login.sync) {
            logger.info('Conversation sync enabled for this login');
          } else {
            logger.warn('Login succeeded without Lumo scope; conversation sync is off');
          }
        } catch (error) {
          if (!isDesktopLoginNeededError(error)) throw error;
          const started = await beginDesktopLogin();
          print('Proton blocked password login. Open this link on any device:\n');
          print(started.url);
          print('\nWaiting for sign-in…');
          const deadline = Date.now() + 10 * 60 * 1000;
          let done = false;
          while (Date.now() < deadline) {
            const status = await checkDesktopLogin(started.id);
            if (status.ready) {
              persistedMethod = status.method;
              done = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
          if (!done) throw new Error('Proton sign-in timed out');
        }
        break;
      }
      default:
        throw new Error(`Unknown auth method: ${method}`);
    }

    // Flush logger before showing status (pino is async)
    logger.flush();
    await new Promise(resolve => setTimeout(resolve, 100));

    const usedCdp = Boolean(cdpEndpoint);
    updateAuthConfig({
      method: persistedMethod,
      ...(usedCdp ? { cdpEndpoint, launch: false } : {}),
    });

    // Show status after extraction - reload from vault
    const provider = await AuthProvider.create();
    const status = provider.getStatus();
    printStatus(status);
    printSummary(status, provider);

    print('\nYou can now run: tamer or tamer server');
    if (usedCdp) {
      print('');
      print(sidecarTeardownHint());
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error }, `Authentication failed: ${message}`);
    process.exit(1);
  }
}
