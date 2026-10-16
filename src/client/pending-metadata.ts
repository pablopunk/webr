import type { Project, Thread } from '../lib/models';
import type { Bootstrap, ProjectMetadataAcknowledgement, ThreadMetadataAcknowledgement } from '../shared/runtime';
import type { MetadataActionError } from './thread-actions';
import { fetchRuntimeMetadataBootstrap, MetadataActionError as ActionError, MetadataProtocolError, renameProject, renameThread, setThreadArchived } from './thread-actions';
import { metadataFieldKey, projectStateKey, threadStateKey, type MetadataFieldSnapshot } from './store';
import type { createRuntimeStore } from './store';

export type ThreadMetadataField = 'titleOverride' | 'archived';
export type ProjectMetadataField = 'name';
type MetadataField = ThreadMetadataField | ProjectMetadataField;
type FieldValue = string | null | boolean;
type Entity = { kind: 'thread'; machineId: string; entityId: string } | { kind: 'project'; machineId: string; entityId: string };
type MetadataAck = (ThreadMetadataAcknowledgement | ProjectMetadataAcknowledgement) & { title?: string; archived?: boolean; name?: string };
type Command = {
  id: number;
  sequence: number;
  entity: Entity;
  field: MetadataField;
  value: FieldValue;
  baseVersion: number;
  phase: 'queued' | 'sending' | 'unknown' | 'acknowledged';
  acknowledgement?: MetadataAck;
  cancel?: () => void;
  resolve?: () => void;
  reject?: (error: unknown) => void;
};
type Queue = {
  entity: Entity;
  field: MetadataField;
  commands: Command[];
  inFlight?: Command;
  paused: boolean;
  reconciling: boolean;
  draftValue?: FieldValue;
  hasDraft: boolean;
  message?: string;
  lastStatus?: MetadataFieldSnapshot['status'];
};
type RuntimeStore = ReturnType<typeof createRuntimeStore>;

const REQUEST_TIMEOUT_MS = 15_000;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const validVersion = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

export const threadTitleFieldKey = (thread: Pick<Thread, 'machineId' | 'id'>) => metadataFieldKey('thread', thread.machineId, thread.id, 'titleOverride');
export const threadArchiveFieldKey = (thread: Pick<Thread, 'machineId' | 'id'>) => metadataFieldKey('thread', thread.machineId, thread.id, 'archived');
export const projectNameFieldKey = (project: Pick<Project, 'machineId' | 'logicalId' | 'id'>) => metadataFieldKey('project', project.machineId ?? 'local', project.logicalId ?? project.id, 'name');
export const threadDisplayTitle = (thread: Pick<Thread, 'title' | 'titleOverride'>) => thread.titleOverride ?? thread.title;
export function threadIsArchived(thread: Thread, fields: Record<string, MetadataFieldSnapshot>) {
  const intent = fields[threadArchiveFieldKey(thread)];
  return intent?.hasOverlay ? intent.overlayValue === true : !!thread.archivedAt;
}

function definitiveFailure(entity: Entity, field: MetadataField, error: unknown): error is MetadataActionError {
  if (!(error instanceof ActionError)) return false;
  const pair = `${error.status}:${error.errorCode ?? ''}`;
  const common = new Set(['400:invalid_request', '401:unauthorized', '403:invalid_host', '403:invalid_origin']);
  if (common.has(pair)) return true;
  if (entity.kind === 'thread' && (field === 'archived' || field === 'titleOverride')) return pair === '404:thread_not_found';
  if (entity.kind === 'project' && field === 'name') return pair === '409:machine_disconnected';
  return false;
}

function validateBootstrap(value: unknown, expectedScope: string, expectedMachineId: string): value is Bootstrap {
  if (!isRecord(value) || value.recoveryScope !== expectedScope || !Array.isArray(value.machines) || !Array.isArray(value.projections) || !Array.isArray(value.threads) || !Array.isArray(value.projects)) return false;
  const machines = new Set<string>();
  for (const machine of value.machines) {
    if (!isRecord(machine) || typeof machine.id !== 'string' || !machine.id || machines.has(machine.id)) return false;
    machines.add(machine.id);
  }
  const projectedMachines = new Set<string>();
  for (const raw of value.projections) {
    if (!isRecord(raw) || typeof raw.machineId !== 'string' || !machines.has(raw.machineId) || projectedMachines.has(raw.machineId) || typeof raw.generation !== 'string' || !raw.generation || !validVersion(raw.revision) || !Array.isArray(raw.threads) || !Array.isArray(raw.projects)) return false;
    projectedMachines.add(raw.machineId);
    if (raw.machine !== undefined && (!isRecord(raw.machine) || raw.machine.id !== raw.machineId)) return false;
    for (const thread of raw.threads) {
      if (!isRecord(thread) || typeof thread.id !== 'string' || !thread.id || thread.machineId !== raw.machineId) return false;
    }
    for (const project of raw.projects) {
      if (!isRecord(project) || typeof project.id !== 'string' || !project.id || project.machineId !== undefined && project.machineId !== raw.machineId || project.logicalId !== undefined && (typeof project.logicalId !== 'string' || !project.logicalId)) return false;
    }
  }
  for (const thread of value.threads) if (!isRecord(thread) || typeof thread.id !== 'string' || !thread.id || typeof thread.machineId !== 'string' || !projectedMachines.has(thread.machineId)) return false;
  for (const project of value.projects) if (!isRecord(project) || typeof project.id !== 'string' || !project.id || project.machineId !== undefined && (typeof project.machineId !== 'string' || !projectedMachines.has(project.machineId))) return false;
  return projectedMachines.has(expectedMachineId);
}

function fieldValue(command: Command, acknowledgement: MetadataAck): FieldValue {
  if (command.entity.kind === 'project') return (acknowledgement as ProjectMetadataAcknowledgement).metadata.name;
  const metadata = (acknowledgement as ThreadMetadataAcknowledgement).metadata;
  return command.field === 'titleOverride' ? metadata.titleOverride : metadata.archivedAt !== null;
}

function canonicalMatches(command: Command, acknowledgement: MetadataAck, base: Thread | Project) {
  if (command.entity.kind === 'project') {
    const project = base as Project;
    const metadata = (acknowledgement as ProjectMetadataAcknowledgement).metadata;
    return project.name === metadata.name;
  }
  const thread = base as Thread;
  const metadata = (acknowledgement as ThreadMetadataAcknowledgement).metadata;
  return (thread.titleOverride ?? null) === metadata.titleOverride && (thread.archivedAt ?? null) === metadata.archivedAt;
}

export function createPendingMetadataController(runtime: RuntimeStore, initialScope: string) {
  const queues = new Map<string, Queue>();
  let recoveryScope = initialScope;
  let scopeGeneration = 0;
  let nextId = 1;
  let sequence = 1;
  let disposed = false;

  const confirmedVersion = (entity: Entity) => {
    const state = runtime.getState();
    const base = entity.kind === 'thread'
      ? state.confirmedThreads[threadStateKey(entity.machineId, entity.entityId)]
      : state.confirmedProjects[projectStateKey(entity.machineId, entity.entityId)];
    return base?.metadataVersion ?? 0;
  };
  const baseRecord = (entity: Entity) => {
    const state = runtime.getState();
    return entity.kind === 'thread'
      ? state.confirmedThreads[threadStateKey(entity.machineId, entity.entityId)]
      : state.confirmedProjects[projectStateKey(entity.machineId, entity.entityId)];
  };
  const snapshotKey = (entity: Entity, field: MetadataField) => metadataFieldKey(entity.kind, entity.machineId, entity.entityId, field);
  const commandFor = (queue: Queue) => [...queue.commands].sort((left, right) => right.sequence - left.sequence)[0];

  const publish = (queue: Queue, statusOverride?: MetadataFieldSnapshot['status'], messageOverride?: string) => {
    const key = snapshotKey(queue.entity, queue.field);
    const latest = commandFor(queue);
    let snapshot: MetadataFieldSnapshot;
    if (latest) {
      const status = statusOverride ?? (queue.paused || queue.reconciling || latest.phase === 'unknown' ? 'uncertain' : latest.phase === 'acknowledged' ? 'saved' : 'pending');
      const canonical = latest.acknowledgement;
      snapshot = {
        status, hasOverlay: true, overlayValue: canonical ? fieldValue(latest, canonical) : latest.value,
        ...(messageOverride ?? queue.message ? { message: messageOverride ?? queue.message } : {}),
        ...(canonical ? { canonical: {
          metadataVersion: canonical.metadataVersion,
          value: fieldValue(latest, canonical),
          ...(latest.entity.kind === 'thread' ? { archivedAt: (canonical as ThreadMetadataAcknowledgement).metadata.archivedAt } : {}),
        } } : {}),
      };
    } else if (queue.hasDraft) {
      snapshot = { status: 'draft', hasOverlay: false, draftValue: queue.draftValue, requiresResaveConfirmation: true, ...(messageOverride ?? queue.message ? { message: messageOverride ?? queue.message } : {}) };
    } else {
      snapshot = { status: statusOverride ?? queue.lastStatus ?? 'saved', hasOverlay: false, ...(messageOverride ?? queue.message ? { message: messageOverride ?? queue.message } : {}) };
    }
    runtime.getState().setMetadataField(key, snapshot);
  };

  const removeIfFinished = (key: string, queue: Queue) => {
    if (queue.commands.length || queue.hasDraft || queue.paused || queue.reconciling || queue.inFlight) return;
    queues.delete(key);
  };

  const inspectAcknowledgements = (key: string, queue: Queue) => {
    const wasPaused = queue.paused;
    for (const command of [...queue.commands]) {
      if (!command.acknowledgement) continue;
      const base = baseRecord(command.entity);
      if (!base) continue;
      const baseVersion = base.metadataVersion ?? 0;
      const ackVersion = command.acknowledgement.metadataVersion;
      if (baseVersion < ackVersion) continue;
      if (baseVersion === ackVersion && !canonicalMatches(command, command.acknowledgement, base)) {
        queue.paused = true;
        queue.message = `The server projection disagrees with its acknowledgement at metadata version ${ackVersion}. Reconcile before saving again.`;
        command.phase = 'unknown';
        continue;
      }
      queue.commands = queue.commands.filter((candidate) => candidate !== command);
      queue.lastStatus = 'saved';
      queue.message = undefined;
    }
    queue.paused = queue.commands.some((command) => command.phase === 'unknown');
    publish(queue);
    removeIfFinished(key, queue);
    if (wasPaused && !queue.paused && !queue.reconciling) void sendNext(key, queue, scopeGeneration);
  };

  const transport = (command: Command): Promise<MetadataAck> => {
    if (command.entity.kind === 'project') {
      const project = { id: command.entity.entityId, logicalId: command.entity.entityId, machineId: command.entity.machineId, name: '' } as Project;
      return renameProject(project, command.value as string);
    }
    const thread = { id: command.entity.entityId, machineId: command.entity.machineId, title: '', metadataVersion: command.baseVersion } as Thread;
    return command.field === 'archived'
      ? setThreadArchived(thread, command.value as boolean)
      : renameThread(thread, command.value as string | null);
  };

  const sendNext = async (key: string, queue: Queue, generation: number) => {
    if (disposed || generation !== scopeGeneration || queue.paused || queue.reconciling || queue.inFlight) return;
    const command = queue.commands.find((candidate) => candidate.phase === 'queued');
    if (!command) return;
    command.phase = 'sending';
    queue.inFlight = command;
    queue.message = undefined;
    publish(queue);
    const outcome = await new Promise<{ kind: 'response'; acknowledgement: MetadataAck } | { kind: 'error'; error: unknown } | { kind: 'timeout' }>((resolve) => {
      let settled = false;
      const finish = (result: { kind: 'response'; acknowledgement: MetadataAck } | { kind: 'error'; error: unknown } | { kind: 'timeout' }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        command.cancel = undefined;
        resolve(result);
      };
      const timer = setTimeout(() => finish({ kind: 'timeout' }), REQUEST_TIMEOUT_MS);
      command.cancel = () => finish({ kind: 'error', error: new Error('The metadata controller scope ended before the request completed.') });
      void transport(command).then(
        (acknowledgement) => finish({ kind: 'response', acknowledgement }),
        (error) => finish({ kind: 'error', error }),
      );
    });
    if (disposed || generation !== scopeGeneration || queues.get(key) !== queue || queue.inFlight !== command || !queue.commands.includes(command)) return;
    queue.inFlight = undefined;
    if (outcome.kind !== 'response') {
      const failure = outcome.kind === 'timeout' ? new Error('The metadata request timed out; its result is uncertain.') : outcome.error;
      command.reject?.(failure);
      command.resolve = undefined;
      command.reject = undefined;
      if (definitiveFailure(command.entity, command.field, failure)) {
        queue.commands = queue.commands.filter((candidate) => candidate !== command);
        queue.lastStatus = 'failed';
        queue.message = queue.commands.length ? undefined : failure instanceof Error ? failure.message : 'The metadata change was rejected.';
        if (!queue.commands.length) queue.hasDraft = false;
        publish(queue, queue.commands.length ? undefined : 'failed');
        removeIfFinished(key, queue);
        void sendNext(key, queue, generation);
        return;
      }
      command.phase = 'unknown';
      queue.paused = true;
      queue.message = failure instanceof Error ? failure.message : 'The request result is uncertain. Reconcile with the server before saving again.';
      publish(queue, 'uncertain');
      return;
    }

    const acknowledgement = outcome.acknowledgement;
    const identityMatches = command.entity.kind === 'thread'
      ? acknowledgement.entityId === command.entity.entityId
      : (acknowledgement as ProjectMetadataAcknowledgement).machineId === command.entity.machineId && acknowledgement.entityId === command.entity.entityId;
    if (!identityMatches || !validVersion(acknowledgement.metadataVersion)) {
      const error = new MetadataProtocolError(200, 'The server acknowledged a different metadata entity. Reconcile before saving again.');
      command.reject?.(error);
      command.resolve = undefined;
      command.reject = undefined;
      command.phase = 'unknown';
      queue.paused = true;
      queue.message = error.message;
      publish(queue, 'uncertain');
      return;
    }
    command.acknowledgement = acknowledgement;
    command.phase = 'acknowledged';
    command.resolve?.();
    command.resolve = undefined;
    command.reject = undefined;
    queue.lastStatus = 'saved';
    queue.message = undefined;
    inspectAcknowledgements(key, queue);
    void sendNext(key, queue, generation);
  };

  const updateThreadArchiveDraft = (thread: Thread, archived: boolean) => {
    const entity: Entity = { kind: 'thread', machineId: thread.machineId, entityId: thread.id };
    const queue = queues.get(snapshotKey(entity, 'archived'));
    if (!queue?.hasDraft) return Promise.reject(new Error('This archive field does not have an editable draft.'));
    queue.draftValue = archived;
    queue.message = undefined;
    publish(queue);
    return Promise.resolve();
  };

  const submit = (entity: Entity, field: MetadataField, value: FieldValue, explicitlyConfirmed = false) => {
    const key = snapshotKey(entity, field);
    let queue = queues.get(key);
    const storedField = runtime.getState().metadataFields[key];
    if ((queue?.hasDraft || storedField?.status === 'draft') && !explicitlyConfirmed) {
      return Promise.reject(new Error('This edit is an unsaved draft. Explicitly confirm the re-save to continue.'));
    }
    if (!queue) {
      queue = { entity, field, commands: [], paused: false, reconciling: false, hasDraft: false };
      queues.set(key, queue);
    }
    if (queue.hasDraft) { queue.hasDraft = false; queue.draftValue = undefined; }
    queue.message = undefined;
    const command: Command = { id: nextId++, sequence: sequence++, entity, field, value, baseVersion: confirmedVersion(entity), phase: 'queued' };
    queue.commands.push(command);
    publish(queue);
    const promise = new Promise<void>((resolve, reject) => { command.resolve = resolve; command.reject = reject; });
    void sendNext(key, queue, scopeGeneration);
    return promise;
  };

  const reconcile = async (entity: Entity, field: MetadataField) => {
    const key = snapshotKey(entity, field);
    const queue = queues.get(key);
    if (!queue?.paused || queue.reconciling) throw new Error('This metadata field does not have an uncertain request to reconcile.');
    const generation = scopeGeneration;
    const scope = recoveryScope;
    const observedProjections = runtime.getState().projections;
    queue.reconciling = true;
    try {
      const value = await fetchRuntimeMetadataBootstrap();
      if (disposed || generation !== scopeGeneration || scope !== recoveryScope) throw new Error('The recovery scope changed; the old reconciliation was ignored.');
      if (!validateBootstrap(value, scope, entity.machineId)) throw new MetadataProtocolError(200, 'The runtime response did not match the current recovery scope, omitted the affected machine, or contained invalid projection versions or inconsistent entity identities.');
      const bootstrap = value as Bootstrap;
      for (const projection of bootstrap.projections) {
        const observed = observedProjections[projection.machineId];
        const current = runtime.getState().projections[projection.machineId];
        if (observed ? !current || current.generation !== observed.generation || current.revision > observed.revision : !!current) continue;
        runtime.getState().install(projection);
      }
      if (disposed || generation !== scopeGeneration || queues.get(key) !== queue) return;
      const latest = commandFor(queue);
      const draftValue = latest ? latest.value : queue.draftValue;
      for (const command of queue.commands) {
        command.resolve?.();
        command.resolve = undefined;
        command.reject = undefined;
      }
      queue.commands = [];
      queue.inFlight = undefined;
      queue.paused = false;
      queue.reconciling = false;
      queue.hasDraft = latest !== undefined || queue.hasDraft;
      queue.draftValue = draftValue;
      queue.lastStatus = queue.hasDraft ? 'draft' : 'saved';
      queue.message = queue.hasDraft ? 'Server state loaded. Your previous value is an editable draft and was not resubmitted.' : 'Server state loaded.';
      publish(queue);
      removeIfFinished(key, queue);
    } catch (error) {
      if (queues.get(key) === queue) {
        queue.reconciling = false;
        removeIfFinished(key, queue);
        if (!queue.paused) void sendNext(key, queue, scopeGeneration);
      }
      throw error;
    }
  };

  const unsubscribe = runtime.subscribe((state, previous) => {
    if (state.confirmedThreads === previous.confirmedThreads && state.confirmedProjects === previous.confirmedProjects) return;
    for (const [key, queue] of queues) inspectAcknowledgements(key, queue);
  });

  const changeScope = (nextScope: string) => {
    if (nextScope === recoveryScope) return;
    scopeGeneration++;
    recoveryScope = nextScope;
    for (const queue of queues.values()) {
      for (const command of queue.commands) {
        command.reject?.(new Error('The recovery scope changed before this metadata save completed.'));
        command.cancel?.();
        command.resolve = undefined;
        command.reject = undefined;
      }
    }
    queues.clear();
    runtime.getState().clearMetadataFields();
  };

  return {
    setThreadArchived: (thread: Thread, archived: boolean, explicitlyConfirmed = false) => submit({ kind: 'thread', machineId: thread.machineId, entityId: thread.id }, 'archived', archived, explicitlyConfirmed),
    updateThreadArchiveDraft,
    renameThread: (thread: Thread, title: string | null, explicitlyConfirmed = false) => submit({ kind: 'thread', machineId: thread.machineId, entityId: thread.id }, 'titleOverride', title === null ? null : title.trim(), explicitlyConfirmed),
    renameProject: (project: Project, name: string, explicitlyConfirmed = false) => submit({ kind: 'project', machineId: project.machineId ?? 'local', entityId: project.logicalId ?? project.id }, 'name', name.trim(), explicitlyConfirmed),
    reconcileThread: (thread: Thread, field: ThreadMetadataField) => reconcile({ kind: 'thread', machineId: thread.machineId, entityId: thread.id }, field),
    reconcileProject: (project: Project) => reconcile({ kind: 'project', machineId: project.machineId ?? 'local', entityId: project.logicalId ?? project.id }, 'name'),
    changeScope,
    dispose: () => {
      if (disposed) return;
      disposed = true; scopeGeneration++;
      for (const queue of queues.values()) for (const command of queue.commands) {
        command.reject?.(new Error('The metadata controller was disposed before this save completed.'));
        command.cancel?.();
      }
      queues.clear();
      unsubscribe();
    },
  };
}

export type PendingMetadataController = ReturnType<typeof createPendingMetadataController>;
