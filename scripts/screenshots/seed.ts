import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { MetadataDatabase } from '../../src/server/storage/database';
import { HerdrTarget } from '../../src/server/transport/herdr-target';
import { discoverLocalSession } from '../../src/server/transport/local-session';
import { reconcile } from '../../src/server/runtime/reconcile';
import type { AuditKind } from '../../src/server/auth/audit';
import { demoThreads } from './demo';
import type { DemoPaths } from './workspace';

const MINUTE = 60_000;
const minutesAgo = (minutes: number) => Date.now() - minutes * MINUTE;
const devices = [{ name: 'iPhone · Safari', created: 60 * 24, seen: 0 }, { name: 'iPad · Safari', created: 60 * 24 * 6, seen: 90 }];
const activity: { kind: AuditKind; source: string | null; deviceName: string | null; ago: number }[] = [
  { kind: 'invite_created', source: '127.0.0.1', deviceName: null, ago: 0 },
  { kind: 'invite_redeemed', source: '100.101.42.7', deviceName: 'iPhone · Safari', ago: 13 },
  { kind: 'invite_created', source: '127.0.0.1', deviceName: null, ago: 16 },
  { kind: 'pair_approved', source: '100.101.42.9', deviceName: 'iPad · Safari', ago: 60 * 24 * 6 },
  { kind: 'pair_requested', source: '100.101.42.9', deviceName: 'iPad · Safari', ago: 60 * 24 * 6 + 1 },
];

async function seedThreads(database: MetadataDatabase, paths: DemoPaths) {
  const profile = await discoverLocalSession({ ...process.env, HERDR_SOCKET_PATH: paths.socket });
  const target = new HerdrTarget(profile);
  try { reconcile(database, target, await target.snapshot()); } finally { target.close(); }
  for (const row of database.threadRows(target.id)) {
    const demo = demoThreads.find((thread) => row.alias?.startsWith(`w${demoThreads.indexOf(thread) + 1}:`));
    if (demo) database.saveThread({ ...row.metadata, updatedAt: new Date(minutesAgo(demo.minutesAgo)).toISOString() }, row.anchors, row.alias);
  }
}

export async function seedDatabase(paths: DemoPaths) {
  const database = new MetadataDatabase(join(paths.webrHome, 'gateway.sqlite'));
  try {
    await seedThreads(database, paths);
    for (const device of devices) database.addDeviceSession({ id: randomUUID(), name: device.name, createdAt: minutesAgo(device.created), lastSeenAt: minutesAgo(device.seen), tokenHash: randomBytes(32).toString('hex') });
    for (const event of [...activity].reverse()) database.addAuditEvent({ at: minutesAgo(event.ago), kind: event.kind, source: event.source, deviceName: event.deviceName });
  } finally { database.close(); }
}
