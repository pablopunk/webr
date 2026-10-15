import type { AppNavigate } from './app-navigation';
import type { Machine } from '../lib/machines';
import { terminalStartupStorageKey, type TerminalStartupPreset } from './terminal-presets';
import { createTerminalTab } from './thread-actions';

export async function openTerminalTab(machine: Pick<Machine, 'id' | 'session'>, path: string, key: string, startup: TerminalStartupPreset | undefined, navigate: AppNavigate) {
  const { tabId } = await createTerminalTab(machine.id, path, key);
  const query = new URLSearchParams({ machine: machine.id });
  if (startup) {
    try { sessionStorage.setItem(terminalStartupStorageKey(machine.id, tabId), startup); } catch { /* The startup query is still a usable fallback. */ }
    query.set('startup', startup);
  }
  await navigate(`/sessions/${encodeURIComponent(machine.session)}/tabs/${encodeURIComponent(tabId)}?${query}`);
}
