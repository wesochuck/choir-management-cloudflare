ALTER TABLE organizations ADD COLUMN provisioned_at TEXT;
ALTER TABLE organizations ADD COLUMN provisioning_workflow_id TEXT;

ALTER TABLE member ADD COLUMN profileId TEXT;

ALTER TABLE platform_elevations ADD COLUMN session_id TEXT REFERENCES session(id);

CREATE UNIQUE INDEX organizations_provisioning_workflow_id
  ON organizations (provisioning_workflow_id)
  WHERE provisioning_workflow_id IS NOT NULL;

CREATE INDEX member_organization_profile
  ON member (organizationId, profileId)
  WHERE profileId IS NOT NULL;

CREATE INDEX platform_elevations_active_scope
  ON platform_elevations (user_id, session_id, organization_id, expires_at)
  WHERE revoked_at IS NULL;
