import { useCallback, useEffect, useRef, useState } from 'react';

export type PendingPairRequest = { id: string; code: string; deviceName: string; source: string; expiresAt: number };
export type Invite = { token: string; expiresAt: number; urls: string[] };
export type Device = { id: string; name: string; createdAt: number; lastSeenAt: number; expiresAt: number; current: boolean };
export type AuditKind = 'pair_requested' | 'pair_approved' | 'pair_denied' | 'invite_created' | 'invite_redeemed' | 'device_revoked' | 'session_expired';
export type AuditEvent = { id: number; at: number; kind: AuditKind; source: string | null; deviceName: string | null };

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

export async function listAuditEvents(): Promise<AuditEvent[]> {
  const response = await fetch('/api/audit');
  if (!response.ok) throw new Error('Webr could not load recent activity.');
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

const notificationsGranted = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';
const canWatchInBackground = () => document.visibilityState === 'visible' || notificationsGranted();

function notifyHiddenTab(requests: PendingPairRequest[], alreadyNotified: Set<string>) {
  if (document.visibilityState === 'visible' || !notificationsGranted()) return;
  for (const request of requests) {
    if (alreadyNotified.has(request.id)) continue;
    alreadyNotified.add(request.id);
    new Notification('A device wants to connect to Webr', { body: `${request.deviceName} · ${request.source}`, tag: request.id });
  }
}

export function usePendingPairRequests() {
  const [pending, setPending] = useState<PendingPairRequest[]>([]);
  const notified = useRef(new Set<string>());
  const refresh = useCallback(async () => {
    if (!canWatchInBackground()) return;
    const requests = await fetchPending();
    notifyHiddenTab(requests, notified.current);
    setPending(requests);
  }, []);
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

export const notificationsSupported = () => typeof Notification !== 'undefined';
export const notificationPermission = () => notificationsSupported() ? Notification.permission : 'denied';
export const requestNotificationPermission = () => Notification.requestPermission();

export function describeAuditEvent({ kind, deviceName, source }: AuditEvent) {
  const device = deviceName ?? 'A device';
  const where = source ? ` from ${source}` : '';
  const sentences: Record<AuditKind, string> = {
    pair_requested: `${device} asked to connect${where}`,
    pair_approved: `${device} was approved${where}`,
    pair_denied: `${device} was declined${where}`,
    invite_created: `A connection code was created${where}`,
    invite_redeemed: `${device} connected with a code${where}`,
    device_revoked: `${device} was disconnected`,
    session_expired: `${device} was signed out after being idle`,
  };
  return sentences[kind];
}

export function relativeFuture(timestamp: number, now = Date.now()) {
  return timestamp <= now ? 'expired' : new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(...futureUnit(timestamp - now));
}

function futureUnit(milliseconds: number): [number, Intl.RelativeTimeFormatUnit] {
  const days = Math.round(milliseconds / 86_400_000);
  return days >= 1 ? [days, 'day'] : [Math.max(1, Math.round(milliseconds / 3_600_000)), 'hour'];
}
