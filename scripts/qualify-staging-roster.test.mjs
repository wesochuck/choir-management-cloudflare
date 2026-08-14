import { describe, expect, it } from "vitest";

import {
  rosterBoundaryResponsesSafe,
  rosterImportedProfileMatches,
  rosterQualificationPlan,
  rosterQualificationRequestHeaders,
  safeRosterQualificationSummary,
} from "./qualify-staging-roster.mjs";

describe("staging roster qualification helpers", () => {
  it("plans CRUD, import/export, directory, isolation, and bounded cleanup evidence", () => {
    const plan = rosterQualificationPlan().join("\n");
    expect(plan).toContain("create one no-email Profile");
    expect(plan).toContain("supported roster CSV endpoint");
    expect(plan).toContain("canonical roster export");
    expect(plan).toContain("directory inclusion");
    expect(plan).toContain("wrong Organization host");
    expect(plan).toContain("no supported delete route exists");
  });

  it("accepts authorization failures or target absence across the wrong Organization", () => {
    expect(
      rosterBoundaryResponsesSafe(
        [
          { status: 200, body: { profiles: [{ id: "other-profile" }] } },
          { status: 200, text: "Name,Email\nOther Profile," },
          { status: 404, body: { code: "not_found" } },
        ],
        ["primary-profile", "imported-profile"],
        ["Primary Fixture", "Imported Fixture"],
      ),
    ).toBe(true);
    expect(
      rosterBoundaryResponsesSafe(
        [
          { status: 200, body: { profiles: [{ id: "primary-profile" }] } },
          { status: 403, text: "" },
          { status: 403, body: { code: "forbidden" } },
        ],
        ["primary-profile", "imported-profile"],
        ["Primary Fixture", "Imported Fixture"],
      ),
    ).toBe(false);
  });

  it("returns only bounded synthetic identifiers and boolean evidence", () => {
    const summary = safeRosterQualificationSummary({
      cleanupCompleted: true,
      createAndUpdateVerified: true,
      crossOrganizationRejected: true,
      directoryTransitionsVerified: true,
      exportChecksum: "a".repeat(64),
      importVerified: true,
      importedProfileId: "imported-profile",
      noLoginProfilesVerified: true,
      primaryProfileId: "primary-profile",
      sessionCookie: "must-not-appear",
      recipientEmail: "secret@example.test",
    });
    expect(summary).toEqual({
      cleanupCompleted: true,
      createAndUpdateVerified: true,
      crossOrganizationRejected: true,
      directoryTransitionsVerified: true,
      exportChecksum: "a".repeat(64),
      importVerified: true,
      importedProfileId: "imported-profile",
      noLoginProfilesVerified: true,
      primaryProfileId: "primary-profile",
    });
    expect(JSON.stringify(summary)).not.toContain("secret@example.test");
    expect(JSON.stringify(summary)).not.toContain("must-not-appear");
  });

  it("sets the canonical origin on mutating requests", () => {
    expect(
      rosterQualificationRequestHeaders(
        "https://lcc.staging.musicsite.org/api/organization/profiles",
        "choir-management.session_token=redacted",
        true,
        { "content-type": "text/csv" },
      ),
    ).toMatchObject({
      origin: "https://lcc.staging.musicsite.org",
      "content-type": "text/csv",
      cookie: "choir-management.session_token=redacted",
    });
  });

  it("normalizes reused imported fixtures before verification", () => {
    expect(
      rosterImportedProfileMatches(
        { displayName: "Qualification Roster Import run", globalStatus: "Active", voicePart: "A1" },
        "Qualification Roster Import run",
      ),
    ).toBe(true);
    expect(
      rosterImportedProfileMatches(
        {
          displayName: "Qualification Roster Import run",
          globalStatus: "Inactive",
          voicePart: "A1",
        },
        "Qualification Roster Import run",
      ),
    ).toBe(false);
  });
});
