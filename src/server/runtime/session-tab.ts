import { isListedThread } from '../../lib/launch';
import type { RuntimeManager } from './manager';

export function decodeSessionTabId(value: string | undefined) {
  if (!value) return '';
  try { return decodeURIComponent(value); }
  catch { return ''; }
}

export async function resolveSessionTab(manager: Pick<RuntimeManager, 'bootstrap' | 'supervisors'>, session: string, machineId: string | null, tabId: string) {
  const resolve = () => {
    const bootstrap = manager.bootstrap();
    const thread = machineId ? bootstrap.threads.find((item) => item.machineId === machineId && item.session === session && item.tabId === tabId && item.bindingState === 'attached' && isListedThread(item)) : undefined;
    const machine = machineId ? bootstrap.machines.find((item) => item.id === machineId && item.session === session) : undefined;
    const terminalTab = !thread && machine ? bootstrap.projections.find((projection) => projection.machineId === machine.id)?.availableTabs?.find((item) => item.tabId === tabId && !item.bound && item.panes.length > 0) : undefined;
    const page = thread ? 'thread' as const : machine ? 'terminal' as const : 'missing' as const;
    return { bootstrap, thread, machine, terminalTab, page, terminalPending: page === 'terminal' && !thread && !terminalTab };
  };

  let route = resolve();
  if (route.terminalPending && route.machine?.connected) {
    try { await manager.supervisors.get(route.machine.id)?.readFresh(); } catch { /* Keep the pending terminal view; the live projection can still catch up. */ }
    route = resolve();
  }
  return route;
}
