import { z } from 'zod';
import { acceptsModelFlag, isHerdrAgentKind } from '../../shared/agent-kinds';
import type { LaunchInput } from '../../shared/runtime';
import type { LaunchLocation, TerminalDirection } from './target';
import { nativePane, nativeTab, type NativeSnapshot } from '../protocol/native';
import { AGENT_READY_TIMEOUT_MS, SCREEN_SETTLE_TIMEOUT_MS, SHELL_READY_TIMEOUT_MS, requestDeadline, type RpcOptions } from '../protocol/deadlines';

type Api = { request(method: string, params?: Record<string, unknown>, options?: RpcOptions): Promise<Record<string, unknown>> };
const agentShape = { name: z.string(), terminal_id: z.string(), pane_id: z.string(), agent_status: z.enum(['idle', 'done', 'working', 'blocked', 'unknown']) };
const startedAgent = z.object({ ...agentShape, agent: z.string() });
const detectingAgent = z.object({ ...agentShape, agent: z.string().nullable().optional() });
const processInfo = z.object({ shell_pid: z.number().int().positive(), foreground_processes: z.array(z.object({ pid: z.number().int().positive() })) });
const worktreeEntry = z.object({ path: z.string(), branch: z.string().nullable().optional(), label: z.string(), is_bare: z.boolean(), is_prunable: z.boolean(), open_workspace_id: z.string().nullable().optional() });
export type WorktreeEntry = z.infer<typeof worktreeEntry>;
const SETTLE_INTERVAL_MS = 350;
const AGENT_SHARE_OF_TERMINAL_SPLIT = 0.5;
const SETTLED_READS = 3;
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
export function modelArguments(kind: string, model: string): string[] {
  if (!isHerdrAgentKind(kind) || !/^[A-Za-z0-9_/.:+-]{1,120}$/.test(model)) throw new Error('unsupported_launch_adapter');
  if (model === 'Default') return [];
  if (!acceptsModelFlag(kind)) throw new Error('unsupported_launch_adapter');
  return ['--model', model];
}
export const agentName = (threadId: string) => 'web-' + threadId.replaceAll('-', '').slice(0, 28);

export class HerdrActions {
  constructor(private api: Api, private locations: LaunchLocation[], private requireCapability: (input?: LaunchInput) => void) {}
  async create(input: LaunchInput, threadId: string) {
    this.requireCapability(input);
    const location = this.locations.find((location) => location.projectId === input.projectId);
    if (!location) throw new Error('unknown_project_location');
    const result = await this.api.request(input.worktree ? 'worktree.create' : 'tab.create', input.worktree
      ? { workspace_id: location.workspaceId, branch: 'web/' + threadId, label: input.prompt.split('\n')[0].slice(0, 90), focus: false }
      : { workspace_id: location.workspaceId, cwd: location.path, label: input.prompt.split('\n')[0].slice(0, 90), focus: false }, { timeoutMs: requestDeadline(input.worktree ? 'worktree.create' : 'tab.create', {}) });
    if (result.type !== (input.worktree ? 'worktree_created' : 'tab_created')) throw new Error('unexpected_create_result');
    const pane = nativePane.parse(result.root_pane); const tab = nativeTab.parse(result.tab);
    if (pane.tab_id !== tab.tab_id || pane.workspace_id !== tab.workspace_id) throw new Error('inconsistent_create_result');
    return { paneId: pane.pane_id, terminalId: pane.terminal_id, tabId: tab.tab_id, workspaceId: pane.workspace_id };
  }
  async start(input: LaunchInput, paneId: string, threadId: string) {
    this.requireCapability(input);
    await this.untilShellReady(paneId);
    const params = { name: agentName(threadId), kind: input.agent, pane_id: paneId, args: modelArguments(input.agent, input.model), timeout_ms: AGENT_READY_TIMEOUT_MS };
    const result = await this.startWhenPromptReady(params);
    if (result.type !== 'agent_started') throw new Error('agent_not_ready');
    const isReady = (agent: z.infer<typeof detectingAgent>) => agent.name === params.name && agent.pane_id === paneId && agent.agent === input.agent && ['idle', 'done'].includes(agent.agent_status);
    const started = detectingAgent.parse(result.agent);
    if (started.name !== params.name || started.pane_id !== paneId) throw new Error('agent_not_ready');
    if (!isReady(started)) await this.untilReady(params.name, isReady);
  }
  private async startWhenPromptReady(params: Record<string, unknown>) {
    const end = Date.now() + SHELL_READY_TIMEOUT_MS;
    for (;;) {
      try { return await this.api.request('agent.start', params, { timeoutMs: requestDeadline('agent.start', params) }); }
      catch (error) { if (!(error instanceof Error) || error.message !== 'agent_pane_busy' || Date.now() >= end) throw error; await pause(500); }
    }
  }
  private async shellOwnsForeground(paneId: string) {
    const info = processInfo.safeParse((await this.api.request('pane.process_info', { pane_id: paneId })).process_info);
    return info.success && info.data.foreground_processes.length > 0 && info.data.foreground_processes.every((process) => process.pid === info.data.shell_pid);
  }
  async paneBusy(paneId: string) { return !await this.shellOwnsForeground(paneId); }
  private async untilShellReady(paneId: string) {
    const end = Date.now() + SHELL_READY_TIMEOUT_MS;
    do {
      if (await this.shellOwnsForeground(paneId)) return;
      await pause(250);
    } while (Date.now() < end);
    throw new Error('shell_not_ready');
  }
  private async untilReady(name: string, isReady: (agent: z.infer<typeof detectingAgent>) => boolean) {
    const end = Date.now() + AGENT_READY_TIMEOUT_MS;
    do {
      const current = detectingAgent.safeParse((await this.api.request('agent.get', { target: name })).agent);
      if (current.success && isReady(current.data)) return;
      await pause(250);
    } while (Date.now() < end);
    throw new Error('agent_not_ready');
  }
  async worktrees(workspaceId: string) { return z.array(worktreeEntry).parse((await this.api.request('worktree.list', { workspace_id: workspaceId })).worktrees); }
  async openWorktree(workspaceId: string, path: string) { await this.api.request('worktree.open', { workspace_id: workspaceId, path, focus: false }); }
  async focus(paneId: string) { await this.api.request('pane.focus', { pane_id: paneId }); }
  async splitTerminal(snapshot: NativeSnapshot, paneId: string, direction: TerminalDirection) {
    const pane = snapshot.panes.find((pane) => pane.pane_id === paneId);
    if (!pane) throw new Error('thread_not_found');
    const result = await this.api.request('pane.split', { target_pane_id: paneId, direction, ratio: AGENT_SHARE_OF_TERMINAL_SPLIT, cwd: pane.cwd ?? null, focus: false });
    return nativePane.parse(result.pane).pane_id;
  }
  async closePane(paneId: string) { await this.api.request('pane.close', { pane_id: paneId }); }
  async renameTab(snapshot: NativeSnapshot, tabId: string, label: string, renameWorkspace: boolean) {
    const tab = snapshot.tabs.find((tab) => tab.tab_id === tabId);
    if (!tab) throw new Error('thread_not_found');
    await this.api.request('tab.rename', { tab_id: tabId, label });
    if (renameWorkspace && this.isOnlyTabOfItsWorkspace(snapshot, tab)) await this.api.request('workspace.rename', { workspace_id: tab.workspace_id, label });
  }
  private isOnlyTabOfItsWorkspace(snapshot: NativeSnapshot, tab: NativeSnapshot['tabs'][number]) {
    return snapshot.tabs.filter((other) => other.workspace_id === tab.workspace_id).length === 1;
  }
  async discardTab(snapshot: NativeSnapshot, tabId: string, removeWorktree: boolean) {
    const tab = snapshot.tabs.find((tab) => tab.tab_id === tabId);
    if (!tab) return;
    const linkedWorktree = snapshot.workspaces.find((workspace) => workspace.workspace_id === tab.workspace_id)?.worktree?.is_linked_worktree;
    if (removeWorktree && linkedWorktree && this.isOnlyTabOfItsWorkspace(snapshot, tab)) await this.api.request('worktree.remove', { workspace_id: tab.workspace_id, force: true });
    else await this.api.request('tab.close', { tab_id: tabId });
  }
  async prompt(paneId: string, prompt: string, terminalId: string, threadId: string, kind: string, input?: LaunchInput) {
    this.requireCapability(input);
    const name = agentName(threadId);
    const result = await this.api.request('agent.get', { target: name });
    const agent = startedAgent.parse(result.agent);
    if (agent.name !== name || agent.terminal_id !== terminalId || agent.pane_id !== paneId || agent.agent !== kind || !['idle', 'done'].includes(agent.agent_status)) throw new Error('agent_occupant_changed');
    await this.untilScreenSettles(paneId);
    await this.api.request('agent.prompt', { target: name, text: prompt });
  }
  private async untilScreenSettles(paneId: string) {
    const read = async () => z.object({ text: z.string() }).safeParse((await this.api.request('pane.read', { pane_id: paneId, source: 'recent_unwrapped', format: 'text', strip_ansi: true, lines: 120 })).read).data?.text;
    const end = Date.now() + SCREEN_SETTLE_TIMEOUT_MS;
    let previous = await read(); let unchanged = 0;
    while (Date.now() < end && unchanged < SETTLED_READS) {
      await pause(SETTLE_INTERVAL_MS);
      const current = await read();
      unchanged = current !== undefined && current === previous ? unchanged + 1 : 0; previous = current;
    }
  }
}
