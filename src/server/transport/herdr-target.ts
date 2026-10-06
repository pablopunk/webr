import type { TargetAdapter, LaunchLocation, TerminalDirection } from '../runtime/target';
import type { TargetProfile } from './registry';
import { localSocket } from './registry';
import { SocketApi } from '../protocol/socket';
import { nativeSnapshot, nativeWorkspace, nativeTab, nativePane } from '../protocol/native';
import { openCliStream } from '../terminal/cli';
import { boundedProcess } from './process';
import { uploadOverSsh } from './remote-upload';
import { SshForward, sshOptions, remoteCommand, quoteShell } from './ssh';
import type { LaunchInput } from '../../shared/runtime';
import type { Machine, MachineOs } from '../../lib/machines';
import { harnessName } from '../../lib/models';
import { acceptsModelFlag, herdrAgentKinds, isHerdrAgentKind } from '../../shared/agent-kinds';
import { modelListings, parseModelListing } from './model-discovery';
import { HerdrActions } from '../runtime/herdr-actions';
import { listRemoteIconCandidates, readRemoteIcon } from './remote-icons';
import { listIconCandidates, readApprovedIcon, type Icon, type IconCandidate } from './icons';
import { targetFingerprint } from './identity';
import { scopedProjectId } from '../../shared/projects';
import { validateInstalledSchema } from '../protocol/validate';
import { ensureLocalSession } from './local-session';
import { nativeLocations } from './native-locations';
import { expandHome, listLocalDirectories, suggestDirectories } from '../directories';

const MODEL_LISTING_TIMEOUT_MS = 15_000;
const MODEL_CACHE_TTL_MS = 10 * 60_000;
const MODEL_LISTING_LIMIT = 4 * 1024 * 1024;
const osFromPlatform = (platform: string): MachineOs | undefined => platform === 'darwin' || platform === 'Darwin' ? 'macos' : platform === 'win32' || /^(MINGW|MSYS|CYGWIN)/i.test(platform) ? 'windows' : platform.toLowerCase() === 'linux' ? 'linux' : undefined;
type Dependencies = { process: typeof boundedProcess; cli: typeof openCliStream };
export class HerdrTarget implements TargetAdapter {
  readonly id; readonly name; readonly session; readonly locations: LaunchLocation[];
  readonly fingerprint; configVersion = 1;
  get enabled() { return this.profile.enabled; }
  get writable() { return this.compatible; }
  get os() { return this.profile.transport === 'local' ? osFromPlatform(process.platform) : this.remoteOs; }
  get acceptsUploads() { return this.profile.transport === 'local' || this.remoteOs !== 'windows'; }
  storeUpload?: (fileName: string, bytes: Buffer) => Promise<string>;
  private api?: SocketApi;
  private forwarding?: SshForward;
  private compatible = false;
  private remoteOs?: MachineOs;
  private connecting?: Promise<SocketApi>;
  private streams = new Set<ReturnType<typeof openCliStream>>();
  private icons = new Map<string, { expires: number; value: Promise<Icon | undefined> }>();
  private candidates = new Map<string, { expires: number; value: Promise<IconCandidate[]> }>();
  constructor(private profile: TargetProfile, private dependencies: Dependencies = { process: boundedProcess, cli: openCliStream }) {
    if (profile.transport === 'ssh') this.storeUpload = (fileName, bytes) => uploadOverSsh(profile.host!, fileName, bytes);
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
      if (!this.profile.enabled || !this.profile.automatic && process.env.WEBR_CONNECT !== '1') throw new Error('connection_not_approved');
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
      if (this.profile.transport === 'ssh') void this.detectRemoteOs();
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
    if (this.profile.automatic) this.locations.splice(0, this.locations.length, ...nativeLocations(this.id, snapshot));
    return snapshot;
  }
  async createWorkspace(path: string, label: string, requestId: string) {
    if (!this.profile.automatic || !this.compatible) throw new Error('workspace_creation_unavailable');
    const result = await (await this.connect()).request('workspace.create', { cwd: await this.expandHome(path), label, focus: false }, { timeoutMs: 30_000, requestId });
    const workspace = nativeWorkspace.parse(result.workspace); const tab = nativeTab.parse(result.tab); const pane = nativePane.parse(result.root_pane);
    if (tab.workspace_id !== workspace.workspace_id || pane.workspace_id !== workspace.workspace_id || pane.tab_id !== tab.tab_id) throw new Error('workspace_identity_mismatch');
    return { workspaceId: workspace.workspace_id, tabId: tab.tab_id, terminalId: pane.terminal_id };
  }
  async catalog(projectId?: string): Promise<Machine> {
    const api = await this.connect();
    await api.request('ping');
    const run = (command: string, args: string[]) => this.runOnTarget(command, args);
    const isPresent = (kind: string) => run('/bin/sh', ['-c', 'command -v "$1" >/dev/null', 'sh', kind]).then(() => true, () => false);
    const present = (await Promise.all(herdrAgentKinds.map(async (kind) => (await isPresent(kind)) ? kind : undefined))).filter((kind): kind is string => !!kind);
    present.forEach((kind) => this.discoverModels(kind));
    const modelsPending = present.some((kind) => this.pendingModels.has(kind));
    const isGitRepo = await this.isGitRepo(projectId);
    return { id: this.id, name: this.name, session: this.session, connected: true, writable: this.writable, configVersion: this.configVersion, modelsPending, isGitRepo, projectPaths: Object.fromEntries(this.locations.map((location) => [location.projectId, location.path])), harnesses: present.map((id) => ({ id, name: harnessName(id), models: ['Default', ...(this.discoveredModels.get(id)?.models ?? [])], customModels: acceptsModelFlag(id), launchEnabled: true })) };
  }
  private async detectRemoteOs() {
    this.remoteOs = await this.runOnTarget('uname', ['-s']).then((output) => osFromPlatform(output.trim()), () => undefined);
  }
  private async isGitRepo(projectId?: string) {
    const location = this.locations.find((location) => location.projectId === projectId);
    if (!location) return true;
    return this.runOnTarget('git', ['-C', await this.expandHome(location.path), 'rev-parse', '--is-inside-work-tree']).then(() => true, () => false);
  }
  private discoveredModels = new Map<string, { models: string[]; expires: number }>();
  private pendingModels = new Set<string>();
  private discoverModels(kind: string) {
    const listing = modelListings[kind];
    const fresh = (this.discoveredModels.get(kind)?.expires ?? 0) > Date.now();
    if (!listing || fresh || this.pendingModels.has(kind)) return;
    this.pendingModels.add(kind);
    this.runOnTarget(kind, listing.args).then((output) => parseModelListing(kind, output), () => [] as string[])
      .then((models) => this.discoveredModels.set(kind, { models, expires: Date.now() + MODEL_CACHE_TTL_MS }))
      .finally(() => this.pendingModels.delete(kind));
  }
  private runOnTarget(command: string, args: string[], timeoutMs = MODEL_LISTING_TIMEOUT_MS, outputLimit = MODEL_LISTING_LIMIT) {
    return this.profile.transport === 'local'
      ? this.dependencies.process(command, args, undefined, timeoutMs, outputLimit)
      : this.dependencies.process('ssh', [...sshOptions, this.profile.host!, [command, ...args].map(quoteShell).join(' ')], undefined, timeoutMs, outputLimit);
  }
  private runForIcons = (command: string, args: string[], timeoutMs: number, outputLimit: number) => this.runOnTarget(command, args, timeoutMs, outputLimit);
  private async findIcon(path: string) {
    return this.profile.transport === 'local' ? readApprovedIcon(path) : readRemoteIcon(this.runForIcons, await this.expandHome(path));
  }
  private async findIconCandidates(path: string) {
    return this.profile.transport === 'local' ? listIconCandidates(path) : listRemoteIconCandidates(this.runForIcons, await this.expandHome(path));
  }
  private async expandHome(path: string) {
    if (this.profile.transport === 'local') return expandHome(path);
    if (path !== '~' && !path.startsWith('~/')) return path;
    return (await this.runOnTarget('/bin/sh', ['-c', 'printf %s "$HOME"'])) + path.slice(1);
  }
  private listRemoteDirectories = async (parent: string) => {
    const script = 'case "$1" in "~") d="$HOME";; "~/"*) d="$HOME/${1#"~/"}";; *) d="$1";; esac; cd "$d" 2>/dev/null && ls -1Ap | grep "/$" | sed "s|/$||"';
    return (await this.runOnTarget('/bin/sh', ['-c', script, 'sh', parent]).catch(() => '')).split('\n').filter(Boolean);
  };
  suggestDirectories(prefix: string) { return suggestDirectories(prefix, this.profile.transport === 'local' ? listLocalDirectories : this.listRemoteDirectories); }
  async icon(projectId: string) {
    const location = this.locations.find((location) => location.projectId === projectId);
    if (!location) return;
    const cached = this.icons.get(projectId);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = this.findIcon(location.path);
    this.icons.set(projectId, { expires: Date.now() + 60_000, value }); return value;
  }
  async iconCandidates(projectId: string) {
    const location = this.locations.find((location) => location.projectId === projectId);
    if (!location) return [];
    const cached = this.candidates.get(projectId);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = this.findIconCandidates(location.path);
    this.candidates.set(projectId, { expires: Date.now() + 60_000, value }); return value;
  }
  openTerminal: TargetAdapter['openTerminal'] = (terminalId, mode, cols, rows, takeover, onFrame, onClose) => {
    if (!this.compatible || mode === 'control' && !this.writable || mode === 'observe' && takeover) throw new Error('terminal_control_unavailable');
    const command = this.command(['terminal', 'session', mode, terminalId, '--cols', String(cols), '--rows', String(rows), ...(takeover ? ['--takeover'] : [])]);
    const stream = this.dependencies.cli(command.command, command.args, { env: command.env }, onFrame, (reason) => { this.streams.delete(stream); onClose(reason); });
    this.streams.add(stream); return stream;
  };
  async create(input: LaunchInput, threadId: string) { return this.actions().create(input, threadId); }
  canLaunch(input: LaunchInput) { return this.compatible && isHerdrAgentKind(input.agent) && this.locations.some((location) => location.projectId === input.projectId); }
  async start(input: LaunchInput, paneId: string, threadId: string) { return this.actions().start(input, paneId, threadId); }
  async prompt(paneId: string, prompt: string, terminalId: string, threadId: string, input: LaunchInput) { return this.actions().prompt(paneId, prompt, terminalId, threadId, input.agent, input); }
  async worktrees(projectId: string) { return this.actions().worktrees(this.workspaceOf(projectId)); }
  async openWorktree(projectId: string, path: string) { return this.actions().openWorktree(this.workspaceOf(projectId), path); }
  private workspaceOf(projectId: string) {
    const location = this.locations.find((location) => location.projectId === projectId);
    if (!location) throw new Error('unknown_project_location');
    return location.workspaceId;
  }
  /** 'app' when a full-screen program, not the shell, owns the pane and has no history to scroll through. */
  async scrollMode(terminalId: string): Promise<'scrollback' | 'app'> {
    const pane = (await this.snapshot()).panes.find((candidate) => candidate.terminal_id === terminalId);
    if (!pane || (pane.scroll?.max_offset_from_bottom ?? 0) > 0) return 'scrollback';
    const info = (await (await this.connect()).request('pane.process_info', { pane_id: pane.pane_id })).process_info as { foreground_process_group_id?: number; shell_pid?: number } | undefined;
    return info?.foreground_process_group_id !== undefined && info.foreground_process_group_id !== info.shell_pid ? 'app' : 'scrollback';
  }
  async focusPane(paneId: string) { return this.actions().focus(paneId); }
  async renameTab(tabId: string, label: string, renameWorkspace: boolean) { return this.actions().renameTab(await this.snapshot(), tabId, label, renameWorkspace); }
  async splitTerminal(paneId: string, direction: TerminalDirection) { return this.actions().splitTerminal(await this.snapshot(), paneId, direction); }
  async closePane(paneId: string) { return this.actions().closePane(paneId); }
  async paneBusy(paneId: string) { return this.actions().paneBusy(paneId); }
  async discardTab(tabId: string, removeWorktree: boolean) { return this.actions().discardTab(await this.snapshot(), tabId, removeWorktree); }
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
