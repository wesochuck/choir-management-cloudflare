CREATE TABLE _mfa_backup AS SELECT * FROM platform_mfa_assertions;
DROP TABLE platform_mfa_assertions;

CREATE TABLE platform_mfa_assertions (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('totp', 'recovery_code', 'passkey')),
  verified_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

INSERT INTO platform_mfa_assertions SELECT * FROM _mfa_backup;
CREATE INDEX platform_mfa_assertions_user_id_idx ON platform_mfa_assertions(user_id);
DROP TABLE _mfa_backup;
