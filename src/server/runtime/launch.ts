import { randomUUID } from 'node:crypto';
import type { MetadataDatabase } from '../storage/database';
import type { TargetAdapter } from './target';
import type { LaunchInput } from '../../shared/runtime';
import type { Thread } from '../../lib/models';

export class LaunchJournal {
  private queues = new Map<string, Promise<void>>();
  private stopping = false;
  constructor(private database: MetadataDatabase, private publish: () => void) { database.markInterruptedLaunches(); }
  submit(accountId: string, key: string, input: LaunchInput, target: TargetAdapter) {
    if (this.stopping) throw new Error('gateway_stopping');
    const thread: Thread = { id: randomUUID(), avatarIndex: this.database.threadRows().length, projectId: input.projectId, machineId: target.id, title: input.prompt.split('\n')[0].slice(0, 90), prompt: input.prompt, agent: input.agent, model: input.model, status: 'unknown', updatedAt: new Date().toISOString(), branch: '', worktree: input.worktree, session: target.session, tabId: '', panes: [], bindingState: 'pending', bindingFingerprint: target.fingerprint, bindingConfigVersion: target.configVersion };
    const { operation, created } = this.database.beginLaunch(accountId, key, input, thread);
    if (created) {
      const scope = target.id + '\0' + input.projectId;
      const previous = this.queues.get(scope) ?? Promise.resolve();
      const next = previous.then(() => this.run(operation.id, input, target, thread));
      this.queues.set(scope, next);
      void next.finally(() => { if (this.queues.get(scope) === next) this.queues.delete(scope); });
      this.publish();
    }
    return { operationId: operation.id, id: operation.threadId, state: operation.state };
  }
  async stop() { this.stopping = true; await Promise.allSettled([...this.queues.values()]); }
  private async run(id: string, input: LaunchInput, target: TargetAdapter, thread: Thread) {
    let step = 'validate';
    let result: Record<string, unknown> = {};
    try {
      const catalog = await target.catalog(input.projectId);
      if (this.stopping) throw new Error('gateway_stopping');
      const harness = catalog.harnesses.find((harness) => harness.id === input.agent);
      if (!catalog.connected || !harness?.launchEnabled || target.canLaunch && !target.canLaunch(input) || !target.locations.some((location) => location.projectId === input.projectId)) throw new Error('launch_unavailable');
      step = 'checkout'; this.database.updateOperation(id, 'running', step, result); this.publish();
      const created = await target.create(input, thread.id);
      result = { ...created };
      this.database.db.transaction(() => {
        this.database.updateOperation(id, 'running', 'checkout_complete', result);
        thread.tabId = created.tabId;
        this.database.saveThread(thread, [created.terminalId], created.tabId);
      });
      if (this.stopping) throw new Error('gateway_stopping');
      step = 'start'; this.database.updateOperation(id, 'running', step, result); this.publish();
      await target.start(input, created.paneId, thread.id);
      if (this.stopping) throw new Error('gateway_stopping');
      step = 'prompt'; this.database.updateOperation(id, 'running', step, result); this.publish();
      await target.prompt(created.paneId, input.prompt, created.terminalId, thread.id, input);
      this.database.updateOperation(id, 'ready', 'ready', result);
    } catch {
      this.database.updateOperation(id, step === 'validate' ? 'failed' : 'unknown', step, result);
    }
    this.publish();
  }
}
