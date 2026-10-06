import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { HerdrTarget } from '../src/server/transport/herdr-target';
import { SocketApi } from '../src/server/protocol/socket';
import { requestDeadline } from '../src/server/protocol/deadlines';
import { MetadataDatabase } from '../src/server/storage/database';
import { LaunchJournal } from '../src/server/runtime/launch';
import { schemaFixture } from './fixtures/schema';
import { snapshot, launch } from './fixtures/target';

type RequestRecord = { id: string; method: string; params: Record<string, unknown> };
const fixture = vi.hoisted(() => ({ delay: 6000 as number | null, calls: [] as RequestRecord[], startAt: 0 }));
vi.mock('node:net', async () => {
  const { EventEmitter } = await import('node:events');
  return { connect: () => {
    const socket = new class extends EventEmitter {
      destroyed = false;
      write(raw: string) {
        const record = JSON.parse(raw) as RequestRecord; fixture.calls.push(record);
        let result: Record<string, unknown> = { type: 'pong', version: '0.9.3', protocol: 22 };
        if (record.method === 'pane.read') result = { type: 'pane_read', read: { text: 'agent ready' } };
        if (record.method === 'pane.process_info') result = { type: 'process_info', process_info: { pane_id: 'w1:p1', shell_pid: 10, foreground_processes: [{ pid: 10, name: 'zsh' }] } };
        if (record.method === 'worktree.create') result = { type: 'worktree_created', root_pane: snapshot().panes[0], tab: snapshot().tabs[0] };
        if (record.method === 'agent.start') { fixture.startAt = Date.now(); result = { type: 'agent_started', agent: { name: record.params.name, pane_id: record.params.pane_id, terminal_id: 'term_fixture', agent: record.params.kind, agent_status: 'idle' } }; }
        const respond = () => { if (!this.destroyed) this.emit('data', Buffer.from(JSON.stringify({ id: record.id, result }) + '\n')); };
        if (['agent.start', 'worktree.create'].includes(record.method)) { if (fixture.delay !== null) setTimeout(respond, fixture.delay); }
        else queueMicrotask(respond);
      }
      destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } }
    }();
    queueMicrotask(() => socket.emit('connect')); return socket;
  } };
});

const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.useRealTimers(); vi.unstubAllEnvs(); });
async function setup(delay: number | null) {
  vi.useFakeTimers(); fixture.delay = delay; fixture.calls = []; vi.stubEnv('WEBR_CONNECT', '1'); vi.stubEnv('HERDR_ENV', undefined);
  const profile = { id: 'fixture', name: 'Fake only', transport: 'local' as const, session: 'fixture', socket: '/fixture/api.sock', enabled: true, locations: [{ projectId: 'project', path: '/fixture', workspaceId: 'w1' }] };
  const target = new HerdrTarget(profile, { process: async (_command, args) => args[0] === '--version' ? 'herdr 0.9.3' : args[0] === 'api' ? JSON.stringify(schemaFixture()) : args[1] === 'command -v "$1"' ? '/bin/' + args[3] : '', cli: () => { throw new Error('No terminal CLI is needed for this fixture'); } });
  cleanup.push(() => target.close()); await target.catalog(launch.projectId); return target;
}
it('waits for a six-second startup within the thirty-second server readiness budget through the real target adapter', async () => {
  const target = await setup(6000); let finished = false;
  const startup = target.start(launch, 'w1:p1', randomUUID()).then(() => { finished = true; });
  await vi.advanceTimersByTimeAsync(0); const request = fixture.calls.find((call) => call.method === 'agent.start'); expect(request?.params.timeout_ms).toBe(30_000);
  await vi.advanceTimersByTimeAsync(5001); expect(finished).toBe(false); await vi.advanceTimersByTimeAsync(999); await startup; expect(finished).toBe(true);
  expect(fixture.calls.filter((call) => call.method === 'agent.start')).toHaveLength(1);
});
it('uses a bounded longer worktree deadline without extending health or read deadlines', async () => {
  await setup(6000); const api = new SocketApi('/fixture/api.sock'); cleanup.push(() => api.close());
  const checkout = api.request('worktree.create'); await vi.advanceTimersByTimeAsync(6000); expect((await checkout).type).toBe('worktree_created');
  expect(requestDeadline('worktree.create', {})).toBe(120_000); expect(requestDeadline('ping', {})).toBe(5000); expect(requestDeadline('session.snapshot', {})).toBe(5000);
  fixture.delay = null; const timeout = expect(api.request('worktree.create')).rejects.toThrow('rpc_timeout'); await vi.advanceTimersByTimeAsync(120_000); await timeout;
  await expect(api.request('agent.start', { timeout_ms: 30_000 }, { timeoutMs: Infinity })).rejects.toThrow('invalid_rpc_timeout');
  await expect(api.request('ping', {}, { timeoutMs: 30_000 })).rejects.toThrow('invalid_rpc_timeout');
});
it('records an actual extended startup timeout as unknown and does not replay its effect or send a prompt on recovery', async () => {
  const target = await setup(0); const database = new MetadataDatabase(':memory:'); cleanup.unshift(() => database.close());
  const journal = new LaunchJournal(database, () => {}); cleanup.push(() => journal.stop());
  const key = randomUUID();
  const originalStart = target.start.bind(target); target.start = (...args) => { fixture.delay = null; return originalStart(...args); };
  const operation = journal.submit('fixture-owner', key, launch, target);
  await vi.advanceTimersByTimeAsync(1); expect(database.operation(operation.operationId)?.step).toBe('start');
  await vi.advanceTimersByTimeAsync(fixture.startAt + 35_000 - Date.now() - 1); expect(database.operation(operation.operationId)?.state).toBe('running');
  await vi.advanceTimersByTimeAsync(1); expect(database.operation(operation.operationId)?.state).toBe('unknown');
  const recovered = new LaunchJournal(database, () => {}); const repeated = recovered.submit('fixture-owner', key, launch, target); expect(repeated.operationId).toBe(operation.operationId);
  await vi.advanceTimersByTimeAsync(10_000); expect(fixture.calls.filter((call) => call.method === 'worktree.create')).toHaveLength(1); expect(fixture.calls.filter((call) => call.method === 'agent.start')).toHaveLength(1); expect(fixture.calls.some((call) => call.method === 'agent.prompt')).toBe(false);
});
