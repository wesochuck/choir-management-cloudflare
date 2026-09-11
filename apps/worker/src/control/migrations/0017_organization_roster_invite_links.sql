CREATE TABLE IF NOT EXISTS organization_roster_invite_links (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  revocation_version INTEGER NOT NULL DEFAULT 1,
  revoked_at INTEGER,
  revoked_by_user_id TEXT,
  max_uses INTEGER,
  committed_uses INTEGER NOT NULL DEFAULT 0,
  active_reservations INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (revoked_by_user_id) REFERENCES user(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_roster_invite_links_org
  ON organization_roster_invite_links(organization_id);

CREATE TABLE IF NOT EXISTS organization_roster_invite_enrollments (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  link_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  membership_id TEXT,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'prepared', 'admitted', 'completed', 'canceled', 'needs_repair')),
  reservation_lease_expires_at INTEGER NOT NULL,
  fencing_version INTEGER NOT NULL DEFAULT 1,
  preexisting_membership INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (link_id) REFERENCES organization_roster_invite_links(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id) REFERENCES member(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_roster_enrollments_link
  ON organization_roster_invite_enrollments(link_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roster_enrollments_org_user
  ON organization_roster_invite_enrollments(organization_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roster_enrollments_idempotency
  ON organization_roster_invite_enrollments(organization_id, idempotency_key);
