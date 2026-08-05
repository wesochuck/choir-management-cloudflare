ALTER TABLE job_dead_letters
  ADD COLUMN resolution_status TEXT NOT NULL DEFAULT 'open'
  CHECK (resolution_status IN ('open', 'retry_queued', 'resolved', 'ignored'));

ALTER TABLE job_dead_letters
  ADD COLUMN resolution_note TEXT NOT NULL DEFAULT '';

ALTER TABLE job_dead_letters
  ADD COLUMN resolution_actor_user_id TEXT;

ALTER TABLE job_dead_letters
  ADD COLUMN resolution_at TEXT;

ALTER TABLE job_dead_letters
  ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0);

CREATE INDEX job_dead_letters_resolution_status
  ON job_dead_letters (resolution_status, last_seen_at DESC, id DESC);
