-- Expand Better Auth's role constraints. Move both referencing tables to the
-- new member table before dropping the prior one to preserve foreign keys.
ALTER TABLE member RENAME TO member_prior;
CREATE TABLE member (
  id TEXT PRIMARY KEY NOT NULL,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'website_editor')),
  createdAt DATE NOT NULL,
  profileId TEXT,
  lastActiveAt INTEGER,
  websiteEditor INTEGER NOT NULL DEFAULT 0 CHECK (websiteEditor IN (0, 1)),
  CHECK (role <> 'website_editor' OR profileId IS NULL),
  UNIQUE (organizationId, userId)
);
INSERT INTO member (id, organizationId, userId, role, createdAt, profileId, lastActiveAt)
  SELECT id, organizationId, userId, role, createdAt, profileId, lastActiveAt FROM member_prior;

ALTER TABLE organization_roster_invite_enrollments RENAME TO organization_roster_invite_enrollments_prior;
CREATE TABLE organization_roster_invite_enrollments (
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
  canonical_profile_id TEXT,
  profile_mode TEXT NOT NULL DEFAULT 'new' CHECK (profile_mode IN ('new', 'existing')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (link_id) REFERENCES organization_roster_invite_links(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id) REFERENCES member(id) ON DELETE SET NULL
);
INSERT INTO organization_roster_invite_enrollments SELECT * FROM organization_roster_invite_enrollments_prior;
DROP TABLE organization_roster_invite_enrollments_prior;

ALTER TABLE organization_profile_reconciliations RENAME TO organization_profile_reconciliations_prior;
CREATE TABLE organization_profile_reconciliations (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  source_profile_id TEXT NOT NULL,
  target_profile_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'prepared', 'relinked', 'completed', 'failed', 'needs_repair')),
  preview_revision TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  field_choices_json TEXT,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (membership_id) REFERENCES member(id),
  FOREIGN KEY (actor_user_id) REFERENCES user(id)
);
INSERT INTO organization_profile_reconciliations SELECT * FROM organization_profile_reconciliations_prior;
DROP TABLE organization_profile_reconciliations_prior;
DROP TABLE member_prior;

ALTER TABLE invitation RENAME TO invitation_prior;
CREATE TABLE invitation (
  id TEXT PRIMARY KEY NOT NULL,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT CHECK (role IS NULL OR role IN ('owner', 'admin', 'member', 'website_editor')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'canceled')),
  expiresAt DATE NOT NULL,
  createdAt DATE NOT NULL,
  inviterId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
INSERT INTO invitation SELECT * FROM invitation_prior;
DROP TABLE invitation_prior;

CREATE INDEX member_organizationId_idx ON member(organizationId);
CREATE INDEX member_userId_idx ON member(userId);
CREATE UNIQUE INDEX member_organization_profile ON member(organizationId, profileId)
  WHERE profileId IS NOT NULL;
CREATE INDEX invitation_organizationId_idx ON invitation(organizationId);
CREATE INDEX invitation_email_idx ON invitation(email);
CREATE INDEX idx_roster_enrollments_link ON organization_roster_invite_enrollments(link_id);
CREATE UNIQUE INDEX idx_roster_enrollments_org_user ON organization_roster_invite_enrollments(organization_id, user_id);
CREATE UNIQUE INDEX idx_roster_enrollments_idempotency ON organization_roster_invite_enrollments(organization_id, idempotency_key);
CREATE INDEX idx_profile_reconciliations_org_state ON organization_profile_reconciliations(organization_id, state);
CREATE UNIQUE INDEX idx_profile_reconciliations_idempotency ON organization_profile_reconciliations(organization_id, idempotency_key);
