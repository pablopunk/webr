import type { MetadataDatabase } from '../storage/database';

export type AuditKind = 'pair_requested' | 'pair_approved' | 'pair_denied' | 'invite_created' | 'invite_redeemed' | 'device_revoked' | 'session_expired';
export type AuditEvent = { id: number; at: number; kind: AuditKind; source: string | null; deviceName: string | null };
type Subject = { source?: string; deviceName?: string };

const RECENT_LIMIT = 50;

export class AuditLog {
  constructor(private readonly database: MetadataDatabase, private readonly now = Date.now) {}
  record(kind: AuditKind, { source, deviceName }: Subject = {}) {
    this.database.addAuditEvent({ at: this.now(), kind, source: source ?? null, deviceName: deviceName ?? null });
  }
  recent(limit = RECENT_LIMIT) { return this.database.auditEvents(limit); }
}
