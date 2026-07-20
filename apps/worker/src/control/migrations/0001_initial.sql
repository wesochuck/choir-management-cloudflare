PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('provisioning', 'active', 'suspended')),
  durable_object_key TEXT NOT NULL UNIQUE,
  operational_schema_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE organization_domains (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  hostname TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('canonical', 'custom_public')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disabled')),
  routing_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX organization_domains_organization_id
  ON organization_domains (organization_id);

CREATE TABLE organization_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL,
  profile_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'administrator', 'member')),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, user_id)
) STRICT;

CREATE TABLE organization_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  email_normalized TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'administrator', 'member')),
  token_fingerprint TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE platform_administrators (
  user_id TEXT PRIMARY KEY NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  mfa_enrolled_at TEXT,
  recovery_codes_confirmed_at TEXT
) STRICT;

CREATE TABLE platform_elevations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES platform_administrators(user_id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  request_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE platform_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL,
  organization_id TEXT REFERENCES organizations(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  change_summary TEXT NOT NULL,
  occurred_at TEXT NOT NULL
) STRICT;

CREATE TABLE integration_routes (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  provider TEXT NOT NULL,
  external_account_fingerprint TEXT NOT NULL,
  credential_ciphertext TEXT,
  credential_nonce TEXT,
  credential_key_version INTEGER,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider, external_account_fingerprint)
) STRICT;
