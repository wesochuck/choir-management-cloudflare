export const controlPlaneTables = [
  "account",
  "invitation",
  "member",
  "organizations",
  "organization_domains",
  "organization_memberships",
  "organization_mfa_assertions",
  "organization_invitations",
  "platform_administrators",
  "platform_elevations",
  "platform_mfa_assertions",
  "platform_audit_events",
  "integration_routes",
  "job_dead_letters",
  "rateLimit",
  "session",
  "twoFactor",
  "user",
  "verification",
] as const;

export type ControlPlaneTable = (typeof controlPlaneTables)[number];
