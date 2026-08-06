CREATE TABLE job_dead_letter_actions (
  dead_letter_id TEXT PRIMARY KEY NOT NULL REFERENCES job_dead_letters(id),
  status TEXT NOT NULL CHECK (status IN ('retry_requested', 'retry_queued', 'retry_failed', 'dismissed')),
  reason TEXT NOT NULL,
  error_detail TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT NOT NULL,
  action_at TEXT NOT NULL,
  retry_attempt INTEGER,
  retry_job_id TEXT,
  retry_idempotency_key TEXT
) STRICT;

CREATE INDEX job_dead_letter_actions_status
  ON job_dead_letter_actions (status, action_at DESC, dead_letter_id);
