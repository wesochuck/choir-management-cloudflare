export const controlPlaneTables = [
  "organizations",
  "organization_domains",
  "organization_memberships",
  "organization_invitations",
  "platform_administrators",
  "platform_elevations",
  "platform_audit_events",
  "integration_routes",
] as const;

export type ControlPlaneTable = (typeof controlPlaneTables)[number];
