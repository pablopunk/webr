import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const TAILSCALE_BINARIES = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];

const magicDnsName = (statusJson: string) => {
  const name = (JSON.parse(statusJson) as { Self?: { DNSName?: string } }).Self?.DNSName;
  return name ? name.replace(/\.$/, '') : undefined;
};

export async function detectTailscaleHost() {
  for (const binary of TAILSCALE_BINARIES) {
    try { return magicDnsName((await run(binary, ['status', '--json'], { timeout: 3000 })).stdout); } catch { /* try the next binary */ }
  }
  return undefined;
}
