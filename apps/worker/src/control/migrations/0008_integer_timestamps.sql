-- Better Auth 1.6.23 expects INTEGER Unix timestamps, but the original
-- 0002_better_auth.sql used DATE which stores ISO strings via D1's adapter.
-- Convert all timestamp columns to INTEGER to match Better Auth's query format.

-- Save data from tables referencing session, then drop them
CREATE TABLE _mfa_backup AS SELECT * FROM platform_mfa_assertions;
DROP TABLE platform_mfa_assertions;

CREATE TABLE _elevations_backup AS SELECT * FROM platform_elevations;
DROP TABLE platform_elevations;

-- Recreate session with INTEGER timestamps
CREATE TABLE session_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  expiresAt INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  activeOrganizationId TEXT
);

INSERT INTO session_v2
  SELECT id,
    CAST(strftime('%s', SUBSTR(COALESCE(NULLIF(expiresAt, ''), '0'), 1, 19)) AS INTEGER),
    token,
    CAST(strftime('%s', SUBSTR(COALESCE(NULLIF(createdAt, ''), '0'), 1, 19)) AS INTEGER),
    CAST(strftime('%s', SUBSTR(COALESCE(NULLIF(updatedAt, ''), '0'), 1, 19)) AS INTEGER),
    ipAddress, userAgent, userId, activeOrganizationId
  FROM session;
DROP TABLE session;
ALTER TABLE session_v2 RENAME TO session;
CREATE INDEX session_userId_idx ON session(userId);

-- Restore platform_mfa_assertions
CREATE TABLE platform_mfa_assertions (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('totp', 'recovery_code')),
  verified_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

INSERT INTO platform_mfa_assertions SELECT * FROM _mfa_backup;
CREATE INDEX platform_mfa_assertions_user_id_idx ON platform_mfa_assertions(user_id);
DROP TABLE _mfa_backup;

-- Restore platform_elevations
CREATE TABLE platform_elevations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES platform_administrators(user_id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  request_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  session_id TEXT REFERENCES session(id)
) STRICT;

INSERT INTO platform_elevations SELECT * FROM _elevations_backup;
CREATE INDEX platform_elevations_active_scope
  ON platform_elevations (user_id, session_id, organization_id, expires_at)
  WHERE revoked_at IS NULL;
DROP TABLE _elevations_backup;
