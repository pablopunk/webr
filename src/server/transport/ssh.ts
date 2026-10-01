import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SocketApi } from '../protocol/socket';

export const quoteShell = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export const sshOptions = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2', '-o', 'ExitOnForwardFailure=yes', '-o', 'ForwardAgent=no'];
export function remoteCommand(socket: string, command: string, args: string[]) {
  if (/[\0\r\n]/.test(socket + command + args.join(''))) throw new Error('invalid_remote_command');
  return ['env', 'HERDR_SOCKET_PATH=' + socket, command, ...args].map(quoteShell).join(' ');
}

export class SshForward {
  private process?: ChildProcess;
  private directory?: string;
  private api?: SocketApi;
  constructor(private host: string, private remoteSocket: string) {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.@-]{0,200}$/.test(host) || !/^\/[A-Za-z0-9_./-]+$/.test(remoteSocket)) throw new Error('invalid_ssh_target');
  }
  async open() {
    if (this.api) return this.api;
    this.directory = await mkdtemp(join(tmpdir(), 'hw-'));
    await chmod(this.directory, 0o700);
    const path = join(this.directory, 'a.sock');
    if (Buffer.byteLength(path) > 103) { await this.close(); throw new Error('socket_path_limit'); }
    const child = spawn('ssh', [...sshOptions, '-N', '-L', `${path}:${this.remoteSocket}`, this.host], { stdio: ['ignore', 'ignore', 'pipe'] });
    this.process = child;
    const api = new SocketApi(path);
    let failed = false;
    let stderrBytes = 0;
    child.on('error', () => { failed = true; });
    child.on('exit', () => { failed = true; api.close(); this.api = undefined; });
    child.stderr?.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 16 * 1024) child.kill('SIGTERM'); });
    const end = Date.now() + 5000;
    while (!failed && Date.now() < end) {
      try { await api.request('ping'); this.api = api; return api; } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    await this.close(); throw new Error('ssh_forward_failed');
  }
  async close() {
    this.api?.close(); this.api = undefined;
    this.process?.kill('SIGTERM'); this.process = undefined;
    if (this.directory) await rm(this.directory, { recursive: true, force: true });
    this.directory = undefined;
  }
}
