CREATE TABLE job_dead_letters (
  id TEXT PRIMARY KEY NOT NULL,
  queue_name TEXT NOT NULL,
  message_id TEXT NOT NULL,
  message_valid INTEGER NOT NULL CHECK (message_valid IN (0, 1)),
  observed_attempt INTEGER NOT NULL,
  organization_id TEXT,
  job_id TEXT,
  job_kind TEXT,
  idempotency_key TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE (queue_name, message_id)
) STRICT;

CREATE INDEX job_dead_letters_last_seen_at
  ON job_dead_letters (last_seen_at DESC, id DESC);

CREATE INDEX job_dead_letters_organization_id
  ON job_dead_letters (organization_id, last_seen_at DESC)
  WHERE organization_id IS NOT NULL;
