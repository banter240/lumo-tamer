import { spawn } from 'child_process';

export function systemOpenArgs(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { cmd: string; args: string[] } {
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '', url] };
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  return { cmd: 'xdg-open', args: [url] };
}

/** Open a URL in the OS default browser (Windows / macOS / Linux). */
export function openInSystemBrowser(url: string): void {
  const { cmd, args } = systemOpenArgs(url);
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}
