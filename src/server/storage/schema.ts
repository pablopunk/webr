import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { Thread } from '../../lib/models';
import type { LaunchInput } from '../../shared/runtime';

export const threads = sqliteTable('app_threads', {
  id: text('id').primaryKey(), machineId: text('machine_id').notNull(), session: text('session').notNull(),
  alias: text('alias'), metadata: text('metadata', { mode: 'json' }).$type<Thread>().notNull(),
  anchors: text('anchors', { mode: 'json' }).$type<string[]>().notNull(), avatar: integer('avatar').notNull(),
}, (table) => [uniqueIndex('native_alias').on(table.machineId, table.session, table.alias)]);
export const operations = sqliteTable('launch_operations', {
  id: text('id').primaryKey(), accountId: text('account_id').notNull(), key: text('key').notNull(), hash: text('hash').notNull(), threadId: text('thread_id').notNull(),
  input: text('input', { mode: 'json' }).$type<LaunchInput>().notNull(), state: text('state').notNull(), step: text('step').notNull(),
  result: text('result', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
}, (table) => [uniqueIndex('account_operation_key').on(table.accountId, table.key)]);
export const settings = sqliteTable('app_settings', { key: text('key').primaryKey(), value: text('value').notNull() });
export const profiles = sqliteTable('machine_profiles', { id: text('id').primaryKey(), session: text('session').notNull(), configVersion: integer('config_version').notNull(), metadata: text('metadata').notNull() });
export const projectLocations = sqliteTable('project_locations', { id: text('id').primaryKey(), machineId: text('machine_id').notNull(), projectId: text('project_id').notNull(), path: text('path').notNull() });
export const deviceSessions = sqliteTable('device_sessions', {
  id: text('id').primaryKey(), tokenHash: text('token_hash').notNull(), name: text('name').notNull(),
  createdAt: integer('created_at').notNull(), lastSeenAt: integer('last_seen_at').notNull(),
}, (table) => [uniqueIndex('device_session_token').on(table.tokenHash)]);
