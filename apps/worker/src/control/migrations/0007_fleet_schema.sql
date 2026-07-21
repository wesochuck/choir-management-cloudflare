CREATE TABLE fleet_schema_preparations (
  id TEXT PRIMARY KEY NOT NULL,
  target_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  processed_count INTEGER NOT NULL DEFAULT 0,
  cursor_organization_id TEXT,
  initiated_by TEXT NOT NULL,
  request_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  failure_code TEXT
) STRICT;

CREATE UNIQUE INDEX fleet_schema_preparations_one_running
  ON fleet_schema_preparations (status)
  WHERE status = 'running';

CREATE INDEX fleet_schema_preparations_started_at
  ON fleet_schema_preparations (started_at DESC, id DESC);
