import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PairingPrompt } from '../../src/components/PairingPrompt';
import { RemoteAccess } from '../../src/components/RemoteAccess';
import { relativeTime } from '../../src/client/pairing';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

it('asks the local user to approve a device and posts the decision', async () => {
  let pending = [{ id: 'r1', code: '4821', deviceName: 'iPhone · Safari', expiresAt: Date.now() + 60_000 }];
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn((path: string, init?: RequestInit) => {
    if (init?.method === 'POST') { calls.push(path); pending = []; return json({}); }
    return json(pending);
  }));
  render(<PairingPrompt />);
  expect(await screen.findByText('Allow iPhone · Safari to connect?')).toBeTruthy();
  expect(screen.getByLabelText('Code 4821')).toBeTruthy();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Approve' }));
  expect(calls).toEqual(['/api/pair/r1/approve']);
  await waitFor(() => expect(screen.queryByText('Allow iPhone · Safari to connect?')).toBeNull());
});

it('shows a QR code and the one-time code for a new device, and lists connected devices', async () => {
  const devices = [{ id: 'd1', name: 'iPhone · Safari', createdAt: 0, lastSeenAt: Date.now() - 3 * 3600_000, current: false }];
  vi.stubGlobal('fetch', vi.fn((path: string, init?: RequestInit) => path === '/api/devices' ? json(devices) : init?.method === 'POST' ? json({ token: 'ABCD-EFGH-JKMN-PQRS', expiresAt: Date.now() + 300_000, urls: ['http://192.168.1.5:4321/#token=ABCDEFGHJKMNPQRS'] }) : json([])));
  render(<RemoteAccess />);
  expect(await screen.findByText('iPhone · Safari')).toBeTruthy();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Show code' }));
  expect(await screen.findByText('ABCD-EFGH-JKMN-PQRS')).toBeTruthy();
  expect(screen.getByRole('img', { name: 'QR code to connect a device' })).toBeTruthy();
});

it('explains how to enable remote access when the server has no reachable address', async () => {
  vi.stubGlobal('fetch', vi.fn((path: string, init?: RequestInit) => path === '/api/devices' ? json([]) : init?.method === 'POST' ? json({ token: 'ABCD-EFGH-JKMN-PQRS', expiresAt: 0, urls: [] }) : json([])));
  render(<RemoteAccess />);
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Show code' }));
  expect(await screen.findByText(/only listens on this computer/)).toBeTruthy();
});

it('describes recent activity in plain words', () => {
  const now = 1_000_000_000_000;
  expect([relativeTime(now - 10_000, now), relativeTime(now - 3 * 3600_000, now), relativeTime(now - 2 * 86400_000, now)]).toEqual(['just now', '3 hours ago', '2 days ago']);
});
