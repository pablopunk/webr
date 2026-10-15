import type { AppNavigate } from './app-navigation';
import type { Machine } from '../lib/machines';
import type { ThreadTickets } from './create-tickets';
import type { TerminalStartupPreset } from './terminal-presets';
import { buildPendingThreadUrl } from './navigation';

export async function openTerminalTab(machine: Pick<Machine, 'id' | 'session'>, path: string, startup: TerminalStartupPreset | undefined, tickets: ThreadTickets, navigate: AppNavigate) {
  const ticket = tickets.createResource('terminal', { machineId: machine.id, path }, { session: machine.session, startupPreset: startup });
  await navigate(buildPendingThreadUrl(ticket.key, window.location.href, 'resource'));
  void tickets.startResource(ticket.key);
  return ticket;
}
