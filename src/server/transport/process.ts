import { spawn } from 'node:child_process';

export function boundedProcess(command: string, args: string[], env?: NodeJS.ProcessEnv, timeout = 5000, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderrSize = 0;
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (error) { child.kill('SIGTERM'); reject(error); } else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(() => finish(new Error('process_timeout')), timeout);
    child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > limit) finish(new Error('process_output_limit')); else chunks.push(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderrSize += chunk.length; if (stderrSize > limit) finish(new Error('process_stderr_limit')); });
    child.on('error', () => finish(new Error('process_unavailable')));
    child.on('exit', (code) => finish(code === 0 ? undefined : new Error('process_failed')));
  });
}
