ALTER TABLE email_provider_route_backfill ADD COLUMN cursor_organization_id TEXT;

ALTER TABLE email_provider_events ADD COLUMN bounce_type TEXT
  CHECK (bounce_type IS NULL OR bounce_type IN ('hard', 'soft'));
ALTER TABLE email_provider_events ADD COLUMN rejection_party TEXT
  CHECK (rejection_party IS NULL OR rejection_party IN ('sender', 'recipient', 'other'));
ALTER TABLE email_provider_events ADD COLUMN operator_status TEXT NOT NULL DEFAULT 'open'
  CHECK (operator_status IN ('open', 'acknowledged'));
ALTER TABLE email_provider_events ADD COLUMN operator_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE email_provider_events ADD COLUMN operator_actor_user_id TEXT;
ALTER TABLE email_provider_events ADD COLUMN operator_at TEXT;
ALTER TABLE email_provider_events ADD COLUMN manual_retry_count INTEGER NOT NULL DEFAULT 0
  CHECK (manual_retry_count >= 0);

ALTER TABLE email_feedback_dead_letters ADD COLUMN operator_status TEXT NOT NULL DEFAULT 'open'
  CHECK (operator_status IN ('open', 'acknowledged'));
ALTER TABLE email_feedback_dead_letters ADD COLUMN operator_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE email_feedback_dead_letters ADD COLUMN operator_actor_user_id TEXT;
ALTER TABLE email_feedback_dead_letters ADD COLUMN operator_at TEXT;

CREATE TABLE email_provider_profile_suppressions (
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  profile_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('bounce', 'complaint', 'provider_rejected')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, profile_id)
) STRICT;

CREATE INDEX email_provider_profile_suppressions_email
  ON email_provider_profile_suppressions(email_normalized, active, updated_at DESC);
