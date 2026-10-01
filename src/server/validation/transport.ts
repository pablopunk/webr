import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { SocketApi } from '../protocol/socket';
import { nativeSnapshot } from '../protocol/native';
import { FrameSequence } from '../../shared/frame';
import { openCliStream } from '../terminal/cli';
import { boundedProcess } from '../transport/process';
import { SshForward, sshOptions, remoteCommand } from '../transport/ssh';
import { localSocket, type TargetProfile } from '../transport/registry';
import { targetFingerprint } from '../transport/identity';
import { assertValidationConsent } from './guard';
import { validationMethods, type ValidatorTransport, type Scratch, type RecorderState, type RecorderCommand, type OwnedResource, type ValidationPeer, type ValidationMethod } from './contracts';
import type { RpcOptions } from '../protocol/deadlines';

const live = new WeakSet<ValidatorTransport>();
export const isLiveTransport = (transport: ValidatorTransport) => live.has(transport);
const recorderState = z.object({ nonce: z.string(), pid: z.number().int().positive(), bytes: z.string().max(90_000), cols: z.number().int().nonnegative(), rows: z.number().int().nonnegative(), commands: z.array(z.string()).max(128) });
class LiveTransport implements ValidatorTransport {
  readonly fingerprint; readonly callerPaneId = process.env.HERDR_PANE_ID!;
  private api?: SocketApi; private forward?: SshForward; private peers = new Set<ValidationPeer>();
  constructor(readonly profile: TargetProfile) { this.fingerprint = targetFingerprint(profile); live.add(this); }
  now() { return Date.now(); }
  sleep(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }
  private invocation(command: string, args: string[]) {
    const socket = this.profile.transport === 'local' ? localSocket(this.profile) : this.profile.socket!;
    return this.profile.transport === 'local' ? { command, args, env: { ...process.env, HERDR_SOCKET_PATH: socket } } : { command: 'ssh', args: [...sshOptions, this.profile.host!, remoteCommand(socket, command, args)], env: process.env };
  }
  private execute(command: string, args: string[], limit = 256 * 1024) { const invocation = this.invocation(command, args); return boundedProcess(invocation.command, invocation.args, invocation.env, 5000, limit); }
  private async connection() {
    if (!this.api) {
      let socket = this.profile.transport === 'local' ? localSocket(this.profile) : this.profile.socket!;
      if (this.profile.transport === 'ssh') { this.forward = new SshForward(this.profile.host!, socket); socket = (await this.forward.open()).path; }
      this.api = new SocketApi(socket, 5000, validationMethods);
    }
    return this.api;
  }
  async inspect() { const executable = this.profile.executable ?? 'herdr'; return { version: (await this.execute(executable, ['--version'])).trim(), schema: JSON.parse(await this.execute(executable, ['api', 'schema', '--json'], 2 * 1024 * 1024)) }; }
  async request(method: ValidationMethod, params: Record<string, unknown>, options?: RpcOptions) { return (await this.connection()).request(method, params, options); }
  async snapshot() { return nativeSnapshot.parse((await this.request('session.snapshot', {})).snapshot); }
  async scratch(nonce: string): Promise<Scratch> {
    const source = await readFile(fileURLToPath(new URL('../../../scripts/validation-recorder.py', import.meta.url)), 'utf8');
    const bootstrap = "import os,sys,tempfile,json,base64; assert sys.platform in ('linux','darwin'), 'unsupported platform'; p=os.path.realpath(tempfile.mkdtemp(prefix='herdr-web-validation-'+sys.argv[1]+'-')); os.chmod(p,0o700); f=os.open(p+'/ownership.json',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600); os.write(f,json.dumps({'nonce':sys.argv[1]}).encode()); os.close(f); f=os.open(p+'/recorder.py',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600); os.write(f,base64.b64decode(sys.argv[2])); os.close(f); print(json.dumps({'path':p,'nonce':sys.argv[1],'platform':sys.platform}))";
    try { return z.object({ path: z.string().startsWith('/'), nonce: z.literal(nonce), platform: z.enum(['linux', 'darwin']) }).parse(JSON.parse(await this.execute('python3', ['-c', bootstrap, nonce, Buffer.from(source).toString('base64')]))); }
    catch { throw new Error('Target requires installed python3 on Linux/macOS; scratch bootstrap failed without installing anything'); }
  }
  private ownershipCheck = "import os,sys,json; p=os.path.realpath(sys.argv[1]); assert os.path.basename(p).startswith('herdr-web-validation-'+sys.argv[2]+'-'); assert json.load(open(p+'/ownership.json'))['nonce']==sys.argv[2]; assert os.stat(p).st_uid==os.getuid()";
  async recorder(scratch: Scratch): Promise<RecorderState | undefined> {
    const script = this.ownershipCheck + "; path=p+'/state.json'; print(open(path).read() if os.path.exists(path) else 'null')";
    const data = JSON.parse(await this.execute('python3', ['-c', script, scratch.path, scratch.nonce])); return data === null ? undefined : recorderState.parse(data);
  }
  async command(scratch: Scratch, command: RecorderCommand) {
    const script = this.ownershipCheck + "; f=os.open(p+'/command.tmp',os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600); os.write(f,sys.argv[3].encode()); os.close(f); os.replace(p+'/command.tmp',p+'/command.json')";
    await this.execute('python3', ['-c', script, scratch.path, scratch.nonce, JSON.stringify(command)]);
  }
  async removeScratch(scratch: Scratch) {
    const script = this.ownershipCheck + "; names=os.listdir(p); assert set(names)<=set(['ownership.json','recorder.py','state.json','state.tmp','command.json','command.tmp']); [os.unlink(p+'/'+name) for name in names]; os.rmdir(p)";
    await this.execute('python3', ['-c', script, scratch.path, scratch.nonce]);
  }
  open(resource: OwnedResource, mode: 'control' | 'observe', takeover = false): ValidationPeer {
    const args = ['terminal', 'session', mode, resource.terminalId, '--cols', '80', '--rows', '24', ...(takeover ? ['--takeover'] : [])];
    const invocation = this.invocation(this.profile.executable ?? 'herdr', args); const sequence = new FrameSequence();
    const peer: ValidationPeer = { frames: [], sequenceOk: true, send: (command) => stream.send(command), close: () => stream.close(), disconnect: () => stream.disconnect!() };
    const stream = openCliStream(invocation.command, invocation.args, { env: invocation.env }, (frame) => {
      try { sequence.accept({ ...frame, streamId: 1, generation: 1 }); }
      catch { peer.sequenceOk = false; peer.closed = 'sequence_gap'; stream.close(); return; }
      peer.frames.push(frame); if (peer.frames.length > 16) peer.frames.splice(1, 1);
    }, (reason) => { peer.closed ??= reason; });
    this.peers.add(peer); return peer;
  }
  async close() { for (const peer of this.peers) peer.close(); this.api?.close(); await this.forward?.close(); }
}
export async function createLiveTransport(profile: TargetProfile, consent: boolean): Promise<ValidatorTransport> {
  assertValidationConsent(process.env, consent, profile);
  if (profile.transport === 'local' && await realpath(localSocket(profile)) !== await realpath(process.env.HERDR_SOCKET_PATH!)) throw new Error('The selected local profile does not match the managed caller session');
  return new LiveTransport(profile);
}
