import { mkdir, open, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { OwnedResource } from './contracts';

export class ValidationJournal {
  readonly resources: OwnedResource[] = [];
  readonly recovery: { resource?: OwnedResource; operationId?: string; reason: string }[] = [];
  private intents = new Map<string, string>();
  private returned = new Set<string>();
  private constructor(readonly path: string, private file: Awaited<ReturnType<typeof open>>) {}
  static async create(directory: string, runId: string) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.mode & 0o077 || process.getuid && info.uid !== process.getuid()) throw new Error('Validation output directory must be private and owned by the current user');
    const path = join(directory, runId + '.journal.ndjson');
    return new ValidationJournal(path, await open(path, 'wx', 0o600));
  }
  async record(value: Record<string, unknown>) { await this.file.write(JSON.stringify(value) + '\n'); await this.file.sync(); }
  async intent(method: string, scope: Record<string, unknown>) { const id = randomUUID(); await this.record({ event: 'intent', id, method, ...scope }); this.intents.set(id, method); return id; }
  complete(id: string) { if (!this.intents.has(id) || this.returned.has(id)) throw new Error('Duplicate or missing durable effect intent'); this.returned.add(id); }
  assertCompleted(methods: string[]) { for (const method of methods) if ([...this.intents].filter(([, value]) => value === method).length !== 1 || ![...this.intents].some(([id, value]) => value === method && this.returned.has(id))) throw new Error('The launch did not complete exactly one durable client request for ' + method); }
  async own(resource: OwnedResource) { await this.record({ event: 'owned', resource }); this.resources.push(resource); }
  async preserve(reason: string, resource?: OwnedResource, operationId?: string) { this.recovery.push({ reason, resource, operationId }); await this.record({ event: 'recovery', reason, resource, operationId }); }
  async close() { await this.file.close(); }
}
