ALTER TABLE launch_operations ADD COLUMN kind TEXT NOT NULL DEFAULT 'thread';
--> statement-breakpoint
ALTER TABLE launch_operations ADD COLUMN target_fingerprint TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE launch_operations ADD COLUMN target_session TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE launch_operations ADD COLUMN target_config_version INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE launch_operations ADD COLUMN error TEXT;
--> statement-breakpoint
DROP INDEX account_operation_key;
--> statement-breakpoint
CREATE UNIQUE INDEX account_operation_kind_key ON launch_operations (account_id, kind, key);
--> statement-breakpoint
CREATE TABLE launch_tombstones (id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, thread_id TEXT NOT NULL, state TEXT NOT NULL, step TEXT NOT NULL, result TEXT NOT NULL, error TEXT);
--> statement-breakpoint
CREATE UNIQUE INDEX account_launch_tombstone_kind_key ON launch_tombstones (account_id, kind, key);
