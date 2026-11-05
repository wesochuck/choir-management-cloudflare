import { describe, expect, it } from "vitest";

import { AUDIT_QUERY } from "./audit-unlinked-admins.mjs";

describe("audit-unlinked-admins script", () => {
  it("defines read-only SQL query targeting unlinked owners and administrators", () => {
    expect(AUDIT_QUERY).toContain("SELECT");
    expect(AUDIT_QUERY).not.toContain("UPDATE");
    expect(AUDIT_QUERY).not.toContain("DELETE");
    expect(AUDIT_QUERY).not.toContain("INSERT");
    expect(AUDIT_QUERY).toContain("m.role IN ('owner', 'admin')");
    expect(AUDIT_QUERY).toContain("m.profileId IS NULL");
  });
});
