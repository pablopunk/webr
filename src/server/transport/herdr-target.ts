import type { TargetAdapter } from '../runtime/target';
import type { TargetProfile } from './registry';
import { localSocket } from './registry';
import { SocketApi } from '../protocol/socket';
import { nativeSnapshot } from '../protocol/native';
import { openCliStream } from '../terminal/cli';
import { boundedProcess } from './process';
import { SshForward, sshOptions, remoteCommand, quoteShell } from './ssh';
import type { LaunchInput } from '../../shared/runtime';
import type { Machine } from '../../lib/machines';
import { harnessName } from '../../lib/models';
import { HerdrActions } from '../runtime/herdr-actions';
import { readApprovedIcon, type Icon } from './icons';

const knownKinds = ['claude', 'codex', 'opencode', 'pi'];
export class HerdrTarget implements TargetAdapter {
  readonly id; readonly name; readonly session; readonly locations;
  readonly writable = false;
  private api?: SocketApi;
  private forwarding?: SshForward;
  private compatible = false;
  private connecting?: Promise<SocketApi>;
  private streams = new Set<ReturnType<typeof openCliStream>>();
  private icons = new Map<string, { expires: number; value: Promise<Icon | undefined> }>();
  constructor(private profile: TargetProfile) {
    this.id = profile.id; this.name = profile.name; this.session = profile.session; this.locations = profile.locations;
  }
  private command(args: string[]) {
    const env: NodeJS.ProcessEnv = { ...process.env, HERDR_SOCKET_PATH: this.profile.socket ?? localSocket(this.profile) };
    delete env.HERDR_SESSION;
    return this.profile.transport === 'local'
      ? { command: 'herdr', args, env }
      : { command: 'ssh', args: [...sshOptions, this.profile.host!, remoteCommand(this.profile.socket!, 'herdr', args)], env: process.env };
  }
  private async connect() {
    if (this.connecting) return this.connecting;
    if (this.api) return this.api;
    this.connecting ??= (async () => {
      if (process.env.HERDR_ENV !== '1' || process.env.HERDR_WEB_CONNECT !== '1') throw new Error('managed_context_required');
      if (this.profile.transport === 'ssh') {
        this.forwarding = new SshForward(this.profile.host!, this.profile.socket!);
        this.api = await this.forwarding.open();
      } else this.api = new SocketApi(localSocket(this.profile));
      const ping = await this.api.request('ping');
      const command = this.command(['--version']);
      const version = await boundedProcess(command.command, command.args, command.env);
      this.compatible = ping.protocol === 22 && ping.version === '0.9.3' && /^herdr 0\.9\.3\s*$/.test(version);
      if (!this.compatible) throw new Error('unsupported_herdr_version');
      return this.api;
    })();
    try { return await this.connecting; }
    catch (error) { await this.disconnect(); throw error; }
    finally { this.connecting = undefined; }
  }
  async subscribe(onEvent: () => void, onClose: (reason: string) => void, paneIds: string[] = []) {
    return (await this.connect()).subscribe(onEvent, (reason) => { this.api?.close(); this.api = undefined; this.compatible = false; void this.forwarding?.close(); this.forwarding = undefined; onClose(reason); }, paneIds);
  }
  async snapshot() {
    const snapshot = nativeSnapshot.parse((await (await this.connect()).request('session.snapshot')).snapshot);
    if (snapshot.version !== '0.9.3') throw new Error('unsupported_herdr_version');
    return snapshot;
  }
  async catalog(): Promise<Machine> {
    const api = await this.connect();
    await api.request('ping');
    const present: string[] = [];
    for (const kind of knownKinds) {
      try {
        const command = this.profile.transport === 'local' ? { command: '/bin/sh', args: ['-c', 'command -v "$1" >/dev/null', 'sh', kind] } : { command: 'ssh', args: [...sshOptions, this.profile.host!, 'command -v ' + quoteShell(kind) + ' >/dev/null'] };
        await boundedProcess(command.command, command.args); present.push(kind);
      } catch {}
    }
    return { id: this.id, name: this.name, session: this.session, connected: true, writable: false, projectPaths: Object.fromEntries(this.locations.map((location) => [location.projectId, location.path])), harnesses: present.map((id) => ({ id, name: harnessName(id), models: [], launchEnabled: false, reason: 'Live launch and input validation has not passed for this target.' })) };
  }
  async icon(projectId: string) {
    const location = this.locations.find((location) => location.projectId === projectId);
    if (this.profile.transport !== 'local' || !location) return;
    const cached = this.icons.get(projectId);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = readApprovedIcon(location.path);
    this.icons.set(projectId, { expires: Date.now() + 60_000, value }); return value;
  }
  openTerminal: TargetAdapter['openTerminal'] = (terminalId, mode, cols, rows, takeover, onFrame, onClose) => {
    if (!this.compatible || mode !== 'observe' || takeover) throw new Error('write_capability_not_validated');
    const command = this.command(['terminal', 'session', 'observe', terminalId, '--cols', String(cols), '--rows', String(rows)]);
    const stream = openCliStream(command.command, command.args, { env: command.env }, onFrame, (reason) => { this.streams.delete(stream); onClose(reason); });
    this.streams.add(stream); return stream;
  };
  async create(input: LaunchInput, threadId: string) { return this.actions().create(input, threadId); }
  async start(input: LaunchInput, paneId: string, threadId: string) { return this.actions().start(input, paneId, threadId); }
  async prompt(paneId: string, prompt: string, terminalId: string, threadId: string, kind: string) { return this.actions().prompt(paneId, prompt, terminalId, threadId, kind); }
  private actions() {
    return new HerdrActions({ request: async (method, params) => (await this.connect()).request(method, params) }, this.locations, () => { throw new Error('launch_capability_not_validated'); });
  }
  close() { this.api?.close(); for (const stream of this.streams) stream.close(); void this.forwarding?.close(); }
  private async disconnect() { this.api?.close(); this.api = undefined; await this.forwarding?.close(); this.forwarding = undefined; }
}
