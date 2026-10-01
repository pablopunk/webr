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
      this.configVersions.set(target.id, database.registerProfile(target.id, target.session, JSON.stringify({ name: target.name, locations: target.locations }), target.locations));
      const supervisor = new TargetSupervisor(target, () => this.publish(supervisor));
      this.supervisors.set(target.id, supervisor);
      this.publish(supervisor);
    }
  }
  start() { for (const supervisor of this.supervisors.values()) void supervisor.start(); }
  async close() { for (const supervisor of this.supervisors.values()) supervisor.stop(); await this.journal.stop(); this.removeAllListeners(); }
  bootstrap(): Bootstrap {
    const projections = [...this.projections.values()];
    return { projections, projects: projections.flatMap((projection) => projection.projects), threads: projections.flatMap((projection) => projection.threads), machines: [...this.supervisors.values()].map((supervisor) => ({ id: supervisor.target.id, name: supervisor.target.name, session: supervisor.target.session, connected: supervisor.connected, projectPaths: Object.fromEntries(supervisor.target.locations.map((location) => [location.projectId, location.path])), harnesses: [], error: supervisor.error, writable: supervisor.target.writable, configVersion: this.configVersions.get(supervisor.target.id) })) };
  }
  async catalog(machineId: string) {
    const supervisor = this.supervisors.get(machineId);
    if (!supervisor?.connected) throw new Error('machine_disconnected');
    const existing = this.catalogs.get(machineId);
    if (existing && existing.expires > Date.now()) return existing.value;
    const value = supervisor.target.catalog();
    this.catalogs.set(machineId, { expires: Date.now() + 30_000, value });
    try { return await value; } catch (error) { this.catalogs.delete(machineId); throw error; }
  }
  binding(machineId: string, threadId: string, terminalId: string) {
    const supervisor = this.supervisors.get(machineId);
    const projection = this.projections.get(machineId);
    const thread = projection?.threads.find((thread) => thread.id === threadId);
    if (!supervisor?.connected || !thread || thread.bindingState !== 'attached' || !thread.panes.some((pane) => pane.terminalId === terminalId)) throw new Error('binding_invalid');
    return supervisor.target;
  }
  adopt(machineId: string, threadId: string, terminalIds: string[]) {
    const supervisor = this.supervisors.get(machineId);
    const row = this.database.threadRows(machineId, supervisor?.target.session).find((row) => row.id === threadId);
    if (!supervisor?.connected || !row || !terminalIds.length || !terminalIds.every((id) => supervisor.snapshot?.panes.some((pane) => pane.terminal_id === id))) throw new Error('invalid_adoption');
    if (this.database.threadRows(machineId, supervisor.target.session).some((other) => other.id !== threadId && other.anchors.some((anchor) => terminalIds.includes(anchor)))) throw new Error('binding_conflict');
    this.database.saveThread(row.metadata, terminalIds, row.alias); this.publish(supervisor);
  }
  private publishAll() { for (const supervisor of this.supervisors.values()) { this.publish(supervisor); supervisor.invalidate(); } }
  private publish(supervisor: TargetSupervisor) {
    const records = supervisor.snapshot ? reconcile(this.database, supervisor.target, supervisor.snapshot) : { threads: this.database.threadRows(supervisor.target.id, supervisor.target.session).map((row) => ({ ...row.metadata, panes: [], bindingState: 'detached' as const, status: 'unknown' as const })), projects: [] };
    const previous = this.projections.get(supervisor.target.id);
    const projection: Projection = { machineId: supervisor.target.id, generation: supervisor.generation, revision: (previous?.revision ?? 0) + 1, freshAt: supervisor.freshAt, connected: supervisor.connected, error: supervisor.error, ...records, layouts: supervisor.snapshot?.layouts.map((layout) => ({ workspaceId: layout.workspace_id, tabId: layout.tab_id, area: layout.area, panes: layout.panes.map((pane) => ({ paneId: pane.pane_id, rect: pane.rect })) })) ?? [] };
    projection.threads = projection.threads.map((thread) => ({ ...thread, prompt: '', ...(!projection.connected ? { panes: [], status: 'unknown' as const, bindingState: 'detached' as const } : {}) }));
    this.projections.set(supervisor.target.id, projection);
    if (!projection.connected) this.catalogs.delete(supervisor.target.id);
    this.emit('projection', projection);
  }
}
