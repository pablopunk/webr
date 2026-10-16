import { expect, it } from 'vitest';
import { HerdrActions, modelArguments, agentName } from '../src/server/runtime/herdr-actions';
import { FakeTarget, launch, snapshot } from './fixtures/target';
import { randomUUID } from 'node:crypto';

it('uses the worktree-created initial tab and never creates a second tab', async () => {
  const calls: string[] = []; const state = snapshot();
  const actions = new HerdrActions({ request: async (method) => { calls.push(method); return { type: 'worktree_created', root_pane: state.panes[0], tab: state.tabs[0], workspace: state.workspaces[0] }; } }, new FakeTarget().locations, () => {});
  expect(await actions.create(launch, randomUUID())).toMatchObject({ tabId: 'w1:t1', expectedCwd: '/fixture', expectedRepository: 'fixture', expectedCheckout: '/fixture' }); expect(calls).toEqual(['worktree.create']);
});
it('creates a tab only in the selected workspace when worktree is off', async () => {
  const state = snapshot(); let params: unknown;
  const actions = new HerdrActions({ request: async (method, value) => { expect(method).toBe('tab.create'); params = value; return { type: 'tab_created', root_pane: state.panes[0], tab: state.tabs[0] }; } }, new FakeTarget().locations, () => {});
  await actions.create({ ...launch, worktree: false }, randomUUID()); expect(params).toMatchObject({ workspace_id: 'w1', cwd: '/fixture', focus: false });
});
it('validates native model argv and refuses unsupported adapters rather than sending shell strings', () => {
  expect(modelArguments('claude', 'Default')).toEqual([]); expect(modelArguments('opencode', 'Default')).toEqual([]); expect(modelArguments('opencode', 'host/custom')).toEqual(['--model', 'host/custom']);
  expect(modelArguments('pi', 'Default')).toEqual([]); expect(modelArguments('pi', 'p/x')).toEqual(['--model', 'p/x']); expect(() => modelArguments('fx', 'Default')).toThrow('unsupported_launch_adapter'); expect(() => modelArguments('omp', 'x')).toThrow('unsupported_launch_adapter'); expect(() => modelArguments('nope', 'Default')).toThrow('unsupported_launch_adapter'); expect(() => modelArguments('claude', 'model;unsafe')).toThrow();
});
it('refuses to start FX through Herdr before making any API request', async () => {
  const calls: string[] = [];
  const actions = new HerdrActions({ request: async (method) => { calls.push(method); return {}; } }, new FakeTarget().locations, () => {});
  await expect(actions.start({ ...launch, agent: 'fx' }, 'w1:p1', randomUUID())).rejects.toThrow('unsupported_launch_adapter');
  expect(calls).toEqual([]);
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
it('submits the first prompt if the agent starts working between startup and prompt submission', async () => {
  const id = randomUUID(); const calls: string[] = [];
  const agent = { name: agentName(id), terminal_id: 'term_1', pane_id: 'w1:p1', agent: 'opencode', agent_status: 'idle' };
  const actions = new HerdrActions({ request: async (method) => {
    calls.push(method);
    if (method === 'pane.process_info') return { process_info: { shell_pid: 10, foreground_processes: [{ pid: 10, name: 'zsh' }] } };
    if (method === 'agent.start') return { type: 'agent_started', agent };
    if (method === 'agent.get') return { type: 'agent_info', agent: { ...agent, agent_status: 'working' } };
    if (method === 'agent.prompt') return { type: 'agent_prompted', agent: { ...agent, agent_status: 'working' } };
    throw new Error(`Unexpected request: ${method}`);
  } }, new FakeTarget().locations, () => {});
  const input = { ...launch, agent: 'opencode' };
  await actions.start(input, 'w1:p1', id);
  await actions.prompt('w1:p1', 'hello', 'term_1', id, 'opencode', input);
  expect(calls).toEqual(['pane.process_info', 'agent.start', 'agent.get', 'agent.prompt']);
});
it('does not send a prompt to a blocked agent', async () => {
  const id = randomUUID(); const calls: string[] = [];
  const agent = { name: agentName(id), terminal_id: 'term_1', pane_id: 'w1:p1', agent: 'opencode', agent_status: 'blocked' };
  const actions = new HerdrActions({ request: async (method) => { calls.push(method); return { type: 'agent_info', agent }; } }, new FakeTarget().locations, () => {});
  await expect(actions.prompt('w1:p1', 'hello', 'term_1', id, 'opencode')).rejects.toThrow('agent_blocked');
  expect(calls).toEqual(['agent.get']);
});
it('removes a worktree only when the thread owns it and otherwise only closes the tab', async () => {
  const discard = async (state: ReturnType<typeof snapshot>, removeWorktree: boolean) => { const calls: [string, unknown][] = []; await new HerdrActions({ request: async (method, params) => { calls.push([method, params]); return {}; } }, new FakeTarget().locations, () => {}).discardTab(state, 'w1:t1', removeWorktree); return calls; };
  const shared = snapshot(); shared.tabs.push({ tab_id: 'w1:t2', workspace_id: 'w1', label: 'Other' });
  expect(await discard(shared, true)).toEqual([['tab.close', { tab_id: 'w1:t1' }]]);
  expect(await discard(snapshot(), false)).toEqual([['tab.close', { tab_id: 'w1:t1' }]]);
  const worktree = snapshot(); worktree.workspaces[0].worktree!.is_linked_worktree = true;
  expect(await discard(worktree, false)).toEqual([['tab.close', { tab_id: 'w1:t1' }]]);
  expect(await discard(worktree, true)).toEqual([['worktree.remove', { workspace_id: 'w1', force: true }]]);
  const gone = snapshot(); gone.tabs = [];
  expect(await discard(gone, true)).toEqual([]);
});
it('renames the Herdr tab and renames the workspace only for a thread that owns it alone', async () => {
  const rename = async (state: ReturnType<typeof snapshot>, renameWorkspace: boolean) => { const calls: [string, unknown][] = []; await new HerdrActions({ request: async (method, params) => { calls.push([method, params]); return {}; } }, new FakeTarget().locations, () => {}).renameTab(state, 'w1:t1', 'New name', renameWorkspace); return calls; };
  const tabOnly = [['tab.rename', { tab_id: 'w1:t1', label: 'New name' }]];
  expect(await rename(snapshot(), true)).toEqual([...tabOnly, ['workspace.rename', { workspace_id: 'w1', label: 'New name' }]]);
  expect(await rename(snapshot(), false)).toEqual(tabOnly);
  const shared = snapshot(); shared.tabs.push({ tab_id: 'w1:t2', workspace_id: 'w1', label: 'Other' });
  expect(await rename(shared, true)).toEqual(tabOnly);
});
it('splits a terminal from the agent pane in its directory and leaves the agent most of the space', async () => {
  const calls: [string, unknown][] = []; const state = snapshot();
  const actions = new HerdrActions({ request: async (method, params) => { calls.push([method, params]); return { type: 'pane_info', pane: { ...state.panes[0], pane_id: 'w1:p2', terminal_id: 'term_shell' } }; } }, new FakeTarget().locations, () => {});
  expect(await actions.splitTerminal(state, 'w1:p1', 'down')).toBe('w1:p2');
  expect(calls).toEqual([['pane.split', { target_pane_id: 'w1:p1', direction: 'down', ratio: 0.5, cwd: '/fixture', focus: false }]]);
});
it('lists worktrees of the workspace and opens one by path without focusing it', async () => {
  const calls: [string, unknown][] = [];
  const entry = { path: '/fixture/wt', branch: 'feature', label: 'fixture', is_bare: false, is_prunable: false, open_workspace_id: null };
  const actions = new HerdrActions({ request: async (method, params) => { calls.push([method, params]); return { type: 'worktree_list', worktrees: [entry] }; } }, new FakeTarget().locations, () => {});
  expect(await actions.worktrees('w1')).toEqual([entry]); await actions.openWorktree('w1', '/fixture/wt');
  expect(calls).toEqual([['worktree.list', { workspace_id: 'w1' }], ['worktree.open', { workspace_id: 'w1', path: '/fixture/wt', focus: false }]]);
});
it('emits a separate owner token before agent start and captures an immediately reported provider session', async () => {
  const id = randomUUID(); const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const providerSession = { source: 'herdr:omp', agent: 'omp', kind: 'path' as const, value: '/provider/session.jsonl' };
  const agent = { name: agentName(id), terminal_id: 'term_1', pane_id: 'w1:p1', agent: 'omp', agent_status: 'idle', agent_session: providerSession, cwd: '/fixture', foreground_cwd: '/fixture/checkout' };
  const actions = new HerdrActions({ request: async (method, params) => {
    calls.push({ method, params });
    if (method === 'pane.process_info') return { process_info: { shell_pid: 10, foreground_processes: [{ pid: 10 }] } };
    if (method === 'pane.report_metadata') return { type: 'ok' };
    return { type: 'agent_started', agent };
  } }, new FakeTarget().locations, () => {});
  expect(await actions.start({ ...launch, agent: 'omp' }, 'w1:p1', id, 'durable-owner')).toEqual({ providerSession, observedCwd: '/fixture/checkout' });
  expect(calls.map((call) => call.method)).toEqual(['pane.process_info', 'pane.report_metadata', 'agent.start']);
  expect(calls[1].params).toEqual({ pane_id: 'w1:p1', source: 'webr', tokens: { webr_owner: 'durable-owner' } });
});
it('returns an unreported provider safely without waiting for a provider session', async () => {
  const id = randomUUID(); const calls: string[] = [];
  const actions = new HerdrActions({ request: async (method) => {
    calls.push(method);
    return method === 'pane.process_info' ? { process_info: { shell_pid: 10, foreground_processes: [{ pid: 10 }] } }
      : { type: 'agent_started', agent: { name: agentName(id), terminal_id: 'term_1', pane_id: 'w1:p1', agent: 'opencode', agent_status: 'idle', cwd: '/fixture' } };
  } }, new FakeTarget().locations, () => {});
  expect(await actions.start({ ...launch, agent: 'opencode' }, 'w1:p1', id)).toEqual({ observedCwd: '/fixture' });
  expect(calls).toEqual(['pane.process_info', 'agent.start']);
});
it('captures the authoritative report returned by normal readiness detection', async () => {
  const id = randomUUID(); const base = { name: agentName(id), terminal_id: 'term_1', pane_id: 'w1:p1' };
  const providerSession = { source: 'herdr:claude', agent: 'claude', kind: 'id' as const, value: 'provider-id' };
  const actions = new HerdrActions({ request: async (method) => {
    if (method === 'pane.process_info') return { process_info: { shell_pid: 10, foreground_processes: [{ pid: 10 }] } };
    if (method === 'agent.start') return { type: 'agent_started', agent: { ...base, agent: null, agent_status: 'unknown' } };
    return { type: 'agent_info', agent: { ...base, agent: 'claude', agent_status: 'idle', agent_session: providerSession } };
  } }, new FakeTarget().locations, () => {});
  expect(await actions.start(launch, 'w1:p1', id)).toEqual({ providerSession });
});
it('rejects a session report for another provider rather than persisting its identity', async () => {
  const id = randomUUID();
  const actions = new HerdrActions({ request: async (method) => method === 'pane.process_info' ? { process_info: { shell_pid: 10, foreground_processes: [{ pid: 10 }] } }
    : { type: 'agent_started', agent: { name: agentName(id), terminal_id: 'term_1', pane_id: 'w1:p1', agent: 'claude', agent_status: 'idle', agent_session: { source: 'herdr:omp', agent: 'omp', kind: 'path', value: '/wrong/session' } } } }, new FakeTarget().locations, () => {});
  await expect(actions.start(launch, 'w1:p1', id)).rejects.toThrow('agent_session_mismatch');
});
