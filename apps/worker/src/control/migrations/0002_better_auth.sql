-- Generated from the pinned Better Auth 1.6.23 configuration in
-- apps/worker/src/auth/config.ts, then reviewed for D1 constraints.

ALTER TABLE organizations ADD COLUMN logo TEXT;
ALTER TABLE organizations ADD COLUMN metadata TEXT;

CREATE TABLE user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL,
  image TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  twoFactorEnabled INTEGER
);

CREATE TABLE session (
  id TEXT PRIMARY KEY NOT NULL,
  expiresAt DATE NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  activeOrganizationId TEXT
);

CREATE TABLE account (
  id TEXT PRIMARY KEY NOT NULL,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt DATE,
  refreshTokenExpiresAt DATE,
  scope TEXT,
  password TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);

CREATE TABLE verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt DATE NOT NULL,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);

CREATE TABLE member (
  id TEXT PRIMARY KEY NOT NULL,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  createdAt DATE NOT NULL,
  UNIQUE (organizationId, userId)
);

CREATE TABLE invitation (
  id TEXT PRIMARY KEY NOT NULL,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT CHECK (role IS NULL OR role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'canceled')),
  expiresAt DATE NOT NULL,
  createdAt DATE NOT NULL,
  inviterId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE twoFactor (
  id TEXT PRIMARY KEY NOT NULL,
  secret TEXT NOT NULL,
  backupCodes TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  verified INTEGER,
  failedVerificationCount INTEGER,
  lockedUntil DATE
);

CREATE TABLE rateLimit (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  lastRequest INTEGER NOT NULL
);

CREATE TABLE platform_mfa_assertions (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('totp', 'recovery_code')),
  verified_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX session_userId_idx ON session(userId);
CREATE INDEX account_userId_idx ON account(userId);
CREATE INDEX verification_identifier_idx ON verification(identifier);
CREATE INDEX member_organizationId_idx ON member(organizationId);
CREATE INDEX member_userId_idx ON member(userId);
CREATE INDEX invitation_organizationId_idx ON invitation(organizationId);
CREATE INDEX invitation_email_idx ON invitation(email);
CREATE INDEX twoFactor_secret_idx ON twoFactor(secret);
CREATE UNIQUE INDEX twoFactor_userId_uidx ON twoFactor(userId);
CREATE INDEX platform_mfa_assertions_user_id_idx ON platform_mfa_assertions(user_id);
