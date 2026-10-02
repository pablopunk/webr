import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { MetadataDatabase } from '../storage/database';
import type { AuditLog } from './audit';

export type DeviceSession = { id: string; name: string; createdAt: number; lastSeenAt: number };

export const SESSION_COOKIE = 'webr_session';
export const IDLE_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000;
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const TOUCH_INTERVAL_MS = 60_000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const readCookie = (header: string | undefined, name: string) => header?.split(';').map((part) => part.trim().split('=')).find(([key]) => key === name)?.[1];

export const sessionCookie = (token: string, secure: boolean) => `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure ? '; Secure' : ''}`;
export const clearedSessionCookie = (secure: boolean) => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;

export class SessionStore {
  constructor(private readonly database: MetadataDatabase, private readonly now = Date.now, private readonly audit?: AuditLog) {}

  create(name: string) {
    const token = randomBytes(32).toString('base64url');
    const at = this.now();
    const session: DeviceSession = { id: randomUUID(), name, createdAt: at, lastSeenAt: at };
    this.database.addDeviceSession({ ...session, tokenHash: hashToken(token) });
    return { session, token };
  }

  authenticate(cookieHeader: string | undefined, source?: string): DeviceSession | undefined {
    const token = readCookie(cookieHeader, SESSION_COOKIE);
    if (!token) return undefined;
    const row = this.database.deviceSessionByTokenHash(hashToken(token));
    if (!row) return undefined;
    const at = this.now();
    if (at - row.lastSeenAt > IDLE_EXPIRY_MS) { this.database.deleteDeviceSession(row.id); this.audit?.record('session_expired', { source, deviceName: row.name }); return undefined; }
    if (at - row.lastSeenAt > TOUCH_INTERVAL_MS) this.database.touchDeviceSession(row.id, at);
    return { id: row.id, name: row.name, createdAt: row.createdAt, lastSeenAt: at };
  }

  list() { return this.database.deviceSessions().sort((a, b) => b.lastSeenAt - a.lastSeenAt).map((device) => ({ ...device, expiresAt: device.lastSeenAt + IDLE_EXPIRY_MS })); }
  revoke(id: string) { return this.database.deleteDeviceSession(id); }
}

export function deviceNameFrom(userAgent = '') {
  const system = /iPhone/.test(userAgent) ? 'iPhone' : /iPad/.test(userAgent) ? 'iPad' : /Android/.test(userAgent) ? 'Android' : /Macintosh|Mac OS X/.test(userAgent) ? 'Mac' : /Windows/.test(userAgent) ? 'Windows' : /Linux/.test(userAgent) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Firefox\/|FxiOS/.test(userAgent) ? 'Firefox' : /Chrome\/|CriOS/.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : undefined;
  return browser ? `${system} · ${browser}` : system;
}
