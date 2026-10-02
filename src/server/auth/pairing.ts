import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

const REQUEST_TTL_MS = 5 * 60_000;
const INVITE_TTL_MS = 5 * 60_000;
const MAX_PENDING_REQUESTS = 8;
const MAX_PENDING_PER_SOURCE = 2;
const DENY_COOLDOWN_MS = 60_000;
const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TOKEN_LENGTH = 16;

type PairRequest = { id: string; code: string; deviceName: string; source: string; secretHash: Buffer; expiresAt: number; state: 'pending' | 'approved' | 'denied' };
export type PendingPairRequest = Pick<PairRequest, 'id' | 'code' | 'deviceName' | 'source' | 'expiresAt'>;
export type ClaimResult = { status: 'pending' | 'denied' | 'expired' | 'approved' };

const sha256 = (value: string) => createHash('sha256').update(value).digest();
export const normalizeInviteToken = (input: string) => input.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const formatInviteToken = (token: string) => token.match(/.{1,4}/g)!.join('-');
const newInviteToken = () => Array.from({ length: TOKEN_LENGTH }, () => TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)]).join('');

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly now = Date.now) {}
  allow(key: string) {
    const at = this.now();
    const recent = (this.hits.get(key) ?? []).filter((time) => at - time < this.windowMs);
    if (recent.length >= this.limit) { this.hits.set(key, recent); return false; }
    this.hits.set(key, [...recent, at]);
    return true;
  }
}

export class PairingService {
  private readonly requests = new Map<string, PairRequest>();
  private readonly invites = new Map<string, number>();
  private readonly cooldowns = new Map<string, number>();
  constructor(private readonly now = Date.now) {}

  request(deviceName: string, source: string) {
    this.sweep();
    if (this.cooldowns.has(source)) throw new Error('cooling_down');
    const pending = this.pending();
    if (pending.length >= MAX_PENDING_REQUESTS || pending.filter((request) => request.source === source).length >= MAX_PENDING_PER_SOURCE) throw new Error('too_many_requests');
    const secret = randomBytes(24).toString('base64url');
    const request: PairRequest = { id: randomUUID(), code: String(randomInt(10_000)).padStart(4, '0'), deviceName, source, secretHash: sha256(secret), expiresAt: this.now() + REQUEST_TTL_MS, state: 'pending' };
    this.requests.set(request.id, request);
    return { id: request.id, code: request.code, secret, expiresAt: request.expiresAt };
  }

  pending(): PendingPairRequest[] {
    this.sweep();
    return [...this.requests.values()].filter((request) => request.state === 'pending').map(({ id, code, deviceName, source, expiresAt }) => ({ id, code, deviceName, source, expiresAt }));
  }

  decide(id: string, state: 'approved' | 'denied') {
    this.sweep();
    const request = this.requests.get(id);
    if (!request || request.state !== 'pending') return undefined;
    request.state = state;
    if (state === 'denied') this.cooldowns.set(request.source, this.now() + DENY_COOLDOWN_MS);
    return { deviceName: request.deviceName, source: request.source };
  }

  claim(id: string, secret: string): ClaimResult & { deviceName?: string } {
    this.sweep();
    const request = this.requests.get(id);
    if (!request || !timingSafeEqual(request.secretHash, sha256(secret))) return { status: 'expired' };
    if (request.state === 'pending') return { status: 'pending' };
    this.requests.delete(id);
    return request.state === 'approved' ? { status: 'approved', deviceName: request.deviceName } : { status: 'denied' };
  }

  createInvite() {
    this.sweep();
    const token = newInviteToken();
    const expiresAt = this.now() + INVITE_TTL_MS;
    this.invites.set(token, expiresAt);
    return { token, expiresAt };
  }

  redeemInvite(input: string) {
    this.sweep();
    return this.invites.delete(normalizeInviteToken(input));
  }

  private sweep() {
    const at = this.now();
    for (const [id, request] of this.requests) if (request.expiresAt <= at) this.requests.delete(id);
    for (const [token, expiresAt] of this.invites) if (expiresAt <= at) this.invites.delete(token);
    for (const [source, until] of this.cooldowns) if (until <= at) this.cooldowns.delete(source);
  }
}
