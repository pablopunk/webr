import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PairingPrompt } from '../../src/components/PairingPrompt';
import { RemoteAccess } from '../../src/components/RemoteAccess';
import { describeAuditEvent, relativeFuture, relativeTime } from '../../src/client/pairing';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

it('asks the local user to approve a device and posts the decision', async () => {
  let pending = [{ id: 'r1', code: '4821', deviceName: 'iPhone · Safari', source: '192.168.1.20', expiresAt: Date.now() + 60_000 }];
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn((path: string, init?: RequestInit) => {
    if (init?.method === 'POST') { calls.push(path); pending = []; return json({}); }
    return json(pending);
  }));
  render(<PairingPrompt />);
  expect(await screen.findByText('Allow iPhone · Safari to connect?')).toBeTruthy();
  expect(screen.getByLabelText('Code 4821')).toBeTruthy();
  expect(screen.getByText(/Requested from 192\.168\.1\.20/)).toBeTruthy();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Approve' }));
  expect(calls).toEqual(['/api/pair/r1/approve']);
  await waitFor(() => expect(screen.queryByText('Allow iPhone · Safari to connect?')).toBeNull());
});

it('shows a QR code and the one-time code for a new device, and lists connected devices', async () => {
  const devices = [{ id: 'd1', name: 'iPhone · Safari', createdAt: 0, lastSeenAt: Date.now() - 3 * 3600_000, expiresAt: Date.now() + 30 * 86400_000, current: false }];
  vi.stubGlobal('fetch', vi.fn((path: string, init?: RequestInit) => path === '/api/devices' ? json(devices) : init?.method === 'POST' ? json({ token: 'ABCD-EFGH-JKMN-PQRS', expiresAt: Date.now() + 300_000, urls: ['http://192.168.1.5:4321/#token=ABCDEFGHJKMNPQRS'] }) : json([])));
  render(<RemoteAccess />);
  expect(await screen.findByText('iPhone · Safari')).toBeTruthy();
  expect(screen.getByText(/Signs out in 30 days if unused/)).toBeTruthy();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Show code' }));
  expect(await screen.findByText('ABCD-EFGH-JKMN-PQRS')).toBeTruthy();
  expect(screen.getByRole('img', { name: 'QR code to connect a device' })).toBeTruthy();
});

it('explains how to enable remote access when the server has no reachable address', async () => {
  vi.stubGlobal('fetch', vi.fn((path: string, init?: RequestInit) => path === '/api/devices' ? json([]) : init?.method === 'POST' ? json({ token: 'ABCD-EFGH-JKMN-PQRS', expiresAt: 0, urls: [] }) : json([])));
  render(<RemoteAccess />);
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Show code' }));
  expect(await screen.findByText(/No network address was found/)).toBeTruthy();
});

it('describes recent activity in plain words', () => {
  const now = 1_000_000_000_000;
  expect([relativeTime(now - 10_000, now), relativeTime(now - 3 * 3600_000, now), relativeTime(now - 2 * 86400_000, now)]).toEqual(['just now', '3 hours ago', '2 days ago']);
});

it('lists recent activity in Settings', async () => {
  const events = [{ id: 2, at: Date.now() - 60_000 * 5, kind: 'pair_denied', source: '10.0.0.7', deviceName: 'Android · Chrome' }, { id: 1, at: Date.now() - 3600_000, kind: 'invite_created', source: '127.0.0.1', deviceName: null }];
  vi.stubGlobal('fetch', vi.fn((path: string) => json(path === '/api/audit' ? events : [])));
  render(<RemoteAccess />);
  expect(await screen.findByText('Android · Chrome was declined from 10.0.0.7')).toBeTruthy();
  expect(screen.getByText('A connection code was created from 127.0.0.1')).toBeTruthy();
});

it('asks for notification permission only from a button', async () => {
  const requestPermission = vi.fn(() => Promise.resolve('granted'));
  vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'default', requestPermission }));
  vi.stubGlobal('fetch', vi.fn(() => json([])));
  render(<RemoteAccess />);
  expect(requestPermission).not.toHaveBeenCalled();
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Turn on' }));
  expect(requestPermission).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull());
});

it('raises a notification for a new request while the tab is hidden', async () => {
  const notify = vi.fn();
  vi.stubGlobal('Notification', Object.assign(notify, { permission: 'granted' }));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  vi.stubGlobal('fetch', vi.fn(() => json([{ id: 'r1', code: '4821', deviceName: 'iPhone · Safari', source: '192.168.1.20', expiresAt: Date.now() + 60_000 }])));
  render(<PairingPrompt />);
  await waitFor(() => expect(notify).toHaveBeenCalledWith('A device wants to connect to Webr', expect.objectContaining({ body: 'iPhone · Safari · 192.168.1.20' })));
});

it('does not poll from a hidden tab that cannot notify', async () => {
  vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'default' }));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const fetchMock = vi.fn(() => json([]));
  vi.stubGlobal('fetch', fetchMock);
  render(<PairingPrompt />);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(fetchMock).not.toHaveBeenCalled();
});

it('describes audit events and future expiry in plain words', () => {
  expect(describeAuditEvent({ id: 1, at: 0, kind: 'session_expired', source: null, deviceName: 'Mac · Chrome' })).toBe('Mac · Chrome was signed out after being idle');
  const now = 1_000_000_000_000;
  expect([relativeFuture(now + 5 * 3600_000, now), relativeFuture(now + 89 * 86400_000, now), relativeFuture(now - 1, now)]).toEqual(['in 5 hours', 'in 89 days', 'expired']);
});
