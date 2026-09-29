-- Expand the source-kind constraint without changing existing route identities or state.
-- No tables reference email_provider_routes; its Organization foreign key is preserved.
CREATE TABLE email_provider_routes_expanded (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'cloudflare_email'),
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'communication_delivery',
    'compliance_reminder',
    'ticket_notification',
    'audition_notification',
    'payment_notification',
    'platform_auth',
    'test_email'
  )),
  source_id TEXT NOT NULL,
  organization_id TEXT REFERENCES organizations(id),
  destination TEXT NOT NULL,
  provider_message_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'unknown')),
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (provider, source_kind, source_id),
  UNIQUE (provider, provider_message_id)
) STRICT;

INSERT INTO email_provider_routes_expanded
  (id, provider, source_kind, source_id, organization_id, destination,
   provider_message_id, state, created_at, accepted_at, updated_at)
SELECT id, provider, source_kind, source_id, organization_id, destination,
       provider_message_id, state, created_at, accepted_at, updated_at
FROM email_provider_routes;

DROP TABLE email_provider_routes;
ALTER TABLE email_provider_routes_expanded RENAME TO email_provider_routes;

CREATE INDEX email_provider_routes_provider_message_id
  ON email_provider_routes(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX email_provider_routes_pending
  ON email_provider_routes(state, updated_at);

