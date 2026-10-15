UPDATE app_threads
SET metadata = json_set(
  CASE WHEN json_type(metadata, '$.titleSync') IS NULL
    THEN json_set(metadata, '$.titleSync', json_object('version', 0, 'state', 'unknown'))
    ELSE metadata
  END,
  '$.metadataVersion', COALESCE(json_extract(metadata, '$.metadataVersion'), 0)
)
WHERE json_type(metadata, '$.metadataVersion') IS NULL
   OR json_type(metadata, '$.titleSync') IS NULL;
