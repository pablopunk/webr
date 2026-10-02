import type { TargetAdapter, LaunchLocation } from '../runtime/target';
import type { TargetProfile } from './registry';
import { localSocket } from './registry';
import { SocketApi } from '../protocol/socket';
import { nativeSnapshot, nativeWorkspace, nativeTab, nativePane } from '../protocol/native';
import { openCliStream } from '../terminal/cli';
import { boundedProcess } from './process';
import { SshForward, sshOptions, remoteCommand, quoteShell } from './ssh';
import type { LaunchInput } from '../../shared/runtime';
import type { Machine } from '../../lib/machines';
import { harnessName } from '../../lib/models';
import { HerdrActions } from '../runtime/herdr-actions';
import { readApprovedIcon, type Icon } from './icons';
import { targetFingerprint } from './identity';
import { scopedProjectId } from '../../shared/projects';
import { validateInstalledSchema } from '../protocol/validate';
import { ensureLocalSession } from './local-session';
import { nativeLocations } from './native-locations';

const knownKinds = ['claude', 'codex', 'opencode', 'pi'];
const launchableKinds = ['claude', 'codex', 'opencode'];
type Dependencies = { process: typeof boundedProcess; cli: typeof openCliStream };
export class HerdrTarget implements TargetAdapter {
  readonly id; readonly name; readonly session; readonly locations: LaunchLocation[];
  readonly fingerprint; configVersion = 1;
  get enabled() { return this.profile.enabled; }
  get writable() { return this.compatible; }
  private api?: SocketApi;
  private forwarding?: SshForward;
  private compatible = false;
  private connecting?: Promise<SocketApi>;
  private streams = new Set<ReturnType<typeof openCliStream>>();
  private icons = new Map<string, { expires: number; value: Promise<Icon | undefined> }>();
  constructor(private profile: TargetProfile, private dependencies: Dependencies = { process: boundedProcess, cli: openCliStream }) {
    this.id = profile.id; this.name = profile.name; this.session = profile.session;
    this.fingerprint = targetFingerprint(profile);
    this.locations = profile.locations.map((location) => ({ ...location, localId: location.projectId, logicalId: location.logicalId ?? location.projectId, projectId: scopedProjectId(profile.id, location.projectId) }));
  }
  private command(args: string[]) {
    const env: NodeJS.ProcessEnv = { ...process.env, HERDR_SOCKET_PATH: this.profile.socket ?? localSocket(this.profile) };
    delete env.HERDR_SESSION;
    return this.profile.transport === 'local'
      ? { command: this.profile.executable ?? 'herdr', args, env }
      : { command: 'ssh', args: [...sshOptions, this.profile.host!, remoteCommand(this.profile.socket!, this.profile.executable ?? 'herdr', args)], env: process.env };
  }
  private async connect() {
    if (this.connecting) return this.connecting;
    if (this.api) return this.api;
    this.connecting ??= (async () => {
      if (!this.profile.enabled || !(this.profile.automatic && this.profile.transport === 'local') && process.env.HERDR_WEB_CONNECT !== '1') throw new Error('connection_not_approved');
      if (this.profile.automatic && this.profile.transport === 'local') await ensureLocalSession(this.profile);
      if (this.profile.transport === 'ssh') {
        this.forwarding = new SshForward(this.profile.host!, this.profile.socket!);
        this.api = await this.forwarding.open();
      } else this.api = new SocketApi(localSocket(this.profile));
      const ping = await this.api.request('ping');
      const command = this.command(['--version']);
      const version = await this.dependencies.process(command.command, command.args, command.env);
      const compatible = ping.protocol === 22 && ping.version === '0.9.3' && /^herdr 0\.9\.3\s*$/.test(version);
      if (!compatible) throw new Error('unsupported_herdr_version');
      const schemaCommand = this.command(['api', 'schema', '--json']);
      const schema = JSON.parse(await this.dependencies.process(schemaCommand.command, schemaCommand.args, schemaCommand.env, 5000, 2 * 1024 * 1024));
      if (validateInstalledSchema(schema).length) { this.compatible = false; throw new Error('unsupported_herdr_schema'); }
      this.compatible = true;
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
    if (snapshot.version !== '0.9.3') { this.compatible = false; throw new Error('unsupported_herdr_version'); }
    if (this.profile.automatic && this.profile.transport === 'local') this.locations.splice(0, this.locations.length, ...nativeLocations(this.id, snapshot));
    return snapshot;
  }
  async createWorkspace(path: string, label: string, requestId: string) {
    if (this.profile.transport !== 'local' || !this.profile.automatic || !this.compatible) throw new Error('workspace_creation_unavailable');
    const result = await (await this.connect()).request('workspace.create', { cwd: path, label, focus: false }, { timeoutMs: 30_000, requestId });
    const workspace = nativeWorkspace.parse(result.workspace); const tab = nativeTab.parse(result.tab); const pane = nativePane.parse(result.root_pane);
    if (tab.workspace_id !== workspace.workspace_id || pane.workspace_id !== workspace.workspace_id || pane.tab_id !== tab.tab_id) throw new Error('workspace_identity_mismatch');
    return { workspaceId: workspace.workspace_id, tabId: tab.tab_id, terminalId: pane.terminal_id };
  }
  async catalog(projectId?: string): Promise<Machine> {
    const api = await this.connect();
    await api.request('ping');
    const present: string[] = [];
    for (const kind of knownKinds) {
      try {
        const command = this.profile.transport === 'local' ? { command: '/bin/sh', args: ['-c', 'command -v "$1" >/dev/null', 'sh', kind] } : { command: 'ssh', args: [...sshOptions, this.profile.host!, 'command -v ' + quoteShell(kind) + ' >/dev/null'] };
        await this.dependencies.process(command.command, command.args); present.push(kind);
      } catch {}
    }
    const location = this.locations.find((location) => location.projectId === projectId);
    return { id: this.id, name: this.name, session: this.session, connected: true, writable: this.writable, configVersion: this.configVersion, projectPaths: Object.fromEntries(this.locations.map((location) => [location.projectId, location.path])), harnesses: present.map((id) => launchableKinds.includes(id)
      ? { id, name: harnessName(id), models: ['Default'], customModels: true, launchEnabled: true }
      : { id, name: harnessName(id), models: [], customModels: false, launchEnabled: false, reason: harnessName(id) + ' cannot be launched from Herdr Web yet.' }) };
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
    if (!this.compatible || mode === 'control' && !this.writable || mode === 'observe' && takeover) throw new Error('terminal_control_unavailable');
    const command = this.command(['terminal', 'session', mode, terminalId, '--cols', String(cols), '--rows', String(rows), ...(takeover ? ['--takeover'] : [])]);
    const stream = this.dependencies.cli(command.command, command.args, { env: command.env }, onFrame, (reason) => { this.streams.delete(stream); onClose(reason); });
    this.streams.add(stream); return stream;
  };
  async create(input: LaunchInput, threadId: string) { return this.actions().create(input, threadId); }
  canLaunch(input: LaunchInput) { return this.compatible && launchableKinds.includes(input.agent) && this.locations.some((location) => location.projectId === input.projectId); }
  async start(input: LaunchInput, paneId: string, threadId: string) { return this.actions().start(input, paneId, threadId); }
  async prompt(paneId: string, prompt: string, terminalId: string, threadId: string, input: LaunchInput) { return this.actions().prompt(paneId, prompt, terminalId, threadId, input.agent, input); }
  private actions() {
    return new HerdrActions({ request: async (method, params, options) => {
      const api = await this.connect(); const ping = await api.request('ping');
      if (ping.version !== '0.9.3' || ping.protocol !== 22) { this.compatible = false; throw new Error('unsupported_herdr_version'); }
      return api.request(method, params, options);
    } }, this.locations, (input) => { if (!input || !this.canLaunch(input)) throw new Error('launch_unavailable'); });
  }
  close() { this.compatible = false; this.api?.close(); this.api = undefined; for (const stream of this.streams) stream.close(); void this.forwarding?.close(); }
  private async disconnect() { this.compatible = false; this.api?.close(); this.api = undefined; await this.forwarding?.close(); this.forwarding = undefined; }
}
