import { createTableRelationsHelpers, extractTablesRelationalConfig } from 'drizzle-orm';
import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { BaseSQLiteDatabase, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { NodeSqliteClient, RunResult } from './node-sqlite-client';

export type NodeSqliteDrizzle<Schema extends Record<string, unknown>> = BaseSQLiteDatabase<'sync', RunResult, Schema>;

/** drizzle's better-sqlite3 `drizzle()` and `migrate()` import the native package, so build both from its session classes. */
export function openMigratedDrizzle<Schema extends Record<string, unknown>>(client: NodeSqliteClient, schema: Schema, migrationsFolder: string): NodeSqliteDrizzle<Schema> {
  const dialect = new SQLiteSyncDialect();
  const relations = extractTablesRelationalConfig(schema, createTableRelationsHelpers);
  const relationalSchema = { fullSchema: schema, schema: relations.tables, tableNamesMap: relations.tableNamesMap };
  const session = new BetterSQLiteSession(client as never, dialect, relationalSchema);
  const config = { migrationsFolder };
  dialect.migrate(readMigrationFiles(config), session, config);
  return new BaseSQLiteDatabase('sync', dialect, session, relationalSchema) as NodeSqliteDrizzle<Schema>;
}
