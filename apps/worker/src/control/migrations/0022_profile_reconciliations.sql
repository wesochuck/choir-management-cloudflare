CREATE TABLE IF NOT EXISTS organization_profile_reconciliations (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  source_profile_id TEXT NOT NULL,
  target_profile_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'prepared', 'relinked', 'completed', 'failed', 'needs_repair')),
  preview_revision TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id) REFERENCES member(id),
  FOREIGN KEY (actor_user_id) REFERENCES user(id)
);

CREATE INDEX IF NOT EXISTS idx_profile_reconciliations_org_state
  ON organization_profile_reconciliations(organization_id, state);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_reconciliations_idempotency
  ON organization_profile_reconciliations(organization_id, idempotency_key);

ALTER TABLE organization_roster_invite_enrollments ADD COLUMN canonical_profile_id TEXT;
