/**
 * Settings that can only be changed in config.yaml on the host, never through
 * the web UI or /v1/config (PUT or import).
 *
 * Each one could turn access to the web UI or the API key into control of the
 * host or of the Proton session:
 * - where updates come from (a foreign image runs with the Docker socket = root);
 * - which executable is spawned, or which browser receives the Proton session;
 * - where secrets and logs are written (arbitrary file writes);
 * - network exposure and whether conversation content is logged.
 *
 * Resetting one of them to its default is still allowed: defaults are trusted.
 */

export const HOST_ONLY_PATHS: ReadonlySet<string> = new Set([
  "updates.repository",
  "updates.dockerSocket",
  "auth.login.binaryPath",
  "auth.browser.cdpEndpoint",
  "auth.browser.userDataDir",
  "auth.vault.path",
  "auth.vault.keyFilePath",
  "log.filePath",
  "log.dumpApiPath",
  "log.messageContent",
  "cli.log.filePath",
  "conversations.databasePath",
  "server.host",
  // Executables lumo-tamer spawns for video analysis.
  "server.video.ffmpegPath",
  "server.video.ffprobePath",
  "server.video.transcribeCommand",
  "server.video.youtube.ytDlpPath",
]);

export function isHostOnlyPath(path: string): boolean {
  return HOST_ONLY_PATHS.has(path);
}

/** Host-only paths among requested changes. */
export function hostOnlyChanges(
  changes: Record<string, unknown> | undefined,
): string[] {
  return Object.keys(changes ?? {}).filter(isHostOnlyPath);
}

/** Changes without the host-only paths, plus the paths that were removed. */
export function withoutHostOnlyChanges(
  changes: Record<string, unknown> | undefined,
): {
  changes: Record<string, unknown>;
  skipped: string[];
} {
  const kept: Record<string, unknown> = {};
  const skipped: string[] = [];
  for (const [path, value] of Object.entries(changes ?? {})) {
    if (isHostOnlyPath(path)) skipped.push(path);
    else kept[path] = value;
  }
  return { changes: kept, skipped };
}

export const HOST_ONLY_MESSAGE =
  "This setting can only be changed in config.yaml on the host (security).";
