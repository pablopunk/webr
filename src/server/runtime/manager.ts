import { EventEmitter } from 'node:events';
import type { TargetAdapter } from './target';
import { TargetSupervisor } from './supervisor';
import { reconcile } from './reconcile';
import type { MetadataDatabase } from '../storage/database';
import type { Bootstrap, Projection } from '../../shared/runtime';
import type { Machine } from '../../lib/machines';
import { LaunchJournal } from './launch';

export class RuntimeManager extends EventEmitter {
  readonly supervisors = new Map<string, TargetSupervisor>();
  readonly journal: LaunchJournal;
  private projections = new Map<string, Projection>();
  private catalogs = new Map<string, { expires: number; value: Promise<Machine> }>();
  private configVersions = new Map<string, number>();
  constructor(readonly database: MetadataDatabase, targets: TargetAdapter[]) {
    super(); this.setMaxListeners(100);
    this.journal = new LaunchJournal(database, () => this.publishAll());
    for (const target of targets) {
      target.configVersion = database.registerProfile(target.id, target.session, JSON.stringify({ fingerprint: target.fingerprint, locations: target.locations }), target.locations);
      this.configVersions.set(target.id, target.configVersion);
      const supervisor = new TargetSupervisor(target, () => this.publish(supervisor));
      if (target.enabled === false) supervisor.error = 'profile_disabled';
      this.supervisors.set(target.id, supervisor);
      this.publish(supervisor);
    }
  }
  start() { for (const supervisor of this.supervisors.values()) if (supervisor.target.enabled !== false) void supervisor.start(); }
  async close() { for (const supervisor of this.supervisors.values()) supervisor.stop(); await this.journal.stop(); this.removeAllListeners(); }
  bootstrap(): Bootstrap {
    const projections = [...this.projections.values()];
    return { projections, projects: projections.flatMap((projection) => projection.projects), threads: projections.flatMap((projection) => projection.threads), machines: [...this.supervisors.values()].map((supervisor) => ({ id: supervisor.target.id, name: supervisor.target.name, session: supervisor.target.session, connected: supervisor.connected, projectPaths: Object.fromEntries(supervisor.target.locations.map((location) => [location.projectId, location.path])), harnesses: [], error: supervisor.error, writable: supervisor.target.writable, configVersion: this.configVersions.get(supervisor.target.id) })) };
  }
  private machine(supervisor: TargetSupervisor): Machine { return { id: supervisor.target.id, name: supervisor.target.name, session: supervisor.target.session, connected: supervisor.connected, configVersion: supervisor.target.configVersion, writable: supervisor.target.writable, error: supervisor.error, projectPaths: Object.fromEntries(supervisor.target.locations.map((location) => [location.projectId, location.path])), harnesses: [] }; }
  async catalog(machineId: string, projectId?: string) {
    const supervisor = this.supervisors.get(machineId);
    if (!supervisor?.connected) throw new Error('machine_disconnected');
    if (projectId && !supervisor.target.locations.some((location) => location.projectId === projectId)) throw new Error('unknown_project_location');
    const key = JSON.stringify([machineId, supervisor.target.fingerprint, supervisor.target.session, supervisor.target.configVersion, projectId]);
    const existing = this.catalogs.get(key);
    if (existing && existing.expires > Date.now()) return existing.value;
    const value = supervisor.target.catalog(projectId);
    this.catalogs.set(key, { expires: Date.now() + 30_000, value });
    try { return await value; } catch (error) { this.catalogs.delete(key); throw error; }
  }
  refreshCatalog(machineId: string) {
    for (const key of this.catalogs.keys()) if (JSON.parse(key)[0] === machineId) this.catalogs.delete(key);
    this.supervisors.get(machineId)?.invalidate();
  }
  binding(machineId: string, threadId: string, terminalId: string) {
    const supervisor = this.supervisors.get(machineId);
    const projection = this.projections.get(machineId);
    const thread = projection?.threads.find((thread) => thread.id === threadId);
    if (!supervisor?.connected || !thread || thread.bindingFingerprint !== supervisor.target.fingerprint || thread.bindingConfigVersion !== supervisor.target.configVersion || thread.session !== supervisor.target.session || thread.bindingState !== 'attached' || !thread.panes.some((pane) => pane.terminalId === terminalId)) throw new Error('binding_invalid');
    return supervisor.target;
  }
  async adopt(machineId: string, threadId: string, terminalIds: string[]) {
    const supervisor = this.supervisors.get(machineId);
    const row = this.database.threadRows(machineId).find((row) => row.id === threadId);
    if (!supervisor?.connected || !row || !terminalIds.length || new Set(terminalIds).size !== terminalIds.length) throw new Error('invalid_adoption');
    const snapshot = await supervisor.readFresh();
    const panes = snapshot.panes.filter((pane) => terminalIds.includes(pane.terminal_id));
    const tab = panes[0]?.tab_id;
    if (panes.length !== terminalIds.length || !tab || panes.some((pane) => pane.tab_id !== tab) || snapshot.panes.filter((pane) => pane.tab_id === tab).length !== panes.length) throw new Error('invalid_adoption');
    if (this.projections.get(machineId)?.threads.some((other) => other.id !== threadId && other.bindingState === 'attached' && other.tabId === tab)) throw new Error('binding_conflict');
    this.database.saveThread({ ...row.metadata, session: supervisor.target.session, tabId: tab, bindingFingerprint: supervisor.target.fingerprint, bindingConfigVersion: supervisor.target.configVersion, semanticSignature: undefined }, terminalIds, tab); this.publish(supervisor);
  }
  async focusPane(machineId: string, threadId: string, paneId: string) {
    const supervisor = this.supervisors.get(machineId);
    const thread = this.projections.get(machineId)?.threads.find((thread) => thread.id === threadId);
    if (!supervisor?.connected || !thread?.panes.some((pane) => pane.id === paneId) || !supervisor.target.focusPane) throw new Error('invalid_focus');
    await supervisor.target.focusPane(paneId);
  }
  archive(machineId: string, threadId: string, archived: boolean) {
    const supervisor = this.supervisors.get(machineId);
    const row = this.database.threadRows(machineId).find((row) => row.id === threadId);
    if (!supervisor || !row) throw new Error('thread_not_found');
    this.database.saveThread({ ...row.metadata, archivedAt: archived ? new Date().toISOString() : undefined }, row.anchors, row.alias);
    this.publish(supervisor);
  }
  async deleteThread(machineId: string, threadId: string) {
    const supervisor = this.supervisors.get(machineId);
    const thread = this.projections.get(machineId)?.threads.find((thread) => thread.id === threadId);
    if (!supervisor || !thread) throw new Error('thread_not_found');
    if (['pending', 'running'].includes(thread.operation?.state ?? '')) throw new Error('launch_in_progress');
    if (thread.bindingState === 'attached') {
      if (!supervisor.connected || !supervisor.target.discardTab) throw new Error('machine_disconnected');
      await supervisor.target.discardTab(thread.tabId);
      await supervisor.readFresh();
    }
    this.database.deleteThread(threadId);
    this.publish(supervisor);
  }
  async deleteArchived() {
    const archived = [...this.projections.values()].flatMap((projection) => projection.threads.filter((thread) => thread.archivedAt));
    const failed: string[] = [];
    for (const thread of archived) await this.deleteThread(thread.machineId, thread.id).catch(() => failed.push(thread.id));
    return { deleted: archived.length - failed.length, failed };
  }
  private publishAll() { for (const supervisor of this.supervisors.values()) { this.publish(supervisor); supervisor.invalidate(); } }
  private publish(supervisor: TargetSupervisor) {
    const records = supervisor.snapshot ? reconcile(this.database, supervisor.target, supervisor.snapshot) : { threads: this.database.threadRows(supervisor.target.id).map((row) => ({ ...row.metadata, panes: [], bindingState: 'detached' as const, status: 'unknown' as const })), projects: [] };
    const previous = this.projections.get(supervisor.target.id);
    const projection: Projection = { machineId: supervisor.target.id, generation: supervisor.generation, revision: (previous?.revision ?? 0) + 1, freshAt: supervisor.freshAt, connected: supervisor.connected, error: supervisor.error, ...records, layouts: supervisor.snapshot?.layouts.map((layout) => ({ workspaceId: layout.workspace_id, tabId: layout.tab_id, area: layout.area, panes: layout.panes.map((pane) => ({ paneId: pane.pane_id, rect: pane.rect })) })) ?? [] };
    projection.threads = projection.threads.map((thread) => ({ ...thread, prompt: '', ...(!projection.connected ? { panes: [], status: 'unknown' as const, bindingState: 'detached' as const } : {}) }));
    projection.availableTabs = projection.connected ? supervisor.snapshot?.tabs.map((tab) => ({ tabId: tab.tab_id, workspaceId: tab.workspace_id, label: tab.label ?? tab.tab_id, bound: projection.threads.some((thread) => thread.bindingState === 'attached' && thread.tabId === tab.tab_id), panes: supervisor.snapshot!.panes.filter((pane) => pane.tab_id === tab.tab_id && pane.workspace_id === tab.workspace_id).map((pane) => ({ id: pane.pane_id, terminalId: pane.terminal_id, title: pane.title ?? pane.agent ?? 'Shell' })) })) ?? [] : [];
    projection.machine = this.machine(supervisor);
    const semantic = (value: Projection) => JSON.stringify({ ...value, revision: 0, freshAt: null });
    if (previous && semantic(previous) === semantic(projection) && (!projection.freshAt || Date.parse(projection.freshAt) - Date.parse(previous.freshAt ?? '') < 30_000)) return;
    this.projections.set(supervisor.target.id, projection);
    if (!projection.connected) for (const key of this.catalogs.keys()) if (JSON.parse(key)[0] === supervisor.target.id) this.catalogs.delete(key);
    this.emit('projection', projection);
  }
}
