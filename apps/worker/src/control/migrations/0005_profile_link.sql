DROP INDEX member_organization_profile;

CREATE UNIQUE INDEX member_organization_profile
  ON member (organizationId, profileId)
  WHERE profileId IS NOT NULL;
