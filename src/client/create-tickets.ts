import { z } from 'zod';
import { uuid } from '../lib/uuid';
import { createOperationEnvelope, createOperationResult, launchInput, launchOperationEnvelope, launchOperationState, terminalCreateInput, workspaceCreateInput, type CreateOperationInput, type CreateOperationKind, type LaunchInput } from '../shared/runtime';
import { clearLaunchDraft, clearLaunchDrafts, clearNewThreadDraft, clearNewThreadDraftForLaunch, readLaunchDraft, recoveryStoragePrefix, writeLaunchDraft, type NewThreadDraft } from './new-thread-draft';
import type { TerminalStartupPreset } from './terminal-presets';

const ticketMarker = 'ticket:';
const resourceTicketMarker = 'resource-ticket:';
const imageReference = z.object({ id: z.string(), name: z.string(), path: z.string() }).strict();
const draftSnapshotSchema = z.object({
  prompt: z.string(), images: z.array(imageReference), projectId: z.string().optional(), machineId: z.string().optional(),
  harness: z.string().optional(), worktree: z.boolean().optional(),
}).strict();
const ticketSchema = z.object({
  kind: z.literal('thread'), endpoint: z.literal('/api/threads'), key: z.uuid(), normalizedPayload: launchInput,
  createdAt: z.number().nonnegative(), operationId: z.uuid().optional(), statusUrl: z.string().optional(),
  state: launchOperationState.optional(), step: z.string().optional(), result: z.object({ threadId: z.string().min(1) }).strict().optional(),
  error: z.string().optional(), notice: z.string().optional(), transport: z.enum(['submitting', 'checking', 'accepted']),
  reloadRecoveryUnavailable: z.boolean(), draft: draftSnapshotSchema.optional(),
}).strict();
const resourceTicketSchema = z.object({
  kind: z.enum(['workspace', 'terminal']), endpoint: z.enum(['/api/workspaces', '/api/terminals']), key: z.uuid(),
  normalizedPayload: z.union([workspaceCreateInput, terminalCreateInput]), createdAt: z.number().nonnegative(),
  operationId: z.uuid().optional(), statusUrl: z.string().optional(), state: launchOperationState.optional(), step: z.string().optional(),
  result: createOperationResult.optional(), error: z.string().optional(), notice: z.string().optional(),
  transport: z.enum(['submitting', 'checking', 'accepted']), reloadRecoveryUnavailable: z.boolean(),
  session: z.string().optional(), startupPreset: z.enum(['resource-monitor']).optional(),
}).strict();

export type DraftSnapshot = z.infer<typeof draftSnapshotSchema>;
export type ThreadTicket = z.infer<typeof ticketSchema>;
export type ResourceTicket = z.infer<typeof resourceTicketSchema>;
type TicketRecord = { ticket: ThreadTicket; liveDraft?: NewThreadDraft };
type TicketDependencies = { fetch?: typeof fetch; sleep?: (milliseconds: number) => Promise<void>; now?: () => number };
type ResourceTicketOptions = { session?: string; startupPreset?: TerminalStartupPreset };

function storageKey(scope: string, key: string) {
  return `${storagePrefix(scope)}${key}`;
}
function storagePrefix(scope: string) {
  return `${recoveryStoragePrefix(scope)}${ticketMarker}`;
}
function resourceStorageKey(scope: string, key: string) {
  return `${resourceStoragePrefix(scope)}${key}`;
}
function resourceStoragePrefix(scope: string) {
  return `${recoveryStoragePrefix(scope)}${resourceTicketMarker}`;
}
function snapshotDraft(draft: NewThreadDraft): DraftSnapshot {
  return {
    prompt: draft.prompt,
    images: draft.images.map(({ id, name, path }) => ({ id, name, path })),
    ...(draft.projectId !== undefined ? { projectId: draft.projectId } : {}),
    ...(draft.machineId !== undefined ? { machineId: draft.machineId } : {}),
    ...(draft.harness !== undefined ? { harness: draft.harness } : {}),
    ...(draft.worktree !== undefined ? { worktree: draft.worktree } : {}),
  };
}
function draftFromSnapshot(draft: DraftSnapshot): NewThreadDraft {
  return { ...draft, images: draft.images.map((image) => ({ ...image, preview: '' })) };
}
function accessIsLost(response: Response) { return response.status === 401 || response.status === 403; }
function terminal(state: ThreadTicket['state']) { return state === 'ready' || state === 'failed' || state === 'unknown'; }

export function waitForTicketDelay(milliseconds: number) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  return new Promise<void>((resolve) => {
    let remaining = milliseconds;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let startedAt = 0;
    const available = () => document.visibilityState !== 'hidden' && (typeof navigator === 'undefined' || navigator.onLine !== false);
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener('online', onAvailabilityChange);
      window.removeEventListener('offline', onAvailabilityChange);
      document.removeEventListener('visibilitychange', onAvailabilityChange);
    };
    const finish = () => { cleanup(); resolve(); };
    const onAvailabilityChange = () => {
      if (available()) {
        if (timer === undefined) {
          if (remaining <= 0) finish();
          else { startedAt = Date.now(); timer = setTimeout(finish, remaining); }
        }
      } else if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
      }
    };
    window.addEventListener('online', onAvailabilityChange);
    window.addEventListener('offline', onAvailabilityChange);
    document.addEventListener('visibilitychange', onAvailabilityChange);
    onAvailabilityChange();
  });
}

function parseEnvelope(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  const response = value as Record<string, unknown>;
  const parsed = launchOperationEnvelope.safeParse({
    operationId: response.operationId, kind: response.kind, state: response.state, step: response.step,
    ...(response.result !== undefined ? { result: response.result } : {}),
    ...(response.error !== undefined ? { error: response.error } : {}), statusUrl: response.statusUrl,
  });
  if (!parsed.success || parsed.data.statusUrl !== `/api/operations/${parsed.data.operationId}`) return undefined;
  if (parsed.data.state === 'ready' && !parsed.data.result?.threadId) return undefined;
  return parsed.data;
}
function parseResourceEnvelope(value: unknown) {
  const parsed = createOperationEnvelope.safeParse(value);
  if (!parsed.success || parsed.data.statusUrl !== `/api/operations/${parsed.data.operationId}`) return undefined;
  return parsed.data;
}

/** Client-side, recoveryScope-isolated tickets for accepted thread launches. */
export class ThreadTickets {
  private readonly records = new Map<string, TicketRecord>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly resourceRecords = new Map<string, ResourceTicket>();
  private readonly resourceListeners = new Map<string, Set<() => void>>();
  private readonly resourceRunning = new Map<string, Promise<void>>();
  private readonly fetcher: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  readonly recoveryScope: string;
  private activeResourceRecoveryScope: string;
  private readonly accessLostKeys = new Set<string>();
  private readonly resourceAccessLostKeys = new Set<string>();
  private accessLost = false;
  private accessGeneration = 0;
  private resourceAccessLost = false;
  private resourceAccessGeneration = 0;

  constructor(recoveryScope: string, dependencies: TicketDependencies = {}, resourceRecoveryScope = recoveryScope) {
    this.recoveryScope = recoveryScope;
    this.activeResourceRecoveryScope = resourceRecoveryScope;
    this.fetcher = dependencies.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.sleep = dependencies.sleep ?? waitForTicketDelay;
    this.now = dependencies.now ?? Date.now;
  }

  get resourceRecoveryScope() { return this.activeResourceRecoveryScope; }

  changeResourceRecoveryScope(scope: string) {
    if (scope === this.activeResourceRecoveryScope) return false;
    this.clearResourceTickets();
    this.activeResourceRecoveryScope = scope;
    this.resourceAccessLost = false;
    return true;
  }

  get(key: string): ThreadTicket | undefined {
    const cached = this.records.get(key);
    if (cached) return cached.ticket;
    try {
      if (typeof sessionStorage === 'undefined') return undefined;
      const raw = sessionStorage.getItem(storageKey(this.recoveryScope, key));
      if (!raw) return undefined;
      const parsed = ticketSchema.safeParse(JSON.parse(raw));
      if (!parsed.success || parsed.data.key !== key) return undefined;
      const localDraft = readLaunchDraft(this.recoveryScope, key);
      this.records.set(key, { ticket: parsed.data, liveDraft: localDraft ?? (parsed.data.draft ? draftFromSnapshot(parsed.data.draft) : undefined) });
      return parsed.data;
    } catch { return undefined; }
  }

  getDraft(key: string): NewThreadDraft | undefined {
    const ticket = this.get(key);
    if (!ticket?.draft) return undefined;
    const record = this.records.get(key)!;
    return record.liveDraft ?? draftFromSnapshot(ticket.draft);
  }

  isAccessLost(key: string) { return this.accessLostKeys.has(key) || this.accessLost && !this.get(key); }
  private hasAccess(generation: number) { return !this.accessLost && generation === this.accessGeneration; }
  private hasResourceAccess(generation: number) { return !this.resourceAccessLost && generation === this.resourceAccessGeneration; }

  subscribe(key: string, listener: () => void) {
    const listeners = this.listeners.get(key) ?? new Set<() => void>();
    listeners.add(listener); this.listeners.set(key, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(key); };
  }

  private notify(key: string) { for (const listener of this.listeners.get(key) ?? []) listener(); }

  getResource(key: string): ResourceTicket | undefined {
    const cached = this.resourceRecords.get(key);
    if (cached) return cached;
    try {
      if (typeof sessionStorage === 'undefined') return undefined;
      const raw = sessionStorage.getItem(resourceStorageKey(this.resourceRecoveryScope, key));
      if (!raw) return undefined;
      const parsed = resourceTicketSchema.safeParse(JSON.parse(raw));
      if (!parsed.success || parsed.data.key !== key) return undefined;
      const expectedEndpoint = parsed.data.kind === 'workspace' ? '/api/workspaces' : '/api/terminals';
      const payloadValid = parsed.data.kind === 'workspace'
        ? workspaceCreateInput.safeParse(parsed.data.normalizedPayload).success
        : terminalCreateInput.safeParse(parsed.data.normalizedPayload).success;
      if (parsed.data.endpoint !== expectedEndpoint || !payloadValid) return undefined;
      this.resourceRecords.set(key, parsed.data);
      return parsed.data;
    } catch { return undefined; }
  }

  isResourceAccessLost(key: string) { return this.resourceAccessLostKeys.has(key) || this.resourceAccessLost && !this.getResource(key); }

  subscribeResource(key: string, listener: () => void) {
    const listeners = this.resourceListeners.get(key) ?? new Set<() => void>();
    listeners.add(listener); this.resourceListeners.set(key, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.resourceListeners.delete(key); };
  }

  private notifyResource(key: string) { for (const listener of this.resourceListeners.get(key) ?? []) listener(); }

  private persistResource(ticket: ResourceTicket) {
    if (ticket.reloadRecoveryUnavailable) return false;
    try {
      if (typeof sessionStorage === 'undefined') return false;
      sessionStorage.setItem(resourceStorageKey(this.resourceRecoveryScope, ticket.key), JSON.stringify(ticket));
      return true;
    } catch { return false; }
  }

  private replaceResource(key: string, patch: Partial<ResourceTicket>) {
    const ticket = this.getResource(key);
    if (!ticket) return undefined;
    const next = { ...ticket, ...patch };
    this.resourceRecords.set(key, next);
    if (!this.persistResource(next)) {
      next.reloadRecoveryUnavailable = true;
      try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(resourceStorageKey(this.resourceRecoveryScope, key)); } catch { /* Storage may be blocked. */ }
    }
    this.notifyResource(key);
    return next;
  }

  createResource(kind: CreateOperationKind, input: CreateOperationInput, options: ResourceTicketOptions = {}) {
    this.resourceAccessLost = false;
    const normalizedPayload = kind === 'workspace' ? workspaceCreateInput.parse(input) : terminalCreateInput.parse(input);
    const key = uuid();
    const ticket: ResourceTicket = {
      kind, endpoint: kind === 'workspace' ? '/api/workspaces' : '/api/terminals', key, normalizedPayload,
      createdAt: this.now(), transport: 'submitting', reloadRecoveryUnavailable: false,
      ...(options.session ? { session: options.session } : {}),
      ...(options.startupPreset ? { startupPreset: options.startupPreset } : {}),
    };
    this.resourceRecords.set(key, ticket);
    if (!this.persistResource(ticket)) {
      ticket.reloadRecoveryUnavailable = true;
      try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(resourceStorageKey(this.resourceRecoveryScope, key)); } catch { /* Storage may be blocked. */ }
    }
    this.notifyResource(key);
    return ticket;
  }

  consumeResourceStartup(key: string) { this.replaceResource(key, { startupPreset: undefined }); }

  retryResource(key: string) {
    const ticket = this.getResource(key);
    if (!ticket || ticket.state !== 'failed') return undefined;
    return this.createResource(ticket.kind, ticket.normalizedPayload, { session: ticket.session, startupPreset: ticket.startupPreset });
  }

  startResource(key: string) {
    const active = this.resourceRunning.get(key);
    if (active) return active;
    const task = this.runResource(key, this.resourceAccessGeneration).finally(() => { if (this.resourceRunning.get(key) === task) this.resourceRunning.delete(key); });
    this.resourceRunning.set(key, task);
    return task;
  }

  private async runResource(key: string, generation: number) {
    let ticket = this.getResource(key);
    if (!ticket || !this.hasResourceAccess(generation) || terminal(ticket.state)) return;
    if (!ticket.operationId) {
      let delay = 1000;
      while (this.hasResourceAccess(generation)) {
        ticket = this.getResource(key);
        if (!ticket || terminal(ticket.state) || ticket.operationId) break;
        await this.sleep(0);
        if (!this.hasResourceAccess(generation)) return;
        ticket = this.getResource(key);
        if (!ticket || terminal(ticket.state) || ticket.operationId) break;
        this.replaceResource(key, { transport: ticket.transport === 'checking' ? 'checking' : 'submitting', notice: undefined });
        try {
          const response = await this.fetcher(ticket.endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': ticket.key },
            body: JSON.stringify(ticket.normalizedPayload),
          });
          if (!this.hasResourceAccess(generation)) return;
          if (accessIsLost(response)) { this.clearResourceTickets(); return; }
          const body = await response.json().catch(() => undefined);
          if (!this.hasResourceAccess(generation)) return;
          if (response.ok) {
            const envelope = parseResourceEnvelope(body);
            if (!envelope || envelope.kind !== ticket.kind) {
              this.replaceResource(key, { transport: 'checking', notice: 'The response was incomplete. Checking again with the same request key.' });
              await this.sleep(delay); delay = Math.min(5000, delay + 1000); continue;
            }
            this.acceptResource(key, envelope);
            ticket = this.getResource(key);
            break;
          }
          const error = body && typeof body === 'object' && typeof (body as Record<string, unknown>).error === 'string'
            ? String((body as Record<string, unknown>).error) : 'Could not create resource';
          if (response.status >= 500) {
            this.replaceResource(key, { transport: 'checking', notice: 'The response was interrupted. Checking again with the same request key.' });
            await this.sleep(delay); delay = Math.min(5000, delay + 1000); continue;
          }
          if (['idempotency_conflict', 'legacy_operation_ownership_ambiguous', 'legacy_operation_kind_ambiguous'].includes(error)) {
            this.replaceResource(key, { state: 'unknown', step: 'validate', error: 'This request could not be safely matched to a previous create. No native request was replayed.' });
            return;
          }
          this.replaceResource(key, { state: 'failed', step: 'validate', error, transport: 'accepted', notice: undefined });
          return;
        } catch {
          if (!this.hasResourceAccess(generation)) return;
          this.replaceResource(key, { transport: 'checking', notice: 'The response was interrupted. Checking again with the same request key.' });
          await this.sleep(delay); delay = Math.min(5000, delay + 1000);
        }
      }
      ticket = this.getResource(key);
    }
    if (!ticket || !ticket.operationId || !ticket.statusUrl || terminal(ticket.state) || !this.hasResourceAccess(generation)) return;

    let delay = 1000;
    while (this.hasResourceAccess(generation)) {
      await this.sleep(delay);
      if (!this.hasResourceAccess(generation)) return;
      ticket = this.getResource(key);
      if (!ticket || terminal(ticket.state) || !ticket.statusUrl) return;
      try {
        const response = await this.fetcher(ticket.statusUrl);
        if (!this.hasResourceAccess(generation)) return;
        if (accessIsLost(response)) { this.clearResourceTickets(); return; }
        if (response.status === 404) { this.clearResourceTickets(); return; }
        if (response.status >= 500) {
          this.replaceResource(key, { notice: 'The status check failed. Webr will retry without repeating the native create.' });
          delay = Math.min(5000, delay + 1000); continue;
        }
        if (!response.ok) {
          this.replaceResource(key, { notice: 'The create status is temporarily unavailable. Webr will retry without repeating the native create.' });
          delay = Math.min(5000, delay + 1000); continue;
        }
        const body = await response.json().catch(() => undefined);
        if (!this.hasResourceAccess(generation)) return;
        const envelope = parseResourceEnvelope(body);
        if (!envelope || envelope.operationId !== ticket.operationId || envelope.kind !== ticket.kind) {
          this.replaceResource(key, { state: 'unknown', error: 'The operation status could not be verified. The native create will not be replayed.' });
          return;
        }
        this.acceptResource(key, envelope);
        ticket = this.getResource(key);
        if (!ticket || terminal(ticket.state)) return;
        delay = Math.min(5000, delay + 1000);
      } catch {
        if (!this.hasResourceAccess(generation)) return;
        this.replaceResource(key, { notice: 'The status check was interrupted. Webr will retry without repeating the native create.' });
        delay = Math.min(5000, delay + 1000);
      }
    }
  }

  private acceptResource(key: string, envelope: NonNullable<ReturnType<typeof parseResourceEnvelope>>) {
    this.replaceResource(key, {
      operationId: envelope.operationId, statusUrl: envelope.statusUrl, state: envelope.state, step: envelope.step,
      ...(envelope.result ? { result: envelope.result } : {}), error: envelope.error, notice: undefined, transport: 'accepted',
    });
  }

  private persist(ticket: ThreadTicket) {
    if (ticket.reloadRecoveryUnavailable) return false;
    try {
      if (typeof sessionStorage === 'undefined') return false;
      sessionStorage.setItem(storageKey(this.recoveryScope, ticket.key), JSON.stringify(ticket));
      return true;
    } catch { return false; }
  }

  private removeStored(key: string) {
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(storageKey(this.recoveryScope, key)); } catch { /* Storage may be blocked. */ }
  }

  private replace(key: string, patch: Partial<ThreadTicket>) {
    const ticket = this.get(key);
    if (!ticket) return undefined;
    const next = { ...ticket, ...patch };
    const record = this.records.get(key)!;
    record.ticket = next;
    if (!this.persist(next)) {
      next.reloadRecoveryUnavailable = true;
      this.removeStored(key);
    }
    this.notify(key);
    return next;
  }

  create(input: LaunchInput, draft: NewThreadDraft): ThreadTicket {
    this.accessLost = false;
    const key = uuid();
    const ticket: ThreadTicket = {
      kind: 'thread', endpoint: '/api/threads', key, normalizedPayload: launchInput.parse(input), createdAt: this.now(),
      transport: 'submitting', reloadRecoveryUnavailable: false, draft: snapshotDraft(draft),
    };
    this.records.set(key, { ticket, liveDraft: { ...draft, images: [...draft.images] } });

    // The scope-bound ticket owns the draft before the composer copy is removed.
    if (!this.persist(ticket)) {
      ticket.reloadRecoveryUnavailable = true;
      this.removeStored(key);
    }
    clearNewThreadDraft(this.recoveryScope);
    this.notify(key);
    return ticket;
  }

  dismissDraft(key: string) {
    const ticket = this.get(key);
    if (!ticket) return;
    const record = this.records.get(key)!;
    record.liveDraft = undefined;
    clearLaunchDraft(this.recoveryScope, key);
    if (ticket.result?.threadId) clearLaunchDraft(this.recoveryScope, ticket.result.threadId);
    clearNewThreadDraftForLaunch(this.recoveryScope, key);
    this.replace(key, { draft: undefined });
  }

  retry(key: string) {
    const ticket = this.get(key);
    const draft = this.getDraft(key);
    if (!ticket || ticket.state !== 'failed' || !draft) return undefined;
    return this.create(ticket.normalizedPayload, draft);
  }

  start(key: string) {
    const active = this.running.get(key);
    if (active) return active;
    const task = this.run(key, this.accessGeneration).finally(() => { if (this.running.get(key) === task) this.running.delete(key); });
    this.running.set(key, task);
    return task;
  }

  private async run(key: string, generation: number) {
    let ticket = this.get(key);
    if (!ticket || !this.hasAccess(generation) || terminal(ticket.state)) return;
    if (!ticket.operationId) {
      let delay = 1000;
      while (this.hasAccess(generation)) {
        ticket = this.get(key);
        if (!ticket || terminal(ticket.state) || ticket.operationId) break;
        await this.sleep(0);
        if (!this.hasAccess(generation)) return;
        ticket = this.get(key);
        if (!ticket || terminal(ticket.state) || ticket.operationId) break;
        ticket = this.replace(key, { transport: ticket.transport === 'checking' ? 'checking' : 'submitting', notice: undefined }) ?? ticket;
        try {
          const response = await this.fetcher(ticket.endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': ticket.key },
            body: JSON.stringify(ticket.normalizedPayload),
          });
          if (!this.hasAccess(generation)) return;
          if (accessIsLost(response)) { this.clearThreadTickets(); return; }
          const body = await response.json().catch(() => undefined);
          if (!this.hasAccess(generation)) return;
          if (response.ok) {
            const envelope = parseEnvelope(body);
            if (!envelope) {
              this.replace(key, { transport: 'checking', notice: 'The response was incomplete. Checking again with the same request key.' });
              await this.sleep(delay); delay = Math.min(5000, delay + 1000); continue;
            }
            this.accept(key, envelope);
            ticket = this.get(key);
            break;
          }
          const error = body && typeof body === 'object' && typeof (body as Record<string, unknown>).error === 'string'
            ? String((body as Record<string, unknown>).error) : 'Could not create thread';
          if (response.status >= 500) {
            this.replace(key, { transport: 'checking', notice: 'The response was interrupted. Checking again with the same request key.' });
            await this.sleep(delay); delay = Math.min(5000, delay + 1000); continue;
          }
          if (error === 'idempotency_conflict') {
            this.replace(key, { state: 'unknown', step: 'validate', error: 'This request key conflicts with a different payload. The launch outcome is uncertain; no retry was made.' });
            return;
          }
          this.replace(key, { state: 'failed', step: 'validate', error, transport: 'accepted', notice: undefined });
          return;
        } catch {
          if (!this.hasAccess(generation)) return;
          this.replace(key, { transport: 'checking', notice: 'The response was interrupted. Checking again with the same request key.' });
          await this.sleep(delay); delay = Math.min(5000, delay + 1000);
        }
      }
      ticket = this.get(key);
    }
    if (!ticket || !ticket.operationId || !ticket.statusUrl || terminal(ticket.state) || !this.hasAccess(generation)) return;

    let delay = 1000;
    while (this.hasAccess(generation)) {
      await this.sleep(delay);
      if (!this.hasAccess(generation)) return;
      ticket = this.get(key);
      if (!ticket || terminal(ticket.state) || !ticket.statusUrl) return;
      try {
        const response = await this.fetcher(ticket.statusUrl);
        if (!this.hasAccess(generation)) return;
        if (accessIsLost(response)) { this.clearThreadTickets(); return; }
        if (response.status === 404) {
          this.clearThreadTickets();
          return;
        }
        if (response.status >= 500) {
          this.replace(key, { notice: 'The status check failed. Webr will retry without resending the prompt.' });
          delay = Math.min(5000, delay + 1000); continue;
        }
        if (!response.ok) {
          this.replace(key, { notice: 'The launch status is temporarily unavailable. Webr will retry without resending the prompt.' });
          delay = Math.min(5000, delay + 1000); continue;
        }
        const body = await response.json().catch(() => undefined);
        if (!this.hasAccess(generation)) return;
        const envelope = parseEnvelope(body);
        if (!envelope || envelope.operationId !== ticket.operationId) {
          this.replace(key, { state: 'unknown', error: 'The operation status could not be verified. The prompt will not be replayed.' });
          return;
        }
        this.accept(key, envelope);
        ticket = this.get(key);
        if (!ticket || terminal(ticket.state)) return;
        delay = Math.min(5000, delay + 1000);
      } catch {
        if (!this.hasAccess(generation)) return;
        this.replace(key, { notice: 'The status check was interrupted. Webr will retry without resending the prompt.' });
        delay = Math.min(5000, delay + 1000);
      }
    }
  }

  private accept(key: string, envelope: NonNullable<ReturnType<typeof parseEnvelope>>) {
    if (envelope.state === 'ready' && !envelope.result?.threadId) {
      this.replace(key, { state: 'unknown', step: envelope.step, error: 'The operation completed without a confirmed thread ID. The prompt will not be replayed.' });
      return;
    }
    const ticket = this.replace(key, {
      operationId: envelope.operationId, statusUrl: envelope.statusUrl, state: envelope.state, step: envelope.step,
      ...(envelope.result ? { result: envelope.result } : {}), error: envelope.error, notice: undefined, transport: 'accepted',
    });
    if (ticket?.state === 'failed' && ticket.result?.threadId && ticket.draft) {
      const record = this.records.get(key);
      writeLaunchDraft(this.recoveryScope, ticket.result.threadId, record?.liveDraft ?? draftFromSnapshot(ticket.draft));
    }
    if (ticket?.state === 'ready') {
      const record = this.records.get(key);
      if (record) {
        record.liveDraft = undefined;
        record.ticket = { ...record.ticket, draft: undefined };
        if (!this.persist(record.ticket)) {
          record.ticket.reloadRecoveryUnavailable = true;
          this.removeStored(key);
        }
      }
      clearLaunchDraft(this.recoveryScope, key);
      if (ticket.result?.threadId) clearLaunchDraft(this.recoveryScope, ticket.result.threadId);
      clearNewThreadDraftForLaunch(this.recoveryScope, key);
      this.notify(key);
    }
  }

  clearResourceTickets() {
    this.resourceAccessLost = true;
    this.resourceAccessGeneration += 1;
    this.resourceRunning.clear();
    const keys = new Set(this.resourceRecords.keys());
    try {
      if (typeof sessionStorage !== 'undefined') {
        const prefix = resourceStoragePrefix(this.resourceRecoveryScope);
        for (let index = sessionStorage.length - 1; index >= 0; index--) {
          const storageItem = sessionStorage.key(index);
          if (!storageItem?.startsWith(prefix)) continue;
          keys.add(storageItem.slice(prefix.length));
          sessionStorage.removeItem(storageItem);
        }
      }
    } catch { /* Storage may be blocked. */ }
    for (const key of keys) {
      this.resourceRecords.delete(key); this.resourceAccessLostKeys.add(key); this.notifyResource(key);
    }
  }

  clearOnAccessLoss() { this.clearForAccessLoss(); }

  private clearForAccessLoss() {
    this.clearThreadTickets();
    this.clearResourceTickets();
  }

  private clearThreadTickets() {
    this.accessLost = true;
    this.accessGeneration += 1;
    this.running.clear();
    const threadKeys = new Set(this.records.keys());
    const threadIds = new Set([...this.records.values()].flatMap(({ ticket }) => ticket.result?.threadId ? [ticket.result.threadId] : []));
    try {
      if (typeof sessionStorage !== 'undefined') {
        const ticketsPrefix = storagePrefix(this.recoveryScope);
        for (let index = sessionStorage.length - 1; index >= 0; index--) {
          const storageItem = sessionStorage.key(index);
          if (!storageItem?.startsWith(ticketsPrefix)) continue;
          const ticketKey = storageItem.slice(ticketsPrefix.length);
          const raw = sessionStorage.getItem(storageItem);
          if (raw) {
            try {
              const saved = ticketSchema.safeParse(JSON.parse(raw));
              if (saved.success && saved.data.result?.threadId) threadIds.add(saved.data.result.threadId);
            } catch { /* Ignore a malformed ticket while clearing this scope. */ }
          }
          threadKeys.add(ticketKey);
          sessionStorage.removeItem(storageItem);
        }
      }
    } catch { /* Storage may be blocked. */ }
    for (const key of threadKeys) {
      clearLaunchDraft(this.recoveryScope, key); clearNewThreadDraftForLaunch(this.recoveryScope, key);
      this.records.delete(key); this.accessLostKeys.add(key); this.notify(key);
    }
    for (const threadId of threadIds) clearLaunchDraft(this.recoveryScope, threadId);
    clearLaunchDrafts(this.recoveryScope);
    clearNewThreadDraft(this.recoveryScope);
  }
}

let fallbackTickets: ThreadTickets | undefined;
export function defaultThreadTickets() {
  return fallbackTickets ??= new ThreadTickets('standalone');
}

