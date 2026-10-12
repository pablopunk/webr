CREATE UNIQUE INDEX thread_provider_session ON app_threads (machine_id, session, json_extract(metadata, '$.bindingFingerprint'), json_extract(metadata, '$.providerSession.agent'), json_extract(metadata, '$.providerSession.kind'), json_extract(metadata, '$.providerSession.value'));
--> statement-breakpoint
CREATE UNIQUE INDEX thread_owner_token ON app_threads (machine_id, session, json_extract(metadata, '$.bindingFingerprint'), json_extract(metadata, '$.ownerToken'));
