CREATE TABLE passkey (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  publicKey TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  credentialID TEXT NOT NULL,
  counter INTEGER NOT NULL,
  deviceType TEXT NOT NULL,
  backedUp INTEGER NOT NULL,
  transports TEXT,
  createdAt INTEGER NOT NULL,
  aaguid TEXT
);

CREATE INDEX passkey_userId_idx ON passkey(userId);
CREATE UNIQUE INDEX passkey_credentialID_idx ON passkey(credentialID);

CREATE TABLE session_auth_assurance (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('passkey')),
  verified_at INTEGER NOT NULL
) STRICT;

CREATE INDEX session_auth_assurance_user_id_idx ON session_auth_assurance(user_id);
