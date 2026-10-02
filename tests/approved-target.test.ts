import { afterEach, expect, it, vi } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { HerdrTarget } from '../src/server/transport/herdr-target';
import { profileSchema, type TargetProfile } from '../src/server/transport/registry';
import { snapshot, launch } from './fixtures/target';
import { schemaFixture } from './fixtures/schema';
import { NdjsonParser } from '../src/server/protocol/ndjson';
import { openCliStream } from '../src/server/terminal/cli';

const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.unstubAllEnvs(); });
async function setup(automatic = false, empty = false) {
  vi.stubEnv('HERDR_ENV', undefined); vi.stubEnv('HERDR_WEB_CONNECT', '1');
  const directory = await mkdtemp(join(tmpdir(), 'hc-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'api.sock'); const sockets = new Set<Socket>(); const calls: { method: string; params: Record<string, unknown> }[] = [];
  const state = snapshot(); let agent: Record<string, unknown> = {};
  if (empty) { state.workspaces = []; state.tabs = []; state.panes = []; state.layouts = []; state.agents = []; }
  const server = createServer((socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    const parser = new NdjsonParser((value) => {
      const record = value as { id: string; method: string; params: Record<string, unknown> }; calls.push(record);
      let result: Record<string, unknown> = {};
      if (record.method === 'ping') result = { type: 'pong', version: '0.9.3', protocol: 22 };
      if (record.method === 'session.snapshot') result = { type: 'session_snapshot', snapshot: state };
      if (record.method === 'events.subscribe') result = { type: 'subscription_started' };
      if (record.method === 'workspace.create') {
        Object.assign(state, snapshot());
        result = { type: 'workspace_created', workspace: state.workspaces[0], tab: state.tabs[0], root_pane: state.panes[0] };
      }
      if (record.method === 'worktree.create' || record.method === 'tab.create') result = { type: record.method === 'worktree.create' ? 'worktree_created' : 'tab_created', root_pane: state.panes[0], tab: state.tabs[0] };
      if (record.method === 'pane.read') result = { type: 'pane_read', read: { text: 'agent ready' } };
      if (record.method === 'pane.process_info') result = { type: 'process_info', process_info: { pane_id: 'w1:p1', shell_pid: 10, foreground_processes: [{ pid: 10, name: 'zsh' }] } };
      if (record.method === 'agent.start') { agent = { name: record.params.name, terminal_id: state.panes[0].terminal_id, pane_id: state.panes[0].pane_id, agent: record.params.kind, agent_status: 'idle' }; result = { type: 'agent_started', agent }; }
      if (record.method === 'agent.get') result = { type: 'agent_info', agent };
      if (record.method === 'agent.prompt') result = { type: 'agent_prompted', agent };
      socket.write(JSON.stringify({ id: record.id, result }) + '\n'); if (record.method !== 'events.subscribe') socket.end();
    });
    socket.on('data', (chunk) => parser.push(chunk));
  });
  await new Promise<void>((resolve) => server.listen(path, resolve)); cleanup.push(() => new Promise<void>((resolve) => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }));
  const profile: TargetProfile = { id: '0123-fixture', name: 'Owned fake', enabled: true, transport: 'local', session: 'fixture', socket: path, executable: '/fixture/herdr', automatic, locations: automatic ? [] : [{ projectId: 'project', path: '/fixture', workspaceId: 'w1' }] };
  const process = vi.fn(async (_command: string, args: string[]) => args[0] === '--version' ? 'herdr 0.9.3\n' : args[0] === 'api' ? JSON.stringify(schemaFixture()) : '');
  const cli = vi.fn((..._args: Parameters<typeof openCliStream>) => ({ send: vi.fn(), close: vi.fn() }));
  const target = new HerdrTarget(profile, { process, cli }); cleanup.push(() => target.close());
  return { target, profile, process, cli, calls };
}
it('connects a standalone approved application without HERDR_ENV using only owned fake sockets and process adapters', async () => {
  const { target, process } = await setup(); const unsubscribe = await target.subscribe(() => {}, () => {}); expect((await target.snapshot()).panes[0].terminal_id).toBe('term_fixture');
  expect(process.mock.calls[0][0]).toBe('/fixture/herdr'); expect(globalThis.process.env.HERDR_ENV).toBeUndefined(); expect(target.writable).toBe(true); unsubscribe();
});
it('refuses to connect unless the target is approved', async () => {
  const { profile } = await setup(); vi.stubEnv('HERDR_WEB_CONNECT', '0');
  const disabled = new HerdrTarget(profile); cleanup.push(() => disabled.close()); await expect(disabled.snapshot()).rejects.toThrow('connection_not_approved');
});
it('offers control and launch for every Herdr-supported harness once the target is compatible', async () => {
  const { target, cli, calls } = await setup(); expect(target.writable).toBe(false); await target.snapshot();
  expect(target.writable).toBe(true); target.openTerminal('term_fixture', 'control', 80, 24, true, () => {}, () => {}); expect(cli.mock.calls[0][0]).toBe('/fixture/herdr'); expect(cli.mock.calls[0][1]).toContain('control'); expect(cli.mock.calls[0][1]).toContain('--takeover');
  const input = { ...launch, machineId: target.id, projectId: '0123-fixture:project' }; const id = randomUUID(); const created = await target.create(input, id); await target.start(input, created.paneId, id); await target.prompt(created.paneId, input.prompt, created.terminalId, id, input);
  expect(calls.filter((call) => call.method === 'agent.prompt')).toHaveLength(1); expect(calls.filter((call) => call.method === 'tab.create')).toHaveLength(0);
  expect(target.canLaunch({ ...input, agent: 'codex' })).toBe(true); expect(target.canLaunch({ ...input, model: 'custom' })).toBe(true); expect(target.canLaunch({ ...input, agent: 'pi' as 'claude' })).toBe(false);
  const harnesses = (await target.catalog(input.projectId)).harnesses; expect(harnesses.find((choice) => choice.id === 'claude')).toMatchObject({ launchEnabled: true, customModels: true }); expect(harnesses.find((choice) => choice.id === 'pi')?.launchEnabled).toBe(false);
  await expect(target.start({ ...input, model: 'bad;model' }, created.paneId, id)).rejects.toThrow('unsupported_launch_adapter');
  target.close(); expect(target.writable).toBe(false); await expect(target.create(input, randomUUID())).rejects.toThrow('launch_unavailable');
});
it('accepts native opaque profile IDs and rejects unsupported bundled fields before becoming compatible', async () => {
  const { profile } = await setup(); expect(profileSchema.parse(profile).id).toBe('0123-fixture');
  const invalid = new HerdrTarget(profile, { process: async (_command, args) => args[0] === '--version' ? 'herdr 0.9.3' : '{}', cli: () => { throw new Error('must not reach CLI'); } }); cleanup.push(() => invalid.close());
  await expect(invalid.snapshot()).rejects.toThrow('unsupported_herdr_schema'); expect(invalid.writable).toBe(false);
});
it('connects automatic Local without a registry opt-in and discovers native projects without changing agents', async () => {
  const { target, calls } = await setup(true); vi.stubEnv('HERDR_WEB_CONNECT', undefined);
  const state = await target.snapshot();
  expect(state.panes[0].terminal_id).toBe('term_fixture'); expect(target.locations).toHaveLength(1);
  expect(target.writable).toBe(true);
  expect(target.canLaunch({ ...launch, machineId: target.id, projectId: target.locations[0].projectId })).toBe(true);
  expect((await target.catalog()).projectPaths).toEqual({ [target.locations[0].projectId]: target.locations[0].path });
  expect(calls.every((call) => ['ping', 'session.snapshot'].includes(call.method))).toBe(true);
});
it('accepts a connected empty session and creates its first workspace through Herdr with no source or focus change', async () => {
  const { target, calls } = await setup(true, true); vi.stubEnv('HERDR_WEB_CONNECT', undefined);
  expect((await target.snapshot()).workspaces).toEqual([]); expect(target.locations).toEqual([]);
  const result = await target.createWorkspace('/fixture', 'Project', randomUUID());
  expect(result).toMatchObject({ workspaceId: 'w1', terminalId: 'term_fixture' });
  expect(calls.find((call) => call.method === 'workspace.create')?.params).toEqual({ cwd: '/fixture', label: 'Project', focus: false });
  expect((await target.snapshot()).workspaces).toHaveLength(1); expect(target.locations).toHaveLength(1);
});
