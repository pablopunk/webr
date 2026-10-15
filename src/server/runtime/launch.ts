import { randomUUID } from 'node:crypto';
import type { MetadataDatabase } from '../storage/database';
import type { TargetAdapter } from './target';
import { launchInput, launchOperationEnvelope, type LaunchAcceptance, type LaunchInput, type LaunchOperationStatus } from '../../shared/runtime';
import type { Thread } from '../../lib/models';
import { sameSession } from './recovery';

export type LaunchTargetIdentity = { fingerprint: string; session: string; configVersion: number };
type StoredOperation = Exclude<ReturnType<MetadataDatabase['operation']>, undefined>;
type TargetIsCurrent = (target: TargetAdapter, identity: LaunchTargetIdentity) => boolean;

function acceptance(operation: StoredOperation): LaunchAcceptance {
  const envelope = launchOperationEnvelope.parse({
    operationId: operation.id, kind: operation.kind, state: operation.state, step: operation.step,
    result: { threadId: operation.threadId }, ...(operation.error ? { error: operation.error } : {}),
    statusUrl: `/api/operations/${operation.id}`,
  });
  return { ...envelope, id: operation.threadId };
}

const safeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  return /^[a-z][a-z0-9_]{0,79}$/.test(message) ? message : 'launch_failed';
};

export class LaunchJournal {
  private queues = new Map<string, Promise<void>>();
  private stopping = false;
  constructor(private database: MetadataDatabase, private publish: () => void) { database.markInterruptedLaunches(); }
  lookup(accountId: string, key: string, input: LaunchInput) {
    const operation = this.database.findLaunch(accountId, 'thread', key, launchInput.parse(input));
    return operation ? acceptance(operation) : undefined;
  }
  envelope(operation: StoredOperation): LaunchOperationStatus {
    const response = acceptance(operation);
    return { ...response, id: operation.id, threadId: operation.threadId };
  }
  submit(accountId: string, key: string, input: LaunchInput, target: TargetAdapter, targetIsCurrent?: TargetIsCurrent) {
    const normalized = launchInput.parse(input);
    const previous = this.database.findLaunch(accountId, 'thread', key, normalized);
    if (previous) return acceptance(previous);
    if (this.stopping) throw new Error('gateway_stopping');
    const identity: LaunchTargetIdentity = { fingerprint: target.fingerprint, session: target.session, configVersion: target.configVersion };
    const isCurrent = targetIsCurrent ?? ((candidate, captured) => candidate === target && this.matchesIdentity(candidate, captured));
    this.assertTarget(target, identity, isCurrent);
    const thread: Thread = {
      id: randomUUID(), avatarIndex: this.database.nextAvatarIndex(), metadataVersion: 0, titleSync: { version: 0, state: 'unknown' }, projectId: normalized.projectId, machineId: target.id,
      title: normalized.prompt.split('\n')[0].slice(0, 90), prompt: normalized.prompt, agent: normalized.agent, model: normalized.model,
      status: 'unknown', updatedAt: new Date().toISOString(), branch: '', worktree: normalized.worktree, ownsWorktree: normalized.worktree,
      session: target.session, tabId: '', panes: [], bindingState: 'pending', bindingFingerprint: identity.fingerprint,
      bindingConfigVersion: identity.configVersion, ownerToken: randomUUID(), recovery: { state: 'unbound', reason: 'session_report_missing' },
    };
    const { operation, created } = this.database.beginLaunch(accountId, key, normalized, thread, identity);
    if (created) {
      const scope = target.id + '\0' + normalized.projectId;
      const prior = this.queues.get(scope) ?? Promise.resolve();
      const next = prior.then(() => this.run(operation.id, normalized, target, identity, isCurrent, thread));
      this.queues.set(scope, next);
      void next.finally(() => { if (this.queues.get(scope) === next) this.queues.delete(scope); });
      this.publish();
    }
    return acceptance(operation);
  }
  async stop() { this.stopping = true; await Promise.allSettled([...this.queues.values()]); }
  private matchesIdentity(target: TargetAdapter, identity: LaunchTargetIdentity) {
    return target.fingerprint === identity.fingerprint && target.session === identity.session && target.configVersion === identity.configVersion;
  }
  private assertTarget(target: TargetAdapter, identity: LaunchTargetIdentity, isCurrent: TargetIsCurrent) {
    if (!this.matchesIdentity(target, identity) || !isCurrent(target, identity)) throw new Error('launch_target_changed');
  }
  private async run(id: string, input: LaunchInput, target: TargetAdapter, identity: LaunchTargetIdentity, isCurrent: TargetIsCurrent, thread: Thread) {
    let step = 'validate';
    let result: Record<string, unknown> = {};
    try {
      this.assertTarget(target, identity, isCurrent);
      const catalog = await target.catalog(input.projectId);
      this.assertTarget(target, identity, isCurrent);
      if (this.stopping) throw new Error('gateway_stopping');
      const harness = catalog.harnesses.find((item) => item.id === input.agent);
      if (!catalog.connected || !harness?.launchEnabled || target.canLaunch && !target.canLaunch(input) || !target.locations.some((location) => location.projectId === input.projectId)) throw new Error('launch_unavailable');
      step = 'checkout'; this.database.updateOperation(id, 'running', step, result); this.publish();
      this.assertTarget(target, identity, isCurrent);
      const created = await target.create(input, thread.id);
      result = { ...created };
      this.assertTarget(target, identity, isCurrent);
      this.database.db.transaction(() => {
        const latest = this.database.threadRows(target.id, target.session).find((row) => row.id === thread.id);
        const { tabId, paneId: _paneId, terminalId: _terminalId, workspaceId: _workspaceId, ...capture } = created;
        thread = { ...thread, ...latest?.metadata, ...capture, tabId };
        this.database.saveThreadInTransaction(thread, [created.terminalId], created.tabId);
        this.database.updateOperation(id, 'running', 'checkout_complete', result);
      });
      if (this.stopping) throw new Error('gateway_stopping');
      this.assertTarget(target, identity, isCurrent);
      step = 'start'; this.database.updateOperation(id, 'running', step, result); this.publish();
      const capture = await target.start(input, created.paneId, thread.id, thread.ownerToken);
      this.assertTarget(target, identity, isCurrent);
      this.database.db.transaction(() => {
        const latest = this.database.threadRows(target.id, target.session).find((row) => row.id === thread.id);
        thread = { ...thread, ...latest?.metadata };
        if (capture.providerSession && thread.providerSession && !sameSession(capture.providerSession, thread.providerSession)) throw new Error('agent_session_mismatch');
        // Reconciliation may already have captured a later provider report.
        // Missing startup reports must never overwrite that durable identity.
        if (thread.expectedCwd && capture.observedCwd && thread.expectedCwd !== capture.observedCwd) throw new Error(input.worktree ? 'launch_worktree_mismatch' : 'launch_location_mismatch');
        if (thread.expectedRepository && capture.expectedRepository && thread.expectedRepository !== capture.expectedRepository || thread.expectedCheckout && capture.expectedCheckout && thread.expectedCheckout !== capture.expectedCheckout) throw new Error('launch_worktree_mismatch');
        thread = { ...thread, ...capture, expectedCwd: thread.expectedCwd ?? capture.expectedCwd,
          observedCwd: capture.observedCwd ?? thread.observedCwd, expectedRepository: thread.expectedRepository ?? capture.expectedRepository, expectedCheckout: thread.expectedCheckout ?? capture.expectedCheckout };
        if (thread.providerSession && thread.recovery?.state !== 'needs_attention') thread.recovery = { state: 'active' };
        this.database.saveThreadInTransaction(thread, latest?.anchors.length ? latest.anchors : [created.terminalId], latest?.alias ?? created.tabId);
        result = { ...result, ...capture };
        this.database.updateOperation(id, 'running', 'start_complete', result);
      });
      if (this.stopping) throw new Error('gateway_stopping');
      this.assertTarget(target, identity, isCurrent);
      step = 'prompt'; this.database.updateOperation(id, 'running', step, result); this.publish();
      await target.prompt(created.paneId, input.prompt, created.terminalId, thread.id, input);
      this.database.updateOperation(id, 'ready', 'ready', result);
    } catch (error) {
      const message = safeError(error);
      console.error(`launch ${id} stopped at ${step}:`, message);
      this.database.updateOperation(id, step === 'validate' ? 'failed' : 'unknown', step, result, message);
    }
    this.publish();
  }
}
