import { useCallback, useEffect, useState } from 'react';

export type PendingPairRequest = { id: string; code: string; deviceName: string; expiresAt: number };
export type Invite = { token: string; expiresAt: number; urls: string[] };
export type Device = { id: string; name: string; createdAt: number; lastSeenAt: number; current: boolean };

const POLL_INTERVAL_MS = 2000;
const post = (path: string) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

export async function createInvite(): Promise<Invite> {
  const response = await post('/api/pair/invites');
  if (!response.ok) throw new Error('Webr could not create a code.');
  return response.json();
}

export async function listDevices(): Promise<Device[]> {
  const response = await fetch('/api/devices');
  if (!response.ok) throw new Error('Webr could not list devices.');
  return response.json();
}

export const revokeDevice = (id: string) => post(`/api/devices/${encodeURIComponent(id)}/revoke`);
export const decidePairRequest = (id: string, decision: 'approve' | 'deny') => post(`/api/pair/${encodeURIComponent(id)}/${decision}`);

async function fetchPending(): Promise<PendingPairRequest[]> {
  try {
    const response = await fetch('/api/pair/pending');
    return response.ok ? await response.json() : [];
  } catch { return []; }
}

export function usePendingPairRequests() {
  const [pending, setPending] = useState<PendingPairRequest[]>([]);
  const refresh = useCallback(async () => { if (document.visibilityState === 'visible') setPending(await fetchPending()); }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [refresh]);
  const decide = useCallback(async (id: string, decision: 'approve' | 'deny') => {
    setPending((current) => current.filter((request) => request.id !== id));
    await decidePairRequest(id, decision).catch(() => undefined);
    await refresh();
  }, [refresh]);
  return { pending, decide };
}

export function relativeTime(timestamp: number, now = Date.now()) {
  const seconds = Math.round((timestamp - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86400], ['hour', 3600], ['minute', 60]];
  const [unit, size] = units.find(([, size]) => Math.abs(seconds) >= size) ?? ['second', 1];
  return Math.abs(seconds) < 45 ? 'just now' : new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round(seconds / size), unit);
}
