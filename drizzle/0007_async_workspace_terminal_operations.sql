CREATE TABLE create_operations (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  hash TEXT NOT NULL,
  input TEXT,
  machine_id TEXT NOT NULL,
  native_request_id TEXT NOT NULL,
  target_fingerprint TEXT NOT NULL,
  target_session TEXT,
  target_config_version INTEGER,
  state TEXT NOT NULL,
  step TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT '{}',
  error TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX account_create_operation_kind_key ON create_operations (account_id, kind, key);
--> statement-breakpoint
CREATE INDEX create_operation_capacity ON create_operations (account_id, machine_id, state);
