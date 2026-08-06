CREATE TABLE email_provider_routes (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'cloudflare_email'),
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'communication_delivery',
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

CREATE INDEX email_provider_routes_provider_message_id
  ON email_provider_routes(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX email_provider_routes_pending
  ON email_provider_routes(state, updated_at);

CREATE TABLE email_provider_route_backfill (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  completed_at TEXT
) STRICT;

INSERT INTO email_provider_route_backfill (id, completed_at) VALUES (1, NULL);

CREATE TABLE email_provider_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'cloudflare_email'),
  provider_message_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'delivered',
    'deferred',
    'bounced',
    'failed',
    'rejected',
    'complained'
  )),
  recipient TEXT NOT NULL,
  source_domain TEXT NOT NULL,
  terminal INTEGER NOT NULL CHECK (terminal IN (0, 1)),
  smtp_status_code TEXT,
  smtp_enhanced_status_code TEXT,
  smtp_response TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  event_timestamp TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'processed', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX email_provider_events_pending
  ON email_provider_events(state, next_attempt_at, created_at);

CREATE INDEX email_provider_events_provider_message_id
  ON email_provider_events(provider_message_id, event_timestamp);

CREATE TABLE email_recipient_suppressions (
  email_normalized TEXT PRIMARY KEY NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('bounce', 'complaint', 'provider_rejected')),
  source_event_id TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX email_recipient_suppressions_active
  ON email_recipient_suppressions(active, email_normalized);

CREATE TABLE email_feedback_dead_letters (
  id TEXT PRIMARY KEY NOT NULL,
  queue_name TEXT NOT NULL,
  message_id TEXT NOT NULL,
  event_id TEXT,
  provider_message_id TEXT,
  reason TEXT NOT NULL,
  observed_attempt INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE (queue_name, message_id)
) STRICT;

CREATE INDEX email_feedback_dead_letters_last_seen_at
  ON email_feedback_dead_letters(last_seen_at DESC, id DESC);
