import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { nativePane, nativeTab, type NativeSnapshot } from '../protocol/native';
import type { ValidatorTransport, OwnedResource, ValidationMethod } from './contracts';
import { ValidationJournal } from './journal';
import { requestDeadline } from '../protocol/deadlines';

export class Ownership {
  readonly existingWorkspaces; readonly existingTerminals; readonly existingPanes;
  constructor(readonly transport: ValidatorTransport, readonly journal: ValidationJournal, initial: NativeSnapshot) {
    this.existingWorkspaces = new Set(initial.workspaces.map((workspace) => workspace.workspace_id)); this.existingTerminals = new Set(initial.panes.map((pane) => pane.terminal_id)); this.existingPanes = new Set(initial.panes.map((pane) => pane.pane_id));
  }
  async effect(method: ValidationMethod, params: Record<string, unknown>): Promise<Record<string, unknown> & { validationOperationId: string }> {
    const id = await this.journal.intent(method, { scope: { workspaceId: params.workspace_id, paneId: params.pane_id, target: params.target, label: params.label, path: params.path } });
    try { const result = await this.transport.request(method, params, { timeoutMs: requestDeadline(method, params), requestId: id }); const get = (value: unknown, keys: string[]) => Object.fromEntries(keys.map((key) => [key, value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined])); await this.journal.record({ event: 'returned', id, method, identifiers: { workspace: get(result.workspace, ['workspace_id', 'label']), tab: get(result.tab, ['tab_id', 'workspace_id']), rootPane: get(result.root_pane, ['pane_id', 'terminal_id', 'workspace_id', 'tab_id']), worktree: get(result.worktree, ['path', 'branch']) } }); this.journal.complete(id); return { ...result, validationOperationId: id }; }
    catch (error) { await this.journal.preserve('Uncertain ' + method + '; do not replay', undefined, id); throw error; }
  }
  async create(kind: OwnedResource['kind'], path: string, sourceWorkspace?: string): Promise<OwnedResource> {
    const nonce = randomUUID(); const label = 'herdr-web-validation-' + nonce;
    const result = await this.effect(kind === 'checkout' ? 'worktree.create' : 'workspace.create', kind === 'checkout' ? { workspace_id: sourceWorkspace, path, branch: 'herdr-web-validation-' + nonce, label, focus: false } : { cwd: path, label, focus: false });
    try {
    const workspace = z.object({ workspace_id: z.string(), label: z.literal(label) }).parse(result.workspace); const tab = nativeTab.parse(result.tab); const pane = nativePane.parse(result.root_pane);
    if (pane.cwd !== path) throw new Error('Created pane cwd does not match the selected owned path');
    if (kind === 'checkout') z.object({ path: z.literal(path), branch: z.literal('herdr-web-validation-' + nonce), is_linked_worktree: z.literal(true) }).parse(result.worktree);
    if (this.existingWorkspaces.has(workspace.workspace_id) || this.existingTerminals.has(pane.terminal_id) || this.existingPanes.has(pane.pane_id) || pane.pane_id === this.transport.callerPaneId || pane.workspace_id !== workspace.workspace_id || pane.tab_id !== tab.tab_id || tab.workspace_id !== workspace.workspace_id || this.journal.resources.some((resource) => resource.workspaceId === workspace.workspace_id || resource.terminalId === pane.terminal_id)) throw new Error('Returned resource is not exclusively runner-created');
    const resource: OwnedResource = { kind, workspaceId: workspace.workspace_id, tabId: tab.tab_id, paneId: pane.pane_id, terminalId: pane.terminal_id, label, path, branch: kind === 'checkout' ? 'herdr-web-validation-' + nonce : undefined };
    await this.journal.own(resource); return resource;
    } catch (error) { await this.journal.preserve('Creation returned unverified identities; preserve its possible resource', undefined, String(result.validationOperationId)); throw error; }
  }
  async fresh(resource: OwnedResource) {
    if (!this.journal.resources.includes(resource) || this.existingWorkspaces.has(resource.workspaceId) || this.existingTerminals.has(resource.terminalId) || resource.paneId === this.transport.callerPaneId) throw new Error('Refusing preexisting or caller resource');
    const snapshot = await this.transport.snapshot(); const workspace = snapshot.workspaces.find((workspace) => workspace.workspace_id === resource.workspaceId);
    const panes = snapshot.panes.filter((pane) => pane.workspace_id === resource.workspaceId);
    const tabs = snapshot.tabs.filter((tab) => tab.workspace_id === resource.workspaceId);
    if (workspace?.label !== resource.label || tabs.length !== 1 || tabs[0].tab_id !== resource.tabId || panes.length !== 1 || panes[0].terminal_id !== resource.terminalId || panes[0].pane_id !== resource.paneId || panes[0].tab_id !== resource.tabId) throw new Error('Owned workspace membership or terminal binding changed');
    if (resource.agentName) {
      const result = await this.transport.request('agent.get', { target: resource.agentName });
      const details = result.agent as Record<string, unknown> | undefined; const cwd = details?.foreground_cwd ?? details?.cwd;
      if (typeof cwd !== 'string' || !(cwd === resource.path || cwd.startsWith(resource.path + '/'))) throw new Error('Agent foreground cwd is outside the owned checkout or unavailable');
      const agent = z.object({ name: z.literal(resource.agentName), terminal_id: z.literal(resource.terminalId), pane_id: z.literal(resource.paneId), agent: z.literal(resource.harness!) }).parse(result.agent); return { snapshot, pane: panes[0], agent };
    }
    if (panes[0].agent) throw new Error('An unrelated agent now occupies the test terminal');
    return { snapshot, pane: panes[0] };
  }
  async foreground(resource: OwnedResource) {
    await this.fresh(resource); const result = await this.transport.request('pane.process_info', { pane_id: resource.paneId });
    return z.object({ pane_id: z.literal(resource.paneId), shell_pid: z.number().int().positive(), foreground_processes: z.array(z.object({ pid: z.number().int().positive(), name: z.string() })).min(1) }).parse(result.process_info);
  }
  async cleanup() {
    for (const resource of [...this.journal.resources].reverse()) {
      try {
        if (this.journal.recovery.some((recovery) => recovery.resource?.workspaceId === resource.workspaceId)) throw new Error('Resource has unresolved ownership; preserve it');
        await this.fresh(resource);
        if (!resource.agentName) { const foreground = await this.foreground(resource); const expected = resource.pid ?? foreground.shell_pid; if (!foreground.foreground_processes.every((process) => process.pid === expected && (resource.pid || !resource.shellName || process.name === resource.shellName))) throw new Error('Foreground process ownership changed'); }
        if (resource.kind === 'source' && this.journal.recovery.length) throw new Error('A linked checkout outcome is unresolved; preserve its source');
        await this.effect(resource.kind === 'checkout' ? 'worktree.remove' : 'workspace.close', resource.kind === 'checkout' ? { workspace_id: resource.workspaceId, force: false } : { workspace_id: resource.workspaceId, close_group: false });
        await this.journal.record({ event: 'cleaned', workspaceId: resource.workspaceId });
      } catch (error) { await this.journal.preserve(error instanceof Error ? error.message : 'Cleanup ownership uncertain', resource); }
    }
  }
}
