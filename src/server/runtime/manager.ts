import { EventEmitter } from 'node:events';
import type { NativeSnapshot } from '../protocol/native';
import type { TargetAdapter } from './target';
import type { Thread, TitleSync } from '../../lib/models';
import { canClosePane, insertAfter } from '../../lib/pane-strip';
import { TargetSupervisor } from './supervisor';
import { projectIconKey, reconcile } from './reconcile';
import { imageExtension } from '../uploads';
import type { Icon } from '../transport/icons';
import type { MetadataDatabase } from '../storage/database';
import type { Bootstrap, Projection, ProjectRenameResponse, ThreadArchiveResponse, ThreadMetadataAcknowledgement, ThreadRenameResponse } from '../../shared/runtime';
import type { Machine } from '../../lib/machines';
import { LaunchJournal, type LaunchTargetIdentity } from './launch';
import { isListedThread } from '../../lib/launch';
import { isSameOrSiblingWorktree, sameSession } from './recovery';
import { createWorkspace, type CreatedWorkspace } from './workspace';

const CATALOG_TTL_MS = 5 * 60_000;
const MODELS_PENDING_TTL_MS = 500;
const PENDING_TERMINAL_TTL_MS = 30_000;
type AvailableTab = NonNullable<Projection['availableTabs']>[number];
type PendingTerminalTab = { tab: AvailableTab; timer: ReturnType<typeof setTimeout> };
type TitleSyncJob = { machineId: string; threadId: string; version: number; title: string; tabId: string; renameWorkspace: boolean };
type TitleSyncQueue = { pending?: TitleSyncJob; running: boolean; stopped: boolean };
const TITLE_SYNC_TIMEOUT_MS = 5000;
const threadMetadataAcknowledgement = (thread: Thread): ThreadMetadataAcknowledgement => ({
  entityId: thread.id,
  metadataVersion: thread.metadataVersion,
  metadata: { titleOverride: thread.titleOverride ?? null, archivedAt: thread.archivedAt ?? null },
});

export class RuntimeManager extends EventEmitter {
  readonly supervisors = new Map<string, TargetSupervisor>();
  readonly journal: LaunchJournal;
  private projections = new Map<string, Projection>();
  private catalogs = new Map<string, { expires: number; value: Promise<Machine> }>();
  private configVersions = new Map<string, number>();
  private pendingTerminalTabs = new Map<string, Map<string, PendingTerminalTab>>();
  private titleSyncQueues = new Map<string, TitleSyncQueue>();
  private started = false;
  private closed = false;
  constructor(readonly database: MetadataDatabase, targets: TargetAdapter[]) {
    super(); this.setMaxListeners(100);
    database.markInterruptedTitleSyncs();
    this.journal = new LaunchJournal(database, () => this.publishAll());
    for (const target of targets) this.addTarget(target);
  }
  addTarget(target: TargetAdapter) {
    if (this.closed || this.supervisors.has(target.id)) return;
    target.configVersion = this.database.registerProfile(target.id, target.session, JSON.stringify({ fingerprint: target.fingerprint, locations: target.locations }), target.locations);
    this.configVersions.set(target.id, target.configVersion);
    const supervisor = new TargetSupervisor(target, () => this.publish(supervisor));
    if (target.enabled === false) supervisor.error = 'profile_disabled';
    this.supervisors.set(target.id, supervisor);
    this.publish(supervisor);
    if (this.started && target.enabled !== false) void supervisor.start();
  }
  start() { this.started = true; for (const supervisor of this.supervisors.values()) if (supervisor.target.enabled !== false) void supervisor.start(); }
  async close() {
    this.closed = true;
    for (const queue of this.titleSyncQueues.values()) { queue.pending = undefined; queue.stopped = true; }
    this.titleSyncQueues.clear();
    for (const tabs of this.pendingTerminalTabs.values()) {
      for (const pending of tabs.values()) clearTimeout(pending.timer);
      tabs.clear();
    }
    this.pendingTerminalTabs.clear();
    for (const supervisor of this.supervisors.values()) supervisor.stop();
    await this.journal.stop(); this.removeAllListeners();
  }
  bootstrap(owner = 'local'): Bootstrap {
    const projections = [...this.projections.values()];
    return { projections, projects: projections.flatMap((projection) => projection.projects), threads: projections.flatMap((projection) => projection.threads), machines: [...this.supervisors.values()].map((supervisor) => ({ id: supervisor.target.id, name: supervisor.target.name, session: supervisor.target.session, connected: supervisor.connected, projectPaths: Object.fromEntries(supervisor.target.locations.map((location) => [location.projectId, location.path])), harnesses: [], error: supervisor.error, writable: supervisor.target.writable, os: supervisor.target.os, configVersion: this.configVersions.get(supervisor.target.id) })), recoveryScope: this.database.recoveryScope(owner) };
  }
  isLaunchTargetCurrent(target: TargetAdapter, identity: LaunchTargetIdentity) {
    const supervisor = this.supervisors.get(target.id);
    if (!supervisor || !supervisor.connected) return false;
    return supervisor.target === target && target.fingerprint === identity.fingerprint && target.session === identity.session && target.configVersion === identity.configVersion;
  }
  private machine(supervisor: TargetSupervisor): Machine { return { id: supervisor.target.id, name: supervisor.target.name, session: supervisor.target.session, connected: supervisor.connected, configVersion: supervisor.target.configVersion, writable: supervisor.target.writable, os: supervisor.target.os, error: supervisor.error, projectPaths: Object.fromEntries(supervisor.target.locations.map((location) => [location.projectId, location.path])), harnesses: [] }; }
  async catalog(machineId: string, projectId?: string) {
    const supervisor = this.supervisors.get(machineId);
    if (!supervisor?.connected) throw new Error('machine_disconnected');
    if (projectId && !supervisor.target.locations.some((location) => location.projectId === projectId)) throw new Error('unknown_project_location');
    const key = JSON.stringify([machineId, supervisor.target.fingerprint, supervisor.target.session, supervisor.target.configVersion]);
    const existing = this.catalogs.get(key);
    if (existing && existing.expires > Date.now()) return existing.value;
    const value = supervisor.target.catalog(projectId);
    this.catalogs.set(key, { expires: Date.now() + CATALOG_TTL_MS, value });
    try {
      const catalog = await value;
      if (catalog.modelsPending) this.catalogs.set(key, { expires: Date.now() + MODELS_PENDING_TTL_MS, value });
      return catalog;
    } catch (error) { this.catalogs.delete(key); throw error; }
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
  terminalBinding(machineId: string, terminalId: string, ref: { threadId?: string; tabId?: string }) {
    if (ref.threadId) return this.binding(machineId, ref.threadId, terminalId);
    const supervisor = this.supervisors.get(machineId);
    const projection = this.projections.get(machineId);
    const tab = ref.tabId && projection?.availableTabs?.find((item) => item.tabId === ref.tabId && !item.bound && item.panes.some((pane) => pane.terminalId === terminalId));
    if (!supervisor?.connected || !projection?.connected || !tab) throw new Error('binding_invalid');
    return supervisor.target;
  }
  async createTerminal(machineId: string, path: string, key: string): Promise<CreatedWorkspace> {
    const supervisor = this.supervisors.get(machineId);
    if (!supervisor?.connected) throw new Error('machine_disconnected');
    if (!supervisor.target.writable) throw new Error('workspace_creation_unavailable');
    const created = await createWorkspace(this.database, supervisor.target, key, path, 'Terminal');
    this.registerPendingTerminal(supervisor, created);
    supervisor.invalidate();
    return created;
  }
  private registerPendingTerminal(supervisor: TargetSupervisor, created: CreatedWorkspace) {
    let machineTabs = this.pendingTerminalTabs.get(supervisor.target.id);
    if (!machineTabs) this.pendingTerminalTabs.set(supervisor.target.id, machineTabs = new Map());
    const previous = machineTabs.get(created.tabId);
    if (previous) clearTimeout(previous.timer);
    const tab: AvailableTab = {
      tabId: created.tabId, workspaceId: created.workspaceId, label: 'Terminal', bound: false,
      panes: [{ id: created.paneId, terminalId: created.terminalId, title: 'Shell' }],
    };
    const pending: PendingTerminalTab = { tab, timer: setTimeout(() => {
      if (this.closed || machineTabs?.get(created.tabId) !== pending) return;
      machineTabs.delete(created.tabId);
      if (!machineTabs.size) this.pendingTerminalTabs.delete(supervisor.target.id);
      this.publish(supervisor);
    }, PENDING_TERMINAL_TTL_MS) };
    pending.timer.unref();
    machineTabs.set(created.tabId, pending);
    this.publish(supervisor);
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
    const reports = panes.filter((pane) => pane.agent_session);
    if (row.metadata.providerSession && (reports.length !== 1 || !sameSession(row.metadata.providerSession, reports[0].agent_session!))) throw new Error('conversation_changed');
    if (reports.length > 1) throw new Error('conversation_conflict');
    const report = reports[0];
    const worktree = snapshot.workspaces.find((workspace) => workspace.workspace_id === report?.workspace_id)?.worktree;
    const cwd = report?.foreground_cwd ?? report?.cwd;
    if (report && (!cwd || report.agent && report.agent !== report.agent_session!.agent || row.metadata.expectedCwd && row.metadata.expectedCwd !== cwd && !(row.metadata.providerSession && isSameOrSiblingWorktree(row.metadata.expectedCwd, cwd!)) || row.metadata.expectedRepository && worktree?.repo_key !== row.metadata.expectedRepository || row.metadata.expectedCheckout && worktree?.checkout_path !== row.metadata.expectedCheckout)) throw new Error('worktree_changed');
    const identity = report ? { providerSession: report.agent_session!, expectedCwd: cwd!, observedCwd: cwd!, expectedRepository: row.metadata.expectedRepository ?? worktree?.repo_key, expectedCheckout: row.metadata.expectedCheckout ?? worktree?.checkout_path, agent: report.agent_session!.agent } : {};
    this.database.saveThread({ ...row.metadata, ...identity, session: supervisor.target.session, tabId: tab, bindingFingerprint: supervisor.target.fingerprint, bindingConfigVersion: supervisor.target.configVersion, semanticSignature: undefined }, terminalIds, tab); this.publish(supervisor);
  }
  private workspacesWithThreads(machineId: string) {
    const shownTabs = new Set(this.projections.get(machineId)?.threads.filter((thread) => thread.bindingState === 'attached' && !thread.archivedAt).map((thread) => thread.tabId));
    return new Set(this.supervisors.get(machineId)?.snapshot?.tabs.filter((tab) => shownTabs.has(tab.tab_id)).map((tab) => tab.workspace_id));
  }
  private worktreeSupervisor(machineId: string) {
    const supervisor = this.supervisors.get(machineId);
    if (!supervisor?.connected || !supervisor.target.worktrees || !supervisor.target.openWorktree) throw new Error('machine_disconnected');
    return supervisor;
  }
  async worktrees(machineId: string, projectId: string) {
    const supervisor = this.worktreeSupervisor(machineId);
    const shown = this.workspacesWithThreads(machineId);
    const entries = await supervisor.target.worktrees!(projectId);
    return entries.filter((entry) => !entry.is_bare && !entry.is_prunable && !(entry.open_workspace_id && shown.has(entry.open_workspace_id))).map((entry) => ({ path: entry.path, branch: entry.branch ?? null, label: entry.label }));
  }
  async openWorktree(machineId: string, projectId: string, path: string) {
    const supervisor = this.worktreeSupervisor(machineId);
    if (!(await this.worktrees(machineId, projectId)).some((worktree) => worktree.path === path)) throw new Error('unknown_worktree');
    await supervisor.target.openWorktree!(projectId, path);
    const snapshot = await supervisor.readFresh(); this.publish(supervisor);
    const workspace = snapshot.workspaces.find((workspace) => workspace.worktree?.checkout_path === path);
    const tab = snapshot.tabs.find((tab) => tab.workspace_id === workspace?.workspace_id);
    const thread = this.projections.get(machineId)?.threads.find((thread) => thread.tabId === tab?.tab_id && thread.bindingState === 'attached');
    if (!thread) throw new Error('worktree_not_opened');
    if (thread.archivedAt) this.archive(machineId, thread.id, false);
    return { id: thread.id };
  }
  async focusPane(machineId: string, threadId: string, paneId: string) {
    const supervisor = this.supervisors.get(machineId);
    const thread = this.projections.get(machineId)?.threads.find((thread) => thread.id === threadId);
    if (!supervisor || !supervisor.connected) throw new Error('invalid_focus');
    if (!supervisor.target.writable) throw new Error('read_only');
    if (!thread?.panes.some((pane) => pane.id === paneId) || !supervisor.target.focusPane) throw new Error('invalid_focus');
    await supervisor.target.focusPane(paneId);
    const acked = this.clearDoneBadge(machineId, threadId);
    // Do not publish here: supervisor.snapshot is stale (pre-focus, still
    // done) and a synchronous publish would re-latch the badge we just
    // cleared. Invalidate instead so the next refresh reads post-focus state.
    supervisor.invalidate();
    return { focused: true, acked };
  }
  clearDoneBadge(machineId: string, threadId: string) {
    const supervisor = this.supervisors.get(machineId);
    const row = this.database.threadRows(machineId).find((row) => row.id === threadId);
    if (!supervisor || !row || row.metadata.unseenDone !== true) return false;
    this.database.saveThread({ ...row.metadata, unseenDone: false }, row.anchors, row.alias);
    return true;
  }
  archive(machineId: string, threadId: string, archived: boolean): ThreadArchiveResponse {
    const supervisor = this.supervisors.get(machineId);
    if (!supervisor) throw new Error('thread_not_found');
    const mutation = this.database.updateThreadMetadata(machineId, threadId, { archived });
    if (!mutation) throw new Error('thread_not_found');
    this.publish(supervisor);
    return { ...threadMetadataAcknowledgement(mutation.metadata), archived: !!mutation.metadata.archivedAt };
  }
  renameProject(machineId: string, logicalId: string, name: string): ProjectRenameResponse {
    const supervisor = this.supervisors.get(machineId);
    if (!supervisor) throw new Error('machine_disconnected');
    const project = this.projections.get(machineId)?.projects.find((project) => project.logicalId === logicalId);
    const mutation = this.database.updateProjectName(machineId, logicalId, name.trim(), project?.name);
    this.publish(supervisor);
    const canonicalName = mutation.name ?? name.trim();
    return { machineId, entityId: logicalId, metadataVersion: mutation.metadataVersion, metadata: { name: canonicalName }, name: canonicalName };
  }
  setProjectIcon(machineId: string, logicalId: string, contentType: string | undefined, bytes: Buffer) {
    const supervisor = this.supervisors.get(machineId);
    if (!supervisor) throw new Error('machine_disconnected');
    imageExtension(contentType, bytes);
    this.database.setSetting(projectIconKey(machineId, logicalId), `${contentType!.split(';')[0].trim()}|${bytes.toString('base64')}`);
    this.publish(supervisor);
  }
  resetProjectIcon(machineId: string, logicalId: string) {
    const supervisor = this.supervisors.get(machineId);
    if (!supervisor) throw new Error('machine_disconnected');
    this.database.deleteSetting(projectIconKey(machineId, logicalId));
    this.publish(supervisor);
  }
  customProjectIcon(machineId: string, projectId: string): Icon | undefined {
    const logicalId = this.projections.get(machineId)?.projects.find((project) => project.id === projectId)?.logicalId;
    const stored = logicalId && this.database.getSetting(projectIconKey(machineId, logicalId));
    if (!stored) return;
    const [contentType, data] = stored.split('|');
    return { contentType, bytes: Buffer.from(data, 'base64') };
  }
  renameThread(machineId: string, threadId: string, title: string | null): ThreadRenameResponse {
    const supervisor = this.supervisors.get(machineId);
    const thread = this.projections.get(machineId)?.threads.find((thread) => thread.id === threadId);
    const row = this.database.threadRows(machineId).find((row) => row.id === threadId);
    if (!supervisor || !row) throw new Error('thread_not_found');
    const normalizedTitle = title === null ? null : title.trim();
    const queueKey = this.titleSyncQueueKey(machineId, threadId);
    const queueStopped = this.titleSyncQueues.get(queueKey)?.stopped === true;
    const canSync = normalizedTitle !== null && thread?.bindingState === 'attached' && supervisor.connected && !!supervisor.target.renameTab && !queueStopped;
    const mutation = this.database.updateThreadMetadata(machineId, threadId, {
      titleOverride: normalizedTitle,
      titleSyncState: canSync ? 'pending' : 'unknown',
    });
    if (!mutation) throw new Error('thread_not_found');
    if (normalizedTitle === null || (mutation.titleChanged && !canSync)) this.cancelUnsentTitleSync(machineId, threadId);
    this.publish(supervisor);
    if (mutation.titleChanged && canSync && thread) this.enqueueTitleSync({
      machineId, threadId, version: mutation.metadata.titleSync.version, title: normalizedTitle!,
      tabId: thread.tabId, renameWorkspace: !!thread.ownsWorktree,
    });
    return {
      ...threadMetadataAcknowledgement(mutation.metadata),
      title: mutation.metadata.titleOverride ?? mutation.metadata.title,
    };
  }
  private titleSyncQueueKey(machineId: string, threadId: string) { return JSON.stringify([machineId, threadId]); }
  private enqueueTitleSync(job: TitleSyncJob) {
    if (this.closed) return;
    const key = this.titleSyncQueueKey(job.machineId, job.threadId);
    let queue = this.titleSyncQueues.get(key);
    if (queue?.stopped) return;
    if (!queue) this.titleSyncQueues.set(key, queue = { running: false, stopped: false });
    queue.pending = job;
    if (queue.running) return;
    queue.running = true;
    setImmediate(() => { void this.drainTitleSyncQueue(key, queue!); });
  }
  private cancelUnsentTitleSync(machineId: string, threadId: string) {
    const key = this.titleSyncQueueKey(machineId, threadId);
    const queue = this.titleSyncQueues.get(key);
    if (!queue) return;
    queue.pending = undefined;
    if (!queue.running && !queue.stopped) this.titleSyncQueues.delete(key);
  }
  private async drainTitleSyncQueue(key: string, queue: TitleSyncQueue) {
    try {
      while (!this.closed && this.titleSyncQueues.get(key) === queue && !queue.stopped && queue.pending) {
        const job = queue.pending;
        queue.pending = undefined;
        const supervisor = this.supervisors.get(job.machineId);
        if (!supervisor?.connected || !supervisor.target.renameTab) {
          this.finishTitleSync(job, 'unknown');
          continue;
        }
        const attempt = Promise.resolve().then(async () => {
          await supervisor.target.renameTab!(job.tabId, job.title, job.renameWorkspace);
          await supervisor.readFresh();
        });
        let timedOut = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { timedOut = true; reject(new Error('title_sync_timeout')); }, TITLE_SYNC_TIMEOUT_MS);
          timer.unref();
        });
        try {
          await Promise.race([attempt, timeout]);
          if (!this.closed) this.finishTitleSync(job, 'synced');
        } catch {
          if (timedOut) {
            const abandoned = queue.pending;
            queue.stopped = true;
            queue.pending = undefined;
            if (!this.closed) {
              this.finishTitleSync(job, 'unknown');
              if (abandoned) this.finishTitleSync(abandoned, 'unknown');
            }
            void attempt.then(() => { if (!this.closed) this.finishTitleSync(job, 'synced'); }, () => {});
            break;
          }
          if (!this.closed) this.finishTitleSync(job, 'failed');
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
    } finally {
      queue.running = false;
      if (this.titleSyncQueues.get(key) !== queue) return;
      if (queue.stopped) return;
      if (queue.pending && !this.closed) {
        queue.running = true;
        setImmediate(() => { void this.drainTitleSyncQueue(key, queue); });
      } else this.titleSyncQueues.delete(key);
    }
  }
  private finishTitleSync(job: TitleSyncJob, state: TitleSync['state']) {
    if (!this.database.updateThreadTitleSync(job.machineId, job.threadId, job.version, state)) return;
    const supervisor = this.supervisors.get(job.machineId);
    if (supervisor) this.publish(supervisor);
  }
  async openTerminal(machineId: string, threadId: string, afterPaneId: string) {
    const { supervisor, thread } = this.attachedThread(machineId, threadId);
    if (!thread.panes.some((pane) => pane.id === afterPaneId) || !supervisor.target.splitTerminal) throw new Error('thread_not_found');
    const paneId = await supervisor.target.splitTerminal(afterPaneId, 'right');
    this.saveThreadMetadata(machineId, threadId, { paneOrder: insertAfter(thread.panes.map((pane) => pane.id), afterPaneId, paneId) });
    await supervisor.readFresh(); this.publish(supervisor);
    return { paneId };
  }
  async closePane(machineId: string, threadId: string, paneId: string, force: boolean) {
    const { supervisor, thread } = this.attachedThread(machineId, threadId);
    if (!canClosePane(thread, paneId)) return { closed: false, busy: false };
    if (!force && await supervisor.target.paneBusy?.(paneId)) return { closed: false, busy: true };
    await supervisor.target.closePane?.(paneId);
    await supervisor.readFresh(); this.publish(supervisor);
    return { closed: true, busy: false };
  }
  async closeTab(machineId: string, tabId: string, force: boolean) {
    const supervisor = this.supervisors.get(machineId);
    if (!supervisor?.connected) throw new Error('machine_disconnected');
    if (!supervisor.target.writable || !supervisor.target.discardTab) throw new Error('read_only');
    if (this.launchInProgress(machineId)) throw new Error('launch_in_progress');
    const snapshot = await supervisor.readFresh();
    const tab = snapshot.tabs.find((item) => item.tab_id === tabId);
    if (!tab) throw new Error('tab_not_found');
    if (this.listedThreadOwnsTab(machineId, tabId)) throw new Error('binding_conflict');
    const panes = snapshot.panes.filter((pane) => pane.tab_id === tabId);
    if (!force && supervisor.target.paneBusy) {
      for (const pane of panes) {
        if (await supervisor.target.paneBusy(pane.pane_id)) return { closed: false, busy: true };
      }
    }
    const pending = this.pendingTerminalTabs.get(machineId)?.get(tabId);
    try { await supervisor.target.discardTab(tabId, false); }
    catch { /* A failed Herdr reply can still mean the tab closed; verify its snapshot below. */ }
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingTerminalTabs.get(machineId)?.delete(tabId);
      if (!this.pendingTerminalTabs.get(machineId)?.size) this.pendingTerminalTabs.delete(machineId);
    }
    const fresh = await supervisor.readFresh();
    this.publish(supervisor);
    return fresh.tabs.some((item) => item.tab_id === tabId) ? { closed: false, busy: false } : { closed: true, busy: false };
  }
  private attachedThread(machineId: string, threadId: string) {
    const supervisor = this.supervisors.get(machineId);
    const thread = this.projections.get(machineId)?.threads.find((thread) => thread.id === threadId);
    if (!supervisor || !thread) throw new Error('thread_not_found');
    if (!supervisor.connected || thread.bindingState !== 'attached') throw new Error('machine_disconnected');
    return { supervisor, thread };
  }
  private saveThreadMetadata(machineId: string, threadId: string, change: Partial<Thread>) {
    const row = this.database.threadRows(machineId).find((row) => row.id === threadId);
    if (row) this.database.saveThread({ ...row.metadata, ...change }, row.anchors, row.alias);
  }
  async deleteThread(machineId: string, threadId: string) {
    const supervisor = this.supervisors.get(machineId);
    const thread = this.projections.get(machineId)?.threads.find((thread) => thread.id === threadId);
    if (!supervisor || !thread) throw new Error('thread_not_found');
    if (['pending', 'running'].includes(thread.operation?.state ?? '')) throw new Error('launch_in_progress');
    if (thread.bindingState === 'attached') {
      if (!supervisor.connected || !supervisor.target.discardTab) throw new Error('machine_disconnected');
      await supervisor.target.discardTab(thread.tabId, !!thread.ownsWorktree);
      await supervisor.readFresh();
    }
    this.database.deleteThread(threadId);
    this.publish(supervisor);
  }
  async deleteArchived() {
    const archived = [...this.projections.values()].flatMap((projection) => projection.threads.filter((thread) => thread.archivedAt));
    const failed: string[] = [];
    const skippedMachines: string[] = [];
    let deleted = 0;
    let orphanTabsDeleted = 0;
    for (const thread of archived) {
      try { await this.deleteThread(thread.machineId, thread.id); ++deleted; }
      catch { failed.push(thread.id); }
    }
    for (const supervisor of this.supervisors.values()) {
      const machineId = supervisor.target.id;
      if (!supervisor.connected) { skippedMachines.push(machineId); continue; }
      let snapshot: NativeSnapshot;
      try { snapshot = await supervisor.readFresh(); }
      catch { skippedMachines.push(machineId); continue; }
      const orphanTabs = snapshot.tabs.filter((tab) => !this.threadOwnsTab(machineId, tab.tab_id)).map((tab) => tab.tab_id);
      for (const tabId of orphanTabs) {
        if (!supervisor.connected || !supervisor.target.writable || !supervisor.target.discardTab) {
          skippedMachines.push(machineId);
          break;
        }
        try { snapshot = await supervisor.readFresh(); }
        catch { skippedMachines.push(machineId); break; }
        if (!supervisor.connected || this.launchInProgress(machineId)) { skippedMachines.push(machineId); break; }
        if (!snapshot.tabs.some((tab) => tab.tab_id === tabId) || this.threadOwnsTab(machineId, tabId)) continue;
        try { await supervisor.target.discardTab(tabId, false); }
        catch { /* A failed Herdr reply can still mean the tab closed; verify its snapshot below. */ }
        try { snapshot = await supervisor.readFresh(); }
        catch { failed.push(`${machineId}:${tabId}`); skippedMachines.push(machineId); break; }
        const remains = snapshot.tabs.some((tab) => tab.tab_id === tabId);
        if (!remains) ++orphanTabsDeleted;
        else if (!this.threadOwnsTab(machineId, tabId)) failed.push(`${machineId}:${tabId}`);
      }
    }
    return { deleted, orphanTabsDeleted, failed, skippedMachines: [...new Set(skippedMachines)] };
  }
  private listedThreadOwnsTab(machineId: string, tabId: string) {
    return this.database.threadRows(machineId).some((row) => row.alias === tabId && isListedThread(row.metadata))
      || this.projections.get(machineId)?.threads.some((thread) => thread.tabId === tabId && isListedThread(thread)) === true;
  }
  private threadOwnsTab(machineId: string, tabId: string) {
    return this.database.threadRows(machineId).some((row) => row.alias === tabId)
      || this.projections.get(machineId)?.threads.some((thread) => thread.tabId === tabId) === true;
  }
  private launchInProgress(machineId: string) {
    return this.database.operations().some((operation) => operation.input.machineId === machineId && ['pending', 'running'].includes(operation.state));
  }

  private publishAll() { for (const supervisor of this.supervisors.values()) { this.publish(supervisor); supervisor.invalidate(); } }
  private publish(supervisor: TargetSupervisor) {
    try {
      this.buildProjection(supervisor);
    } catch (error) {
      console.error(`projection for ${supervisor.target.id} skipped:`, error instanceof Error ? error.message : error);
    }
  }
  private buildProjection(supervisor: TargetSupervisor) {
    const previous = this.projections.get(supervisor.target.id);
    const records = supervisor.snapshot ? reconcile(this.database, supervisor.target, supervisor.snapshot) : {
      threads: this.database.threadRows(supervisor.target.id).map((row) => ({ ...row.metadata, panes: [], bindingState: 'detached' as const, status: 'unknown' as const })),
      projects: (previous?.projects ?? []).map((project) => {
        const logicalId = project.logicalId ?? project.id;
        return { ...project, name: this.database.projectName(supervisor.target.id, logicalId) ?? project.name, metadataVersion: this.database.projectMetadataVersion(supervisor.target.id, logicalId) };
      }),
    };
    const projection: Projection = { machineId: supervisor.target.id, generation: supervisor.generation, revision: (previous?.revision ?? 0) + 1, freshAt: supervisor.freshAt, connected: supervisor.connected, error: supervisor.error, ...records, layouts: supervisor.snapshot?.layouts.map((layout) => ({ workspaceId: layout.workspace_id, tabId: layout.tab_id, area: layout.area, panes: layout.panes.map((pane) => ({ paneId: pane.pane_id, rect: pane.rect })) })) ?? [] };
    projection.threads = projection.threads.map((thread) => ({ ...thread, prompt: '', ...(!projection.connected ? { panes: [], status: 'unknown' as const, bindingState: 'detached' as const, recovery: thread.providerSession ? { state: 'known' as const } : thread.recovery } : {}) }));
    const availableTabs = projection.connected ? supervisor.snapshot?.tabs.map((tab) => ({ tabId: tab.tab_id, workspaceId: tab.workspace_id, label: tab.label ?? tab.tab_id, bound: projection.threads.some((thread) => thread.bindingState === 'attached' && thread.tabId === tab.tab_id && isListedThread(thread)), panes: supervisor.snapshot!.panes.filter((pane) => pane.tab_id === tab.tab_id && pane.workspace_id === tab.workspace_id).map((pane) => ({ id: pane.pane_id, terminalId: pane.terminal_id, title: pane.title ?? pane.agent ?? 'Shell' })) })) ?? [] : [];
    const pending = this.pendingTerminalTabs.get(supervisor.target.id);
    for (const [tabId, entry] of pending ?? []) {
      const observed = availableTabs.find((tab) => tab.tabId === tabId);
      if (observed?.panes.some((pane) => pane.terminalId === entry.tab.panes[0]?.terminalId)) {
        clearTimeout(entry.timer);
        pending?.delete(tabId);
        continue;
      }
      if (observed) {
        const rootPane = entry.tab.panes[0];
        if (rootPane) observed.panes = [...observed.panes.filter((pane) => pane.id !== rootPane.id), rootPane];
      } else availableTabs.push(entry.tab);
    }
    if (pending && !pending.size) this.pendingTerminalTabs.delete(supervisor.target.id);
    projection.availableTabs = availableTabs;
    projection.machine = this.machine(supervisor);
    const semantic = (value: Projection) => JSON.stringify({ ...value, revision: 0, freshAt: null });
    if (previous && semantic(previous) === semantic(projection) && (!projection.freshAt || Date.parse(projection.freshAt) - Date.parse(previous.freshAt ?? '') < 30_000)) return;
    this.projections.set(supervisor.target.id, projection);
    if (!projection.connected) for (const key of this.catalogs.keys()) if (JSON.parse(key)[0] === supervisor.target.id) this.catalogs.delete(key);
    this.emit('projection', projection);
  }
}
