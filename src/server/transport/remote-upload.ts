import { spawn } from 'node:child_process';
import { quoteShell, sshOptions } from './ssh';

const UPLOAD_TIMEOUT_MS = 60_000;
const EXPIRY_DAYS = 7;
const OUTPUT_LIMIT = 4096;
const hostPattern = /^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,200}$/;
const fileNamePattern = /^(image|file)-[0-9a-f-]{36}(\.[a-z0-9]{1,10})?$/;
const absolutePath = /^\/[^\0\r\n]+$/;

export const remoteUploadScript = (fileName: string) => {
  if (!fileNamePattern.test(fileName)) throw new Error('invalid_upload_name');
  return [
    'set -e', 'umask 077',
    'dir="${XDG_CACHE_HOME:-$HOME/.cache}/webr-uploads"', 'mkdir -p "$dir"',
    `target="$dir/${fileName}"`,
    'cat > "$target.part"', 'mv "$target.part" "$target"',
    `find "$dir" -type f \\( -name 'image-*' -o -name 'file-*' \\) -mtime +${EXPIRY_DAYS} -exec rm -f {} + >/dev/null 2>&1 || true`,
    'printf \'%s\\n\' "$target"',
  ].join('\n');
};

export function uploadOverSsh(host: string, fileName: string, bytes: Buffer, spawnProcess: typeof spawn = spawn, timeoutMs = UPLOAD_TIMEOUT_MS): Promise<string> {
  if (!hostPattern.test(host)) throw new Error('invalid_ssh_target');
  const command = 'sh -c ' + quoteShell(remoteUploadScript(fileName));
  return new Promise((resolve, reject) => {
    const child = spawnProcess('ssh', [...sshOptions, host, command], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = ''; let settled = false;
    const settle = (error?: Error, path?: string) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) { child.kill('SIGTERM'); reject(error); } else resolve(path!);
    };
    const timer = setTimeout(() => settle(new Error('upload_failed')), timeoutMs);
    child.stdout!.on('data', (chunk: Buffer) => { output += chunk; if (output.length > OUTPUT_LIMIT) settle(new Error('upload_failed')); });
    child.stdin!.on('error', () => {});
    child.on('error', () => settle(new Error('upload_failed')));
    child.on('close', (code) => { const path = output.trim().split('\n').at(-1) ?? ''; if (code === 0 && absolutePath.test(path)) settle(undefined, path); else settle(new Error('upload_failed')); });
    child.stdin!.end(bytes);
  });
}
