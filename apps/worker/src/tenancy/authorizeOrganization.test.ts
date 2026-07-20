import { describe, expect, it } from "vitest";

import { authorizeOrganization } from "./authorizeOrganization";

describe("authorizeOrganization", () => {
  const membership = {
    active: true,
    organizationId: "organization-alpha",
    role: "administrator",
    userId: "user-1",
  } as const;

  it("accepts a membership only for the host-resolved Organization", () => {
    expect(authorizeOrganization("organization-alpha", membership)).toEqual({
      ok: true,
      value: membership,
    });
  });

  it("rejects a membership from another Organization", () => {
    expect(authorizeOrganization("organization-bravo", membership)).toMatchObject({
      error: { code: "forbidden" },
      ok: false,
    });
  });
});
