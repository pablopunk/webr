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
import { createOperationResult, parseCreateOperationInput, terminalCreateInput, worktreeOpenInput, workspaceCreateInput, type Bootstrap, type CreateOperationInput, type CreateOperationKind, type Projection, type ProjectRenameResponse, type ThreadArchiveResponse, type ThreadMetadataAcknowledgement, type ThreadRenameResponse } from '../../shared/runtime';
import type { Machine } from '../../lib/machines';
import { LaunchJournal, type LaunchTargetIdentity } from './launch';
import { isListedThread } from '../../lib/launch';
import { isSameOrSiblingWorktree, sameSession } from './recovery';
import { createOperationEnvelope, type CreatedWorkspace } from './workspace';

const CATALOG_TTL_MS = 5 * 60_000;
const MODELS_PENDING_TTL_MS = 500;
const PENDING_TERMINAL_TTL_MS = 30_000;
type AvailableTab = NonNullable<Projection['availableTabs']>[number];
type PendingTerminalTab = { tab: AvailableTab; timer: ReturnType<typeof setTimeout> };
type TitleSyncJob = { machineId: string; threadId: string; version: number; title: string; tabId: string; renameWorkspace: boolean };
type TitleSyncQueue = { pending?: TitleSyncJob; running: boolean; stopped: boolean };
type RuntimeTargetIdentity = { supervisor: TargetSupervisor; target: TargetAdapter; generation: string; fingerprint: string; session: string; configVersion: number };
const TITLE_SYNC_TIMEOUT_MS = 5000;
const paneActionRefused = () => new Error('pane_action_refused');
const readPaneActionSnapshot = async (supervisor: TargetSupervisor) => {
  try { return await supervisor.readFresh(); }
  catch (error) {
    if (error instanceof Error && error.message === 'snapshot_timeout') throw paneActionRefused();
    throw error;
  }
};
const threadMetadataAcknowledgement = (thread: Thread): ThreadMetadataAcknowledgement => ({
  entityId: thread.id,
  metadataVersion: thread.metadataVersion,
  metadata: { titleOverride: thread.titleOverride ?? null, archivedAt: thread.archivedAt ?? null },
});

export class RuntimeManager extends EventEmitter {
  readonly supervisors = new Map<string, TargetSupervisor>();
  readonly journal: LaunchJournal;
  private projections = new Map<string, Projection>();
  private projectedSnapshotRevisions = new Map<string, number>();
  private catalogs = new Map<string, { expires: number; value: Promise<Machine> }>();
  private configVersions = new Map<string, number>();
  private pendingTerminalTabs = new Map<string, Map<string, PendingTerminalTab>>();
  private titleSyncQueues = new Map<string, TitleSyncQueue>();
  private targetMutations = new Map<string, Promise<void>>();
  private createRuns = new Map<string, Promise<void>>();
  private deletingThreads = new Set<string>();
  private started = false;
  private closed = false;
  constructor(readonly database: MetadataDatabase, targets: TargetAdapter[]) {
    super(); this.setMaxListeners(100);
    database.compactLegacyWorkspaceOperations();
    database.markInterruptedTitleSyncs();
    database.markInterruptedCreateOperations();
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
    await Promise.all([this.journal.stop(), ...this.createRuns.values()]); this.removeAllListeners();
  }
  bootstrap(owner = 'local', resourceOwner = owner): Bootstrap {
    const projections = [...this.projections.values()];
    return { projections, projects: projections.flatMap((projection) => projection.projects), threads: projections.flatMap((projection) => projection.threads), machines: [...this.supervisors.values()].map((supervisor) => ({ id: supervisor.target.id, name: supervisor.target.name, session: supervisor.target.session, connected: supervisor.connected, projectPaths: Object.fromEntries(supervisor.target.locations.map((location) => [location.projectId, location.path])), harnesses: [], error: supervisor.error, writable: supervisor.target.writable, os: supervisor.target.os, configVersion: this.configVersions.get(supervisor.target.id) })), recoveryScope: this.database.recoveryScope(owner), resourceRecoveryScope: this.database.recoveryScope(resourceOwner) };
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
    const key = JSON.stringify([machineId, projectId ?? '', supervisor.target.fingerprint, supervisor.target.session, supervisor.target.configVersion]);
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
  private async withTargetMutation<T>(machineId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.targetMutations.get(machineId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.targetMutations.set(machineId, tail);
    await previous;
    try { return await action(); }
    finally {
      release();
      if (this.targetMutations.get(machineId) === tail) this.targetMutations.delete(machineId);
    }
  }
  private targetIdentity(supervisor: TargetSupervisor): RuntimeTargetIdentity {
    return { supervisor, target: supervisor.target, generation: supervisor.generation, fingerprint: supervisor.target.fingerprint, session: supervisor.target.session, configVersion: supervisor.target.configVersion };
  }
  private hasCurrentProjection(identity: RuntimeTargetIdentity) {
    const { supervisor, target, generation, fingerprint, session, configVersion } = identity;
    const projection = this.projections.get(target.id);
    return this.supervisors.get(target.id) === supervisor && supervisor.target === target && supervisor.generation === generation
      && target.fingerprint === fingerprint && target.session === session && target.configVersion === configVersion
      && supervisor.connected && !!supervisor.freshAt && this.projectedSnapshotRevisions.get(target.id) === supervisor.revision
      && projection?.connected === true && !!projection.freshAt && projection.generation === generation && projection.machine?.session === session && projection.machine?.configVersion === configVersion;
  }
  private requireCurrentProjection(identity: RuntimeTargetIdentity) {
    if (!this.hasCurrentProjection(identity)) throw new Error('machine_disconnected');
    return this.projections.get(identity.target.id)!;
  }
  private matchesTargetIdentity(thread: Thread, identity: RuntimeTargetIdentity) {
    return thread.bindingFingerprint === identity.fingerprint && thread.bindingConfigVersion === identity.configVersion && thread.session === identity.session;
  }
  binding(machineId: string, threadId: string, terminalId: string) {
    const supervisor = this.supervisors.get(machineId);
    if (!supervisor) throw new Error('binding_invalid');
    const identity = this.targetIdentity(supervisor);
    const projection = this.requireCurrentProjection(identity);
    const thread = projection.threads.find((thread) => thread.id === threadId);
    if (!thread || !this.matchesTargetIdentity(thread, identity) || thread.bindingState !== 'attached' || !thread.panes.some((pane) => pane.terminalId === terminalId)) throw new Error('binding_invalid');
    return identity.target;
  }
  terminalBinding(machineId: string, terminalId: string, ref: { threadId?: string; tabId?: string }) {
    if (ref.threadId) return this.binding(machineId, ref.threadId, terminalId);
    const supervisor = this.supervisors.get(machineId);
    if (!supervisor) throw new Error('binding_invalid');
    const identity = this.targetIdentity(supervisor);
    const projection = this.requireCurrentProjection(identity);
    const tab = ref.tabId && projection.availableTabs?.find((item) => item.tabId === ref.tabId && !item.bound && item.panes.some((pane) => pane.terminalId === terminalId));
    if (!tab) throw new Error('binding_invalid');
    return identity.target;
  }
  acceptCreateOperation(owner: string, kind: CreateOperationKind, key: string, input: CreateOperationInput) {
    const normalized = parseCreateOperationInput(kind, input);
    const previous = this.database.findCreateOperation(owner, kind, key, normalized);
    if (previous) return { envelope: createOperationEnvelope(previous), created: false };

    if (this.database.getSetting(`workspace_operation:${key}`) !== undefined) {
      this.database.compactLegacyWorkspaceOperation(key);
      throw new Error('legacy_operation_ownership_ambiguous');
    }

    const supervisor = this.supervisors.get(normalized.machineId);
    if (!supervisor?.connected) throw new Error('machine_disconnected');
    const identity = this.targetIdentity(supervisor);
    this.requireCurrentProjection(identity);
    if (kind === 'worktree') {
      if (!identity.target.worktrees || !identity.target.openWorktree) throw new Error('machine_disconnected');
    } else if (!identity.target.writable || !identity.target.createWorkspace) throw new Error('workspace_creation_unavailable');
    const accepted = this.database.beginCreateOperation(owner, kind, key, normalized, identity);
    return { envelope: createOperationEnvelope(accepted.operation), created: accepted.created };
  }
  startCreateOperation(operationId: string) {
    if (this.closed || this.createRuns.has(operationId)) return;
    const operation = this.database.createOperation(operationId);
    if (!operation || operation.state !== 'pending') return;
    const task = this.withTargetMutation(operation.machineId, () => operation.kind === 'worktree' ? this.runWorktreeOperation(operationId) : this.runCreateOperation(operationId))
      .catch(() => {
        const current = this.database.createOperation(operationId);
        if (current && (current.state === 'pending' || current.state === 'running')) this.database.updateCreateOperation(operationId, 'unknown', current.step, current.result, 'create_interrupted');
      })
      .finally(() => { if (this.createRuns.get(operationId) === task) this.createRuns.delete(operationId); });
    this.createRuns.set(operationId, task);
  }
  private async runCreateOperation(operationId: string) {
    const operation = this.database.createOperation(operationId);
    if (!operation || operation.state !== 'pending') return;
    let effectStarted = false;
    try {
      const supervisor = this.supervisors.get(operation.machineId);
      if (!supervisor?.connected) throw new Error('machine_disconnected');
      const identity = this.targetIdentity(supervisor);
      if (identity.fingerprint !== operation.targetFingerprint || identity.session !== operation.targetSession || identity.configVersion !== operation.targetConfigVersion) throw new Error('create_target_changed');
      this.requireCurrentProjection(identity);
      if (!identity.target.writable || !identity.target.createWorkspace) throw new Error('workspace_creation_unavailable');
      if (!operation.input) throw new Error('create_input_unavailable');
      const workspaceInput = operation.kind === 'workspace' ? workspaceCreateInput.parse(operation.input) : undefined;
      const input = workspaceInput ?? terminalCreateInput.parse(operation.input);
      this.database.updateCreateOperation(operationId, 'running', 'create', {});
      effectStarted = true;
      const label = workspaceInput?.label ?? 'Terminal';
      const created = createOperationResult.parse(await identity.target.createWorkspace(input.path, label, operation.nativeRequestId));
      if (!this.hasCurrentProjection(identity)) throw new Error('create_target_changed');
      if (operation.kind === 'terminal') this.registerPendingTerminal(supervisor, created);
      this.database.updateCreateOperation(operationId, 'ready', 'ready', created);
      supervisor.invalidate();
    } catch (error) {
      const message = error instanceof Error && /^[a-z][a-z0-9_]{0,79}$/.test(error.message) ? error.message : 'create_failed';
      this.database.updateCreateOperation(operationId, effectStarted ? 'unknown' : 'failed', effectStarted ? 'create' : 'validate', {}, message);
      if (effectStarted) console.error(`create ${operationId} outcome is uncertain:`, message);
    }
  }
  private async runWorktreeOperation(operationId: string) {
    const operation = this.database.createOperation(operationId);
    if (!operation || operation.state !== 'pending') return;
    let effectStarted = false;
    try {
      if (!operation.input) throw new Error('create_input_unavailable');
      const input = worktreeOpenInput.parse(operation.input);
      if (input.machineId !== operation.machineId) throw new Error('create_target_changed');
      const supervisor = this.worktreeSupervisor(operation.machineId);
      const identity = this.targetIdentity(supervisor);
      if (identity.fingerprint !== operation.targetFingerprint || identity.session !== operation.targetSession || identity.configVersion !== operation.targetConfigVersion) throw new Error('create_target_changed');
      this.requireCurrentProjection(identity);
      this.database.updateCreateOperation(operationId, 'running', 'discover', {});
      const candidates = (await this.worktrees(input.machineId, input.projectId)).filter((worktree) => worktree.path === input.path);
      this.requireCurrentProjection(identity);
      if (candidates.length !== 1) throw new Error(candidates.length ? 'ambiguous_worktree' : 'unknown_worktree');
      this.requireCurrentProjection(identity);
      this.database.updateCreateOperation(operationId, 'running', 'open', {});
      effectStarted = true;
      await identity.target.openWorktree!(input.projectId, input.path);
      const snapshot = await supervisor.readFresh();
      const projection = this.requireCurrentProjection(identity);
      const workspaces = snapshot.workspaces.filter((workspace) => workspace.worktree?.checkout_path === input.path);
      if (workspaces.length !== 1) throw new Error(workspaces.length ? 'ambiguous_worktree_workspace' : 'worktree_not_opened');
      const workspace = workspaces[0]!;
      const tabs = snapshot.tabs.filter((tab) => tab.workspace_id === workspace.workspace_id);
      if (tabs.length !== 1) throw new Error(tabs.length ? 'ambiguous_worktree_tab' : 'worktree_not_opened');
      const tab = tabs[0]!;
      if (snapshot.tabs.filter((candidate) => candidate.tab_id === tab.tab_id).length !== 1) throw new Error('ambiguous_worktree_tab');
      const nativePanes = snapshot.panes.filter((pane) => pane.workspace_id === workspace.workspace_id && pane.tab_id === tab.tab_id);
      const paneKeys = new Set(nativePanes.map((pane) => JSON.stringify([pane.pane_id, pane.terminal_id])));
      const duplicatedPaneKeys = new Set(nativePanes.filter((pane) => snapshot.panes.some((other) =>
        (other.workspace_id !== workspace.workspace_id || other.tab_id !== tab.tab_id)
        && other.pane_id === pane.pane_id && other.terminal_id === pane.terminal_id,
      )).map((pane) => JSON.stringify([pane.pane_id, pane.terminal_id])));
      if (paneKeys.size !== nativePanes.length || duplicatedPaneKeys.size) throw new Error('ambiguous_worktree_thread');
      const threads = projection.threads.filter((thread) => thread.tabId === tab.tab_id && thread.bindingState === 'attached' && this.matchesTargetIdentity(thread, identity)
        && thread.panes.some((pane) => !!pane.terminalId && paneKeys.has(JSON.stringify([pane.id, pane.terminalId]))));
      if (threads.length !== 1) throw new Error(threads.length ? 'ambiguous_worktree_thread' : 'worktree_not_opened');
      const thread = threads[0]!;
      if (thread.archivedAt) this.archive(input.machineId, thread.id, false);
      this.database.updateCreateOperation(operationId, 'ready', 'ready', { threadId: thread.id });
      supervisor.invalidate();
    } catch (error) {
      const message = error instanceof Error && /^[a-z][a-z0-9_]{0,79}$/.test(error.message) ? error.message : 'worktree_open_failed';
      this.database.updateCreateOperation(operationId, effectStarted ? 'unknown' : 'failed', effectStarted ? 'open' : 'validate', {}, message);
      if (effectStarted) console.error(`worktree open ${operationId} outcome is uncertain:`, message);
    }
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
    return this.withTargetMutation(machineId, () => this.adoptUnderTargetMutation(machineId, threadId, terminalIds));
  }
  private async adoptUnderTargetMutation(machineId: string, threadId: string, terminalIds: string[]) {
    const supervisor = this.supervisors.get(machineId);
    const row = this.database.threadRows(machineId).find((row) => row.id === threadId);
    if (!supervisor?.connected || !row || !terminalIds.length || new Set(terminalIds).size !== terminalIds.length) throw new Error('invalid_adoption');
    const identity = this.targetIdentity(supervisor);
    this.requireCurrentProjection(identity);
    const snapshot = await supervisor.readFresh();
    this.requireCurrentProjection(identity);
    const currentRow = this.database.threadRows(machineId).find((item) => item.id === threadId);
    if (!currentRow) throw new Error('invalid_adoption');
    const panes = snapshot.panes.filter((pane) => terminalIds.includes(pane.terminal_id));
    const tab = panes[0]?.tab_id;
    if (panes.length !== terminalIds.length || !tab || panes.some((pane) => pane.tab_id !== tab) || snapshot.panes.filter((pane) => pane.tab_id === tab).length !== panes.length) throw new Error('invalid_adoption');
    if (this.projections.get(machineId)?.threads.some((other) => other.id !== threadId && other.bindingState === 'attached' && other.tabId === tab)) throw new Error('binding_conflict');
    const reports = panes.filter((pane) => pane.agent_session);
    if (currentRow.metadata.providerSession && (reports.length !== 1 || !sameSession(currentRow.metadata.providerSession, reports[0].agent_session!))) throw new Error('conversation_changed');
    if (reports.length > 1) throw new Error('conversation_conflict');
    const report = reports[0];
    const worktree = snapshot.workspaces.find((workspace) => workspace.workspace_id === report?.workspace_id)?.worktree;
    const cwd = report?.foreground_cwd ?? report?.cwd;
    if (report && (!cwd || report.agent && report.agent !== report.agent_session!.agent || currentRow.metadata.expectedCwd && currentRow.metadata.expectedCwd !== cwd && !(currentRow.metadata.providerSession && isSameOrSiblingWorktree(currentRow.metadata.expectedCwd, cwd!)) || currentRow.metadata.expectedRepository && worktree?.repo_key !== currentRow.metadata.expectedRepository || currentRow.metadata.expectedCheckout && worktree?.checkout_path !== currentRow.metadata.expectedCheckout)) throw new Error('worktree_changed');
    const adoption = report ? { providerSession: report.agent_session!, expectedCwd: cwd!, observedCwd: cwd!, expectedRepository: currentRow.metadata.expectedRepository ?? worktree?.repo_key, expectedCheckout: currentRow.metadata.expectedCheckout ?? worktree?.checkout_path, agent: report.agent_session!.agent } : {};
    this.requireCurrentProjection(identity);
    this.database.saveThread({ ...currentRow.metadata, ...adoption, session: identity.session, tabId: tab, bindingFingerprint: identity.fingerprint, bindingConfigVersion: identity.configVersion, semanticSignature: undefined }, terminalIds, tab); this.publish(supervisor);
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
    return this.withTargetMutation(machineId, async () => {
      const supervisor = this.worktreeSupervisor(machineId);
      const identity = this.targetIdentity(supervisor);
      this.requireCurrentProjection(identity);
      if (!(await this.worktrees(machineId, projectId)).some((worktree) => worktree.path === path)) throw new Error('unknown_worktree');
      this.requireCurrentProjection(identity);
      await identity.target.openWorktree!(projectId, path);
      const snapshot = await supervisor.readFresh();
      const projection = this.requireCurrentProjection(identity);
      const workspace = snapshot.workspaces.find((workspace) => workspace.worktree?.checkout_path === path);
      const tab = snapshot.tabs.find((tab) => tab.workspace_id === workspace?.workspace_id);
      const thread = projection.threads.find((thread) => thread.tabId === tab?.tab_id && thread.bindingState === 'attached');
      if (!thread) throw new Error('worktree_not_opened');
      if (thread.archivedAt) this.archive(machineId, thread.id, false);
      return { id: thread.id };
    });
  }
  async focusPane(machineId: string, threadId: string, paneId: string) {
    return this.withTargetMutation(machineId, async () => {
      const supervisor = this.supervisors.get(machineId);
      if (!supervisor || !supervisor.connected) throw new Error('invalid_focus');
      const identity = this.targetIdentity(supervisor);
      this.requireCurrentProjection(identity);
      if (!identity.target.writable) throw new Error('read_only');
      const thread = this.projections.get(machineId)?.threads.find((thread) => thread.id === threadId);
      if (!thread?.panes.some((pane) => pane.id === paneId) || !identity.target.focusPane) throw new Error('invalid_focus');
      await supervisor.readFresh();
      const latest = this.requireCurrentProjection(identity).threads.find((item) => item.id === threadId);
      if (!latest || !this.matchesTargetIdentity(latest, identity) || latest.bindingState !== 'attached' || latest.tabId !== thread.tabId || !latest.panes.some((pane) => pane.id === paneId)) throw new Error('invalid_focus');
      await identity.target.focusPane(paneId);
      const acked = this.clearDoneBadge(machineId, threadId);
      // Do not publish here: supervisor.snapshot is stale (pre-focus, still
      // done) and a synchronous publish would re-latch the badge we just
      // cleared. Invalidate instead so the next refresh reads post-focus state.
      supervisor.invalidate();
      return { focused: true, acked };
    });
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
    if (this.deletingThreads.has(JSON.stringify([machineId, threadId]))) throw new Error('delete_in_progress');
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
    const identity = this.targetIdentity(supervisor);
    const canSync = normalizedTitle !== null && thread?.bindingState === 'attached' && this.hasCurrentProjection(identity) && this.matchesTargetIdentity(thread, identity) && !!identity.target.renameTab && !queueStopped;
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
        if (!supervisor) { this.finishTitleSync(job, 'unknown'); continue; }
        const identity = this.targetIdentity(supervisor);
        const thread = this.projections.get(job.machineId)?.threads.find((item) => item.id === job.threadId);
        if (!this.hasCurrentProjection(identity) || !thread || thread.bindingState !== 'attached' || !this.matchesTargetIdentity(thread, identity) || !identity.target.renameTab) {
          this.finishTitleSync(job, 'unknown');
          continue;
        }
        const attempt = this.withTargetMutation(job.machineId, async () => {
          const current = this.projections.get(job.machineId)?.threads.find((item) => item.id === job.threadId);
          if (!this.hasCurrentProjection(identity) || !current || current.bindingState !== 'attached' || !this.matchesTargetIdentity(current, identity) || current.tabId !== job.tabId || !!current.ownsWorktree !== job.renameWorkspace) throw new Error('binding_invalid');
          await identity.target.renameTab!(job.tabId, job.title, job.renameWorkspace);
          await supervisor.readFresh();
          this.requireCurrentProjection(identity);
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
    const { identity, supervisor, thread } = this.attachedThread(machineId, threadId);
    if (!identity.target.writable) throw new Error('read_only');
    const sourcePane = thread.panes.find((pane) => pane.id === afterPaneId && !!pane.terminalId);
    if (!sourcePane?.terminalId) throw new Error('thread_not_found');
    const sourceTerminalId = sourcePane.terminalId;
    if (!identity.target.splitTerminal) throw new Error('pane_action_unavailable');
    return this.withTargetMutation(machineId, async () => {
      await readPaneActionSnapshot(supervisor);
      const current = this.requireCurrentProjection(identity).threads.find((item) => item.id === threadId);
      if (!current || !this.matchesTargetIdentity(current, identity) || current.bindingState !== 'attached' || current.tabId !== thread.tabId) throw new Error('machine_disconnected');
      if (!current.panes.some((pane) => pane.id === afterPaneId && pane.terminalId === sourceTerminalId)) throw new Error('thread_not_found');
      let paneId: string;
      try { paneId = await identity.target.splitTerminal!(afterPaneId, 'right'); }
      catch { throw new Error('pane_outcome_unknown'); }
      try {
        if (typeof paneId !== 'string' || !paneId || current.panes.some((pane) => pane.id === paneId)) throw new Error('pane_outcome_unknown');
        await readPaneActionSnapshot(supervisor);
        const projection = this.requireCurrentProjection(identity);
        const latest = projection.threads.find((item) => item.id === threadId);
        if (!latest || !this.matchesTargetIdentity(latest, identity) || latest.bindingState !== 'attached' || latest.tabId !== current.tabId) throw new Error('pane_outcome_unknown');
        const returnedPanes = latest.panes.filter((pane) => pane.id === paneId && typeof pane.terminalId === 'string' && !!pane.terminalId);
        const nativeIdentities = projection.threads.filter((item) => item.tabId === latest.tabId).flatMap((item) => item.panes)
          .filter((pane) => pane.id === paneId || pane.terminalId === returnedPanes[0]?.terminalId);
        if (returnedPanes.length !== 1 || nativeIdentities.length !== 1) throw new Error('pane_outcome_unknown');
        this.saveThreadMetadata(machineId, threadId, { paneOrder: insertAfter(latest.panes.filter((pane) => pane.id !== paneId).map((pane) => pane.id), afterPaneId, paneId) });
        this.publish(supervisor);
        return { paneId };
      } catch {
        throw new Error('pane_outcome_unknown');
      }
    });
  }
  async closePane(machineId: string, threadId: string, paneId: string, force: boolean) {
    const { identity, supervisor, thread } = this.attachedThread(machineId, threadId);
    if (!canClosePane(thread, paneId)) return { closed: false, busy: false };
    const targetTerminalId = thread.panes.find((pane) => pane.id === paneId)?.terminalId;
    if (!targetTerminalId) throw new Error('thread_not_found');
    if (!identity.target.writable) throw new Error('read_only');
    const closePane = identity.target.closePane?.bind(identity.target);
    if (!closePane) throw new Error('pane_action_unavailable');
    const isBusy = async () => {
      try { return !!(await identity.target.paneBusy?.(paneId)); }
      catch { throw paneActionRefused(); }
    };
    if (!force && await isBusy()) return { closed: false, busy: true };
    return this.withTargetMutation(machineId, async () => {
      await readPaneActionSnapshot(supervisor);
      const current = this.requireCurrentProjection(identity).threads.find((item) => item.id === threadId);
      if (!current || !this.matchesTargetIdentity(current, identity) || current.bindingState !== 'attached' || current.tabId !== thread.tabId) throw new Error('machine_disconnected');
      if (!canClosePane(current, paneId) || !current.panes.some((pane) => pane.id === paneId && pane.terminalId === targetTerminalId)) return { closed: false, busy: false };
      if (!force && await isBusy()) return { closed: false, busy: true };
      await readPaneActionSnapshot(supervisor);
      const latest = this.requireCurrentProjection(identity).threads.find((item) => item.id === threadId);
      if (!latest || !this.matchesTargetIdentity(latest, identity) || latest.bindingState !== 'attached' || latest.tabId !== thread.tabId) throw new Error('machine_disconnected');
      if (!canClosePane(latest, paneId) || !latest.panes.some((pane) => pane.id === paneId && pane.terminalId === targetTerminalId)) return { closed: false, busy: false };
      try { await closePane(paneId); }
      catch { /* A rejected native reply can still mean the pane closed; inspect a fresh scoped projection. */ }
      try {
        await readPaneActionSnapshot(supervisor);
        const projection = this.requireCurrentProjection(identity);
        const confirmed = projection.threads.find((item) => item.id === threadId);
        if (!confirmed || !this.matchesTargetIdentity(confirmed, identity) || confirmed.bindingState !== 'attached' || confirmed.tabId !== latest.tabId || confirmed.panes.some((pane) => pane.id === paneId || pane.terminalId === targetTerminalId)) throw new Error('pane_outcome_unknown');
        this.publish(supervisor);
        return { closed: true, busy: false };
      } catch {
        throw new Error('pane_outcome_unknown');
      }
    });
  }
  async closeTab(machineId: string, tabId: string, force: boolean) {
    const supervisor = this.supervisors.get(machineId);
    if (!supervisor) throw new Error('machine_disconnected');
    const identity = this.targetIdentity(supervisor);
    this.requireCurrentProjection(identity);
    const target = identity.target;
    const discardTab = target.discardTab?.bind(target);
    if (!target.writable || !discardTab) throw new Error('read_only');
    if (this.launchInProgress(machineId)) throw new Error('launch_in_progress');
    const initial = await supervisor.readFresh();
    this.requireCurrentProjection(identity);
    if (!initial.tabs.some((item) => item.tab_id === tabId)) throw new Error('tab_not_found');
    if (this.listedThreadOwnsTab(machineId, tabId)) throw new Error('binding_conflict');
    const probedPanes = initial.panes.filter((pane) => pane.tab_id === tabId);
    if (!force && target.paneBusy) {
      for (const pane of probedPanes) if (await target.paneBusy(pane.pane_id)) return { closed: false, busy: true };
    }
    return this.withTargetMutation(machineId, async () => {
      const snapshot = await supervisor.readFresh();
      this.requireCurrentProjection(identity);
      if (!snapshot.tabs.some((item) => item.tab_id === tabId)) throw new Error('tab_not_found');
      if (this.listedThreadOwnsTab(machineId, tabId)) throw new Error('binding_conflict');
      if (this.launchInProgress(machineId)) throw new Error('launch_in_progress');
      const currentPanes = snapshot.panes.filter((pane) => pane.tab_id === tabId);
      if (!force && (currentPanes.length !== probedPanes.length || currentPanes.some((pane) => !probedPanes.some((probed) => probed.pane_id === pane.pane_id && probed.terminal_id === pane.terminal_id)))) return { closed: false, busy: true };
      if (!force && target.paneBusy) {
        for (const pane of currentPanes) if (await target.paneBusy(pane.pane_id)) return { closed: false, busy: true };
      }
      const freshSnapshot = await supervisor.readFresh();
      this.requireCurrentProjection(identity);
      if (!freshSnapshot.tabs.some((item) => item.tab_id === tabId)) throw new Error('tab_not_found');
      if (this.listedThreadOwnsTab(machineId, tabId)) throw new Error('binding_conflict');
      if (this.launchInProgress(machineId)) throw new Error('launch_in_progress');
      const latestPanes = freshSnapshot.panes.filter((pane) => pane.tab_id === tabId);
      if (!force && (latestPanes.length !== currentPanes.length || latestPanes.some((pane) => !currentPanes.some((current) => current.pane_id === pane.pane_id && current.terminal_id === pane.terminal_id)))) return { closed: false, busy: true };
      const pending = this.pendingTerminalTabs.get(machineId)?.get(tabId);
      try { await discardTab(freshSnapshot, tabId, false); }
      catch { /* A failed Herdr reply can still mean the tab closed; verify its snapshot below. */ }
      const fresh = await supervisor.readFresh();
      this.requireCurrentProjection(identity);
      if (pending && !fresh.tabs.some((item) => item.tab_id === tabId) && this.pendingTerminalTabs.get(machineId)?.get(tabId) === pending) {
        clearTimeout(pending.timer);
        this.pendingTerminalTabs.get(machineId)?.delete(tabId);
        if (!this.pendingTerminalTabs.get(machineId)?.size) this.pendingTerminalTabs.delete(machineId);
      }
      this.publish(supervisor);
      return fresh.tabs.some((item) => item.tab_id === tabId) ? { closed: false, busy: false } : { closed: true, busy: false };
    });
  }
  private attachedThread(machineId: string, threadId: string) {
    const supervisor = this.supervisors.get(machineId);
    if (!supervisor) throw new Error('thread_not_found');
    const identity = this.targetIdentity(supervisor);
    const projection = this.requireCurrentProjection(identity);
    const thread = projection.threads.find((thread) => thread.id === threadId);
    if (!thread) throw new Error('thread_not_found');
    if (!this.matchesTargetIdentity(thread, identity) || thread.bindingState !== 'attached') throw new Error('machine_disconnected');
    return { identity, supervisor, thread };
  }
  private saveThreadMetadata(machineId: string, threadId: string, change: Partial<Thread>) {
    const row = this.database.threadRows(machineId).find((row) => row.id === threadId);
    if (row) this.database.saveThread({ ...row.metadata, ...change }, row.anchors, row.alias);
  }
  async deleteThread(machineId: string, threadId: string, archivedOnly = false) {
    return this.withTargetMutation(machineId, () => this.deleteThreadUnderTargetMutation(machineId, threadId, archivedOnly));
  }
  private async deleteThreadUnderTargetMutation(machineId: string, threadId: string, archivedOnly: boolean) {
    const supervisor = this.supervisors.get(machineId);
    if (!supervisor) throw new Error('thread_not_found');
    const identity = this.targetIdentity(supervisor);
    this.requireCurrentProjection(identity);
    const snapshot = await supervisor.readFresh();
    const projection = this.requireCurrentProjection(identity);
    const thread = projection.threads.find((thread) => thread.id === threadId);
    if (!thread) throw new Error('thread_not_found');
    if (archivedOnly && !thread.archivedAt) throw new Error('thread_not_found');
    if (!this.matchesTargetIdentity(thread, identity)) throw new Error('binding_invalid');
    if (['pending', 'running'].includes(thread.operation?.state ?? '')) throw new Error('launch_in_progress');
    const target = identity.target;
    if (thread.bindingState === 'attached') {
      if (!target.discardTab || !snapshot.tabs.some((tab) => tab.tab_id === thread.tabId)) throw new Error('binding_invalid');
      const deletionKey = JSON.stringify([machineId, threadId]);
      this.deletingThreads.add(deletionKey);
      try {
        await target.discardTab(snapshot, thread.tabId, !!thread.ownsWorktree);
        const fresh = await supervisor.readFresh();
        const current = this.requireCurrentProjection(identity);
        const currentThread = current.threads.find((item) => item.id === threadId);
        if (!currentThread || archivedOnly && !currentThread.archivedAt || !this.matchesTargetIdentity(currentThread, identity) || currentThread.tabId !== thread.tabId || ['pending', 'running'].includes(currentThread.operation?.state ?? '')) throw new Error('thread_not_found');
        if (fresh.tabs.some((tab) => tab.tab_id === thread.tabId)) throw new Error('tab_delete_unconfirmed');
        this.database.deleteThread(threadId);
        this.publish(supervisor);
      } finally { this.deletingThreads.delete(deletionKey); }
      return;
    }
    if (thread.bindingState !== 'detached' || thread.tabId && snapshot.tabs.some((tab) => tab.tab_id === thread.tabId)) throw new Error('binding_uncertain');
    const current = this.requireCurrentProjection(identity);
    const currentThread = current.threads.find((item) => item.id === threadId);
    if (!currentThread || archivedOnly && !currentThread.archivedAt || !this.matchesTargetIdentity(currentThread, identity) || currentThread.tabId !== thread.tabId) throw new Error('thread_not_found');
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
      try { await this.deleteThread(thread.machineId, thread.id, true); ++deleted; }
      catch { failed.push(thread.id); }
    }
    for (const supervisor of this.supervisors.values()) {
      const machineId = supervisor.target.id;
      const identity = this.targetIdentity(supervisor);
      if (!this.hasCurrentProjection(identity)) { skippedMachines.push(machineId); continue; }
      let snapshot: NativeSnapshot;
      try { snapshot = await supervisor.readFresh(); this.requireCurrentProjection(identity); }
      catch { skippedMachines.push(machineId); continue; }
      const orphanTabs = snapshot.tabs.filter((tab) => !this.threadOwnsTab(machineId, tab.tab_id)).map((tab) => tab.tab_id);
      for (const tabId of orphanTabs) {
        await this.withTargetMutation(machineId, async () => {
          const target = identity.target;
          if (!this.hasCurrentProjection(identity) || !target.writable || !target.discardTab) {
            skippedMachines.push(machineId);
            return;
          }
          try { snapshot = await supervisor.readFresh(); this.requireCurrentProjection(identity); }
          catch { skippedMachines.push(machineId); return; }
          if (this.launchInProgress(machineId)) { skippedMachines.push(machineId); return; }
          if (!snapshot.tabs.some((tab) => tab.tab_id === tabId) || this.threadOwnsTab(machineId, tabId)) return;
          try { await target.discardTab(snapshot, tabId, false); }
          catch { /* A failed Herdr reply can still mean the tab closed; verify its snapshot below. */ }
          try { snapshot = await supervisor.readFresh(); this.requireCurrentProjection(identity); }
          catch { failed.push(`${machineId}:${tabId}`); skippedMachines.push(machineId); return; }
          const remains = snapshot.tabs.some((tab) => tab.tab_id === tabId);
          if (!remains) ++orphanTabsDeleted;
          else if (!this.threadOwnsTab(machineId, tabId)) failed.push(`${machineId}:${tabId}`);
        });
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
    const machineId = supervisor.target.id;
    this.projectedSnapshotRevisions.delete(machineId);
    try {
      this.buildProjection(supervisor);
      this.projectedSnapshotRevisions.set(machineId, supervisor.revision);
    } catch (error) {
      console.error(`projection for ${machineId} skipped:`, error instanceof Error ? error.message : error);
      const previous = this.projections.get(machineId);
      if (previous) {
        const stale: Projection = {
          ...previous,
          revision: previous.revision + 1,
          freshAt: null,
          connected: false,
          error: 'projection_failed',
          ...(previous.machine ? { machine: { ...previous.machine, connected: false, error: 'projection_failed' } } : {}),
          threads: previous.threads.map((thread) => ({ ...thread, prompt: '', status: 'unknown' as const })),
        };
        this.projections.set(machineId, stale);
        this.emit('projection', stale);
      }
    }
  }
  private buildProjection(supervisor: TargetSupervisor) {
    const previous = this.projections.get(supervisor.target.id);
    const current = supervisor.connected && !!supervisor.freshAt && !!supervisor.snapshot;
    const saved = new Map(this.database.threadRows(supervisor.target.id).map((row) => [row.id, row.metadata]));
    const staleThreads = previous ? previous.threads.map((thread) => {
      const metadata = saved.get(thread.id);
      return { ...thread, ...(metadata ?? {}), panes: thread.panes, bindingState: thread.bindingState ?? metadata?.bindingState, prompt: '', status: 'unknown' as const };
    }) : [...saved.values()].map((thread) => ({ ...thread, panes: [], prompt: '', status: 'unknown' as const }));
    const records = current ? reconcile(this.database, supervisor.target, supervisor.snapshot!) : {
      threads: staleThreads,
      projects: (previous?.projects ?? []).map((project) => {
        const logicalId = project.logicalId ?? project.id;
        return { ...project, name: this.database.projectName(supervisor.target.id, logicalId) ?? project.name, metadataVersion: this.database.projectMetadataVersion(supervisor.target.id, logicalId) };
      }),
    };
    const projection: Projection = { machineId: supervisor.target.id, generation: supervisor.generation, revision: (previous?.revision ?? 0) + 1, freshAt: current ? supervisor.freshAt : null, connected: current, error: supervisor.error, ...records, layouts: current ? supervisor.snapshot!.layouts.map((layout) => ({ workspaceId: layout.workspace_id, tabId: layout.tab_id, area: layout.area, panes: layout.panes.map((pane) => ({ paneId: pane.pane_id, rect: pane.rect })) })) : previous?.layouts ?? [] };
    projection.threads = projection.threads.map((thread) => ({ ...thread, prompt: '', ...(!current ? { status: 'unknown' as const } : {}) }));
    const availableTabs = current ? supervisor.snapshot!.tabs.map((tab) => ({ tabId: tab.tab_id, workspaceId: tab.workspace_id, label: tab.label ?? tab.tab_id, bound: projection.threads.some((thread) => thread.bindingState === 'attached' && thread.tabId === tab.tab_id && isListedThread(thread)), panes: supervisor.snapshot!.panes.filter((pane) => pane.tab_id === tab.tab_id && pane.workspace_id === tab.workspace_id).map((pane) => ({ id: pane.pane_id, terminalId: pane.terminal_id, title: pane.title ?? pane.agent ?? 'Shell' })) })) : previous?.availableTabs ?? [];
    const pending = current ? this.pendingTerminalTabs.get(supervisor.target.id) : undefined;
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
    projection.machine = { ...this.machine(supervisor), connected: current };
    const semantic = (value: Projection) => JSON.stringify({ ...value, revision: 0, freshAt: null });
    if (previous && semantic(previous) === semantic(projection) && (!projection.freshAt || Date.parse(projection.freshAt) - Date.parse(previous.freshAt ?? '') < 30_000)) return;
    this.projections.set(supervisor.target.id, projection);
    if (!projection.connected) for (const key of this.catalogs.keys()) if (JSON.parse(key)[0] === supervisor.target.id) this.catalogs.delete(key);
    this.emit('projection', projection);
  }
}
