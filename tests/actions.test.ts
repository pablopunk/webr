import { expect, it } from 'vitest';
import { HerdrActions, modelArguments, agentName } from '../src/server/runtime/herdr-actions';
import { FakeTarget, launch, snapshot } from './fixtures/target';
import { randomUUID } from 'node:crypto';

it('uses the worktree-created initial tab and never creates a second tab', async () => {
  const calls: string[] = []; const state = snapshot();
  const actions = new HerdrActions({ request: async (method) => { calls.push(method); return { type: 'worktree_created', root_pane: state.panes[0], tab: state.tabs[0] }; } }, new FakeTarget().locations, () => {});
  expect((await actions.create(launch, randomUUID())).tabId).toBe('w1:t1'); expect(calls).toEqual(['worktree.create']);
});
it('creates a tab only in the selected workspace when worktree is off', async () => {
  const state = snapshot(); let params: unknown;
  const actions = new HerdrActions({ request: async (method, value) => { expect(method).toBe('tab.create'); params = value; return { type: 'tab_created', root_pane: state.panes[0], tab: state.tabs[0] }; } }, new FakeTarget().locations, () => {});
  await actions.create({ ...launch, worktree: false }, randomUUID()); expect(params).toMatchObject({ workspace_id: 'w1', cwd: '/fixture', focus: false });
});
it('validates native model argv and refuses unsupported adapters rather than sending shell strings', () => {
  expect(modelArguments('claude', 'Default')).toEqual([]); expect(modelArguments('opencode', 'host/custom')).toEqual(['--model', 'host/custom']);
  expect(() => modelArguments('pi', 'Default')).toThrow('unsupported_launch_adapter'); expect(() => modelArguments('claude', 'model;unsafe')).toThrow();
});
it('uses fresh named-agent identity before the only prompt and rejects a changed occupant', async () => {
  const id = randomUUID(); const calls: string[] = [];
  const actions = new HerdrActions({ request: async (method) => { calls.push(method); return { type: 'agent_info', agent: { name: agentName(id), terminal_id: 'term_changed', pane_id: 'w1:p1', agent: 'claude', agent_status: 'idle' } }; } }, new FakeTarget().locations, () => {});
  await expect(actions.prompt('w1:p1', 'never send', 'term_expected', id, 'claude')).rejects.toThrow('agent_occupant_changed'); expect(calls).toEqual(['agent.get']);
});
it('checks the capability before any effect', async () => {
  const actions = new HerdrActions({ request: async () => { throw new Error('must not reach API'); } }, new FakeTarget().locations, () => { throw new Error('not_validated'); });
  await expect(actions.create(launch, randomUUID())).rejects.toThrow('not_validated');
});
it('waits for agent detection after agent.start answers before the agent is known, and refuses another occupant', async () => {
  const id = randomUUID(); const base = { name: agentName(id), terminal_id: 'term_1', pane_id: 'w1:p1' }; const calls: string[] = [];
  const detected = [{ ...base, agent: null, agent_status: 'unknown' }, { ...base, agent: 'claude', agent_status: 'idle' }];
  const actions = new HerdrActions({ request: async (method) => { calls.push(method); return method === 'pane.process_info' ? { process_info: { pane_id: 'w1:p1', shell_pid: 10, foreground_processes: [{ pid: 10, name: 'zsh' }] } } : method === 'agent.start' ? { type: 'agent_started', agent: { ...base, agent: null, agent_status: 'unknown' } } : { type: 'agent_info', agent: detected.shift() }; } }, new FakeTarget().locations, () => {});
  await actions.start(launch, 'w1:p1', id); expect(calls).toEqual(['pane.process_info', 'agent.start', 'agent.get', 'agent.get']);
  const other = new HerdrActions({ request: async (method) => method === 'pane.process_info' ? { process_info: { pane_id: 'w1:p1', shell_pid: 10, foreground_processes: [{ pid: 10, name: 'zsh' }] } } : method === 'agent.start' ? { type: 'agent_started', agent: { ...base, name: 'other', agent: null, agent_status: 'unknown' } } : { type: 'agent_info', agent: {} } }, new FakeTarget().locations, () => {});
  await expect(other.start(launch, 'w1:p1', id)).rejects.toThrow('agent_not_ready');
});
it('does not start the agent while the new pane still runs something other than its shell', async () => {
  const id = randomUUID(); const base = { name: agentName(id), terminal_id: 'term_1', pane_id: 'w1:p1', agent: 'claude', agent_status: 'idle' }; const calls: string[] = [];
  const busy = [[{ pid: 10, name: 'zsh' }, { pid: 11, name: 'mise' }], [{ pid: 10, name: 'zsh' }]];
  const actions = new HerdrActions({ request: async (method) => { calls.push(method); return method === 'pane.process_info' ? { process_info: { pane_id: 'w1:p1', shell_pid: 10, foreground_processes: busy.shift() } } : { type: 'agent_started', agent: base }; } }, new FakeTarget().locations, () => {});
  await actions.start(launch, 'w1:p1', id); expect(calls).toEqual(['pane.process_info', 'pane.process_info', 'agent.start']);
});
it('retries agent.start only while Herdr says the shell has not reached its prompt', async () => {
  const id = randomUUID(); const base = { name: agentName(id), terminal_id: 'term_1', pane_id: 'w1:p1', agent: 'claude', agent_status: 'idle' }; let busy = 2; const calls: string[] = [];
  const shell = { process_info: { pane_id: 'w1:p1', shell_pid: 10, foreground_processes: [{ pid: 10, name: 'zsh' }] } };
  const actions = new HerdrActions({ request: async (method) => { calls.push(method); if (method === 'pane.process_info') return shell; if (busy-- > 0) throw new Error('agent_pane_busy'); return { type: 'agent_started', agent: base }; } }, new FakeTarget().locations, () => {});
  await actions.start(launch, 'w1:p1', id); expect(calls.filter((call) => call === 'agent.start')).toHaveLength(3);
  const refused = new HerdrActions({ request: async (method) => { if (method === 'pane.process_info') return shell; throw new Error('agent_not_supported'); } }, new FakeTarget().locations, () => {});
  await expect(refused.start(launch, 'w1:p1', id)).rejects.toThrow('agent_not_supported');
});
it('sends the first prompt only after the agent screen stops changing', async () => {
  const id = randomUUID(); const agent = { name: agentName(id), terminal_id: 'term_1', pane_id: 'w1:p1', agent: 'opencode', agent_status: 'idle' }; const calls: string[] = [];
  const screens = ['booting', 'loading', 'ready', 'ready', 'ready', 'ready'];
  const actions = new HerdrActions({ request: async (method) => { calls.push(method); return method === 'pane.read' ? { read: { text: screens.shift() ?? 'ready' } } : { type: 'agent_info', agent }; } }, new FakeTarget().locations, () => {});
  await actions.prompt('w1:p1', 'hello', 'term_1', id, 'opencode');
  expect(calls.filter((call) => call === 'pane.read').length).toBeGreaterThanOrEqual(5); expect(calls.at(-1)).toBe('agent.prompt');
});
it('discards a thread with the smallest Herdr effect that removes its tab', async () => {
  const discard = async (state: ReturnType<typeof snapshot>) => { const calls: [string, unknown][] = []; await new HerdrActions({ request: async (method, params) => { calls.push([method, params]); return {}; } }, new FakeTarget().locations, () => {}).discardTab(state, 'w1:t1'); return calls; };
  const shared = snapshot(); shared.tabs.push({ tab_id: 'w1:t2', workspace_id: 'w1', label: 'Other' });
  expect(await discard(shared)).toEqual([['tab.close', { tab_id: 'w1:t1' }]]);
  expect(await discard(snapshot())).toEqual([['workspace.close', { workspace_id: 'w1' }]]);
  const worktree = snapshot(); worktree.workspaces[0].worktree!.is_linked_worktree = true;
  expect(await discard(worktree)).toEqual([['worktree.remove', { workspace_id: 'w1', force: true }]]);
  const gone = snapshot(); gone.tabs = [];
  expect(await discard(gone)).toEqual([]);
});
it('renames the Herdr tab and also its workspace when the thread owns it', async () => {
  const rename = async (state: ReturnType<typeof snapshot>) => { const calls: [string, unknown][] = []; await new HerdrActions({ request: async (method, params) => { calls.push([method, params]); return {}; } }, new FakeTarget().locations, () => {}).renameTab(state, 'w1:t1', 'New name'); return calls; };
  expect(await rename(snapshot())).toEqual([['tab.rename', { tab_id: 'w1:t1', label: 'New name' }], ['workspace.rename', { workspace_id: 'w1', label: 'New name' }]]);
  const shared = snapshot(); shared.tabs.push({ tab_id: 'w1:t2', workspace_id: 'w1', label: 'Other' });
  expect(await rename(shared)).toEqual([['tab.rename', { tab_id: 'w1:t1', label: 'New name' }]]);
});
it('splits a terminal from the agent pane in its directory and leaves the agent most of the space', async () => {
  const calls: [string, unknown][] = []; const state = snapshot();
  const actions = new HerdrActions({ request: async (method, params) => { calls.push([method, params]); return { type: 'pane_info', pane: { ...state.panes[0], pane_id: 'w1:p2', terminal_id: 'term_shell' } }; } }, new FakeTarget().locations, () => {});
  expect(await actions.splitTerminal(state, 'w1:p1', 'down')).toBe('w1:p2');
  expect(calls).toEqual([['pane.split', { target_pane_id: 'w1:p1', direction: 'down', ratio: 0.5, cwd: '/fixture', focus: false }]]);
});
