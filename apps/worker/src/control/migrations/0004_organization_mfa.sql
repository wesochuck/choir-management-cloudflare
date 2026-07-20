ALTER TABLE organizations
  ADD COLUMN mfa_required INTEGER NOT NULL DEFAULT 0 CHECK (mfa_required IN (0, 1));

CREATE TABLE organization_mfa_assertions (
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('totp', 'recovery_code')),
  verified_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, organization_id)
) STRICT;

CREATE INDEX organization_mfa_assertions_scope
  ON organization_mfa_assertions (organization_id, user_id, expires_at);
