import { afterEach, expect, it, vi } from 'vitest';
import { ThreadTickets } from '../src/client/create-tickets';
import type { LaunchInput } from '../src/shared/runtime';
import type { NewThreadDraft } from '../src/client/new-thread-draft';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}
class DeniedStorage extends MemoryStorage {
  setItem() { throw new Error('storage denied'); }
}

const operationId = '11111111-1111-4111-8111-111111111111';
const input: LaunchInput = { machineId: 'local', projectId: 'local:first', prompt: 'Fix this parser /uploads/source.png', agent: 'claude', model: 'Default', worktree: true };
const draft: NewThreadDraft = {
  prompt: 'Fix this parser', projectId: 'local:first', machineId: 'local', harness: 'claude', worktree: true,
  images: [{ id: 'image-1', name: 'source.png', preview: 'data:image/png;base64,AA==', path: '/uploads/source.png' }],
};
const envelope = (state: 'pending' | 'running' | 'ready' | 'failed' | 'unknown') => ({
  operationId, kind: 'thread', state, step: state === 'ready' ? 'ready' : 'validate',
  result: { threadId: 'thread-real-id' }, statusUrl: `/api/operations/${operationId}`,
});
const json = (value: unknown, status = 202) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

let session: MemoryStorage;
let local: MemoryStorage;
function installStorage(sessionStorage: MemoryStorage = new MemoryStorage()) {
  session = sessionStorage; local = new MemoryStorage();
  vi.stubGlobal('sessionStorage', session);
  vi.stubGlobal('localStorage', local);
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('stores only prompt and attachment references in recoveryScope-namespaced session tickets', () => {
  installStorage();
  const tickets = new ThreadTickets('server-account-scope');
  const ticket = tickets.create(input, draft);
  const key = session.key(0)!;
  const saved = JSON.parse(session.getItem(key)!);

  expect(key).toContain('server-account-scope');
  expect(saved).toMatchObject({ kind: 'thread', endpoint: '/api/threads', key: ticket.key, normalizedPayload: input });
  expect(saved.draft.images).toEqual([{ id: 'image-1', name: 'source.png', path: '/uploads/source.png' }]);
  expect(JSON.stringify(saved)).not.toContain('data:image');
  expect(JSON.stringify(saved)).not.toContain('output');
  expect(local.length).toBe(0);
});

it('reuses the exact key and normalized payload after a lost acceptance response', async () => {
  installStorage();
  let posts = 0;
  const requests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  const fetcher = async (request: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ input: request, init });
    if (init?.method === 'POST' && ++posts === 1) throw new TypeError('connection reset after acceptance');
    if (init?.method === 'POST') return json(envelope('running'));
    return json(envelope('ready'));
  };
  const tickets = new ThreadTickets('scope-a', { fetch: fetcher, sleep: async () => {} });
  const ticket = tickets.create(input, draft);

  await tickets.start(ticket.key);

  const postRequests = requests.filter((request) => request.init?.method === 'POST');
  expect(postRequests).toHaveLength(2);
  expect(postRequests.map(({ init }) => init?.headers)).toEqual([
    { 'Content-Type': 'application/json', 'Idempotency-Key': ticket.key },
    { 'Content-Type': 'application/json', 'Idempotency-Key': ticket.key },
  ]);
  expect(postRequests.map(({ init }) => init?.body)).toEqual([JSON.stringify(input), JSON.stringify(input)]);
  expect(requests.at(-1)?.input).toBe(`/api/operations/${operationId}`);
  expect(tickets.get(ticket.key)?.state).toBe('ready');
  expect(tickets.getDraft(ticket.key)).toBeUndefined();
});

it('recovers an unreadable 2xx acceptance by reposting the same key and payload', async () => {
  installStorage();
  let posts = 0;
  const requests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  const fetcher = async (request: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ input: request, init });
    if (init?.method === 'POST' && ++posts === 1) return new Response('truncated response', { status: 202 });
    return json(envelope('ready'));
  };
  const tickets = new ThreadTickets('scope-malformed-acceptance', { fetch: fetcher, sleep: async () => {} });
  const ticket = tickets.create(input, draft);

  await tickets.start(ticket.key);

  const postRequests = requests.filter((request) => request.init?.method === 'POST');
  expect(postRequests).toHaveLength(2);
  expect(postRequests.map(({ init }) => init?.headers)).toEqual([
    { 'Content-Type': 'application/json', 'Idempotency-Key': ticket.key },
    { 'Content-Type': 'application/json', 'Idempotency-Key': ticket.key },
  ]);
  expect(postRequests.map(({ init }) => init?.body)).toEqual([JSON.stringify(input), JSON.stringify(input)]);
  expect(tickets.get(ticket.key)?.state).toBe('ready');
});

it('recovers an unacknowledged ticket after reload with its original key and payload', async () => {
  installStorage();
  const firstPage = new ThreadTickets('scope-reload');
  const ticket = firstPage.create(input, draft);
  const storedKey = session.key(0)!;
  const lostResponseTicket = JSON.parse(session.getItem(storedKey)!);
  lostResponseTicket.transport = 'checking';
  session.setItem(storedKey, JSON.stringify(lostResponseTicket));
  const requests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  const fetcher = async (request: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ input: request, init });
    return json(envelope('unknown'));
  };
  const reloadedPage = new ThreadTickets('scope-reload', { fetch: fetcher, sleep: async () => {} });

  await reloadedPage.start(ticket.key);

  expect(requests).toHaveLength(1);
  expect(requests[0]?.input).toBe('/api/threads');
  expect(requests[0]?.init?.headers).toEqual({ 'Content-Type': 'application/json', 'Idempotency-Key': ticket.key });
  expect(requests[0]?.init?.body).toBe(JSON.stringify(input));
  expect(reloadedPage.get(ticket.key)?.state).toBe('unknown');
});

it('keeps the ticket in memory and exposes a reload-recovery warning when storage is denied', () => {
  installStorage(new DeniedStorage());
  const tickets = new ThreadTickets('scope-storage-denied');
  const ticket = tickets.create(input, draft);

  expect(tickets.get(ticket.key)?.reloadRecoveryUnavailable).toBe(true);
  expect(tickets.getDraft(ticket.key)?.images[0]?.path).toBe('/uploads/source.png');
  expect(session.length).toBe(0);
});

it('keeps the recovery ticket even when legacy local storage is unavailable', () => {
  installStorage();
  vi.stubGlobal('localStorage', new DeniedStorage());
  const tickets = new ThreadTickets('scope-local-storage-denied');
  const ticket = tickets.create(input, draft);

  expect(ticket.reloadRecoveryUnavailable).toBe(false);
  expect(tickets.get(ticket.key)?.key).toBe(ticket.key);
  expect(session.length).toBe(1);
});

it('does not send a ticket after its access scope is revoked while awaiting the first turn', async () => {
  installStorage();
  let releaseSleep!: () => void;
  let started!: () => void;
  const sleeping = new Promise<void>((resolve) => { started = resolve; });
  const fetcher = vi.fn(async () => json(envelope('running')));
  const tickets = new ThreadTickets('scope-revoked', {
    fetch: fetcher,
    sleep: () => new Promise<void>((resolve) => { releaseSleep = resolve; started(); }),
  });
  const oldTicket = tickets.create(input, draft);
  const pending = tickets.start(oldTicket.key);
  await sleeping;
  tickets.clearOnAccessLoss();
  const newTicket = tickets.create(input, { ...draft, prompt: 'New scoped draft' });
  releaseSleep();

  await pending;

  expect(fetcher).not.toHaveBeenCalled();
  expect(tickets.get(oldTicket.key)).toBeUndefined();
  expect(tickets.get(newTicket.key)?.key).toBe(newTicket.key);
});

it('does not expose a ticket or draft to a different recovery scope', () => {
  installStorage();
  const first = new ThreadTickets('scope-first');
  const ticket = first.create(input, draft);
  const second = new ThreadTickets('scope-second');

  expect(second.get(ticket.key)).toBeUndefined();
  expect(second.getDraft(ticket.key)).toBeUndefined();
});

it('does not replay a prompt or offer another attempt for an unknown outcome', async () => {
  installStorage();
  const fetcher = vi.fn(async () => json(envelope('unknown')));
  const tickets = new ThreadTickets('scope-unknown', { fetch: fetcher, sleep: async () => {} });
  const ticket = tickets.create(input, draft);

  await tickets.start(ticket.key);
  await tickets.start(ticket.key);

  expect(tickets.get(ticket.key)?.state).toBe('unknown');
  expect(tickets.retry(ticket.key)).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('clears scoped tickets and drafts when an accepted operation is no longer visible', async () => {
  installStorage();
  const tickets = new ThreadTickets('scope-status-404', {
    fetch: async (_request, init) => init?.method === 'POST' ? json(envelope('running')) : new Response('{}', { status: 404 }),
    sleep: async () => {},
  });
  const ticket = tickets.create(input, draft);

  await tickets.start(ticket.key);

  expect(tickets.get(ticket.key)).toBeUndefined();
  expect(tickets.getDraft(ticket.key)).toBeUndefined();
  expect(tickets.isAccessLost(ticket.key)).toBe(true);
  expect(session.length).toBe(0);
});

it('clears scoped ticket and draft storage after an access-loss response', async () => {
  installStorage();
  const tickets = new ThreadTickets('scope-expired', { fetch: async () => json({ error: 'unauthorized' }, 403), sleep: async () => {} });
  const ticket = tickets.create(input, draft);
  expect(session.length).toBe(1);

  await tickets.start(ticket.key);

  expect(session.length).toBe(0);
  expect(local.length).toBe(0);
  expect(tickets.isAccessLost(ticket.key)).toBe(true);
});
