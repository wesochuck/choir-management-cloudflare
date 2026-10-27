import { publishedOrganizationProjectionSchema } from "@choir/contracts";

export const publicDonationProjection = publishedOrganizationProjectionSchema.parse({
  generatedAt: new Date().toISOString(),
  organizationId: "organization-alpha",
  payload: {
    mediaFileIds: [],
    organizationName: "Community Chorus",
    performances: [],
    settings: { showBrandingHeaderFooter: false },
    ticketBundles: [],
    timezone: "America/New_York",
  },
  version: 1,
});
