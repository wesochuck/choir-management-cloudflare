import type { OrganizationId } from "@choir/contracts";

export interface OrganizationFixture {
  readonly id: OrganizationId;
  readonly name: string;
  readonly slug: string;
}

export function createOrganizationFixture(
  overrides: Partial<OrganizationFixture> = {},
): OrganizationFixture {
  return {
    id: "organization-alpha",
    name: "Example Chorale",
    slug: "example-chorale",
    ...overrides,
  };
}
