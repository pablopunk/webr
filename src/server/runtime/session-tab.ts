import { isListedThread } from '../../lib/launch';
import type { RuntimeManager } from './manager';

export function decodeSessionTabId(value: string | undefined) {
  if (!value) return '';
  try { return decodeURIComponent(value); }
  catch { return ''; }
}

export function resolveSessionTab(manager: Pick<RuntimeManager, 'bootstrap'>, session: string, machineId: string | null, tabId: string, owner: string, resourceOwner = owner) {
  const resolve = () => {
    const bootstrap = manager.bootstrap(owner, resourceOwner);
    const thread = machineId ? bootstrap.threads.find((item) => item.machineId === machineId && item.session === session && item.tabId === tabId && item.bindingState === 'attached' && isListedThread(item)) : undefined;
    const machine = machineId ? bootstrap.machines.find((item) => item.id === machineId && item.session === session) : undefined;
    const terminalTab = !thread && machine ? bootstrap.projections.find((projection) => projection.machineId === machine.id)?.availableTabs?.find((item) => item.tabId === tabId && !item.bound && item.panes.length > 0) : undefined;
    const page = thread ? 'thread' as const : machine ? 'terminal' as const : 'missing' as const;
    return { bootstrap, thread, machine, terminalTab, page, terminalPending: page === 'terminal' && !thread && !terminalTab };
  };

  return resolve();
}
