CREATE TABLE email_change_requests (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  old_email TEXT NOT NULL,
  new_email TEXT NOT NULL,
  confirmation_origin TEXT NOT NULL,
  token_fingerprint TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'expired', 'superseded')),
  confirmed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX email_change_requests_user_status
  ON email_change_requests(user_id, status, created_at DESC);

CREATE INDEX email_change_requests_token_fingerprint
  ON email_change_requests(token_fingerprint);

CREATE UNIQUE INDEX email_change_requests_pending_user
  ON email_change_requests(user_id)
  WHERE status = 'pending';

CREATE INDEX user_email_normalized
  ON user(lower(email));

CREATE TABLE email_change_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  email_change_request_id TEXT NOT NULL REFERENCES email_change_requests(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN (
    'requested_old',
    'requested_new',
    'confirmed_old',
    'confirmed_new'
  )),
  recipient TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'sending', 'sent', 'failed', 'canceled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE (email_change_request_id, phase)
) STRICT;

CREATE INDEX email_change_notifications_pending
  ON email_change_notifications(state, next_attempt_at, created_at);

INSERT INTO platform_audit_events (
  id,
  actor_user_id,
  organization_id,
  action,
  target_type,
  target_id,
  request_id,
  change_summary,
  occurred_at
)
SELECT
  'migration:0014-email-change',
  'system',
  NULL,
  'schema.email_change_requests_added',
  'control_schema',
  '0014',
  'migration:0014-email-change',
  '{"status":"applied"}',
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM platform_audit_events WHERE id = 'migration:0014-email-change'
);
