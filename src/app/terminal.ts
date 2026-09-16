import { CDP, PORTS } from './const.js';

/** Print a message to the user's terminal (bypasses console shim). */
export function print(text: string, newline = true): void {
  process.stdout.write(text + (newline ? '\n' : ''));
}

export const BUSY_INDICATOR = '...';

export function clearBusyIndicator(): void {
  // Backspace over "..."
  process.stdout.write('\b\b\b   \b\b\b');
}

export function printHelp(): void {
  print(`
lumo-tamer - Use Proton Lumo on the command line

Usage:
  tamer                      Interactive chat mode
  tamer "your prompt"        One-shot query
  tamer auth [method]        Authenticate to Proton
  tamer auth status          Show authentication status
  tamer update [apply]       Check GitHub / apply a Docker image update
  tamer server               Start API server
  tamer --help               Show this help

Commands:
  auth                       Authenticate to Proton (login, browser, or rclone)
  update                     Check GitHub for a new release; apply via docker.sock
  server                     Start OpenAI-compatible API server

Options:
  -h, --help         Show help
  --home <dir>       User data dir (config, vault, sessions). Or set LUMO_HOME.

`);
}

export function printAuthHelp(): void {
  print(`
tamer auth - Authenticate to Proton

Usage:
  tamer auth                 Open /auth in your browser (Proton sign-in)
  tamer auth login           Password (scripts)
  tamer auth browser         Sidecar / CDP extract
  tamer auth rclone          Paste rclone config
  tamer auth status          Show current authentication status
  tamer auth --help          Show this help

`);
}

export function printServerHelp(): void {
  print(`
tamer server - Start OpenAI-compatible API server

Usage:
  tamer server               Start the API server
  tamer server --help        Show this help

The server listens on the port configured in config.yaml (default: ${PORTS.TAMER}).
`);
}

export function printUpdateHelp(): void {
  print(`
tamer update - Check GitHub and apply a Docker image update

Usage:
  tamer update               Check the configured channel (dev or stable)
  tamer update apply         Pull GHCR and recreate this container (needs docker.sock)
  tamer update --help        Show this help

Channel and repository live in config.yaml (updates.*). Apply needs
/var/run/docker.sock mounted on this container (see docs/updates.md).
`);
}

