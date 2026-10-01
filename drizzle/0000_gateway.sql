CREATE TABLE app_threads (id TEXT PRIMARY KEY NOT NULL, machine_id TEXT NOT NULL, session TEXT NOT NULL, alias TEXT, metadata TEXT NOT NULL, anchors TEXT NOT NULL, avatar INTEGER NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX native_alias ON app_threads(machine_id, session, alias);
--> statement-breakpoint
CREATE TABLE launch_operations (id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, thread_id TEXT NOT NULL, input TEXT NOT NULL, state TEXT NOT NULL, step TEXT NOT NULL, result TEXT NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX account_operation_key ON launch_operations(account_id, key);
--> statement-breakpoint
CREATE TABLE app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE machine_profiles (id TEXT PRIMARY KEY NOT NULL, session TEXT NOT NULL, config_version INTEGER NOT NULL, metadata TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE project_locations (id TEXT PRIMARY KEY NOT NULL, machine_id TEXT NOT NULL, project_id TEXT NOT NULL, path TEXT NOT NULL);
