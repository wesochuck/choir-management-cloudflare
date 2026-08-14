import { describe, expect, it } from "vitest";

import { providerIndependentQualificationPlan } from "./qualify-staging-provider-independent.mjs";

describe("provider-independent staging qualification batch", () => {
  it("uses one authentication session for the roster and RSVP phases", () => {
    expect(providerIndependentQualificationPlan()).toEqual([
      "authenticate once in the user's own terminal without printing the session cookie",
      "run roster create/update/import/export/directory/isolation qualification",
      "reuse the same in-memory session for RSVP notes, attendance, finalization, export, and isolation",
      "stop on a failed batch phase and retain only bounded phase summaries",
    ]);
  });

  it("can opt into roster automation without changing the default phases", () => {
    expect(providerIndependentQualificationPlan({ includeRosterAutomation: true })).toContain(
      "optionally reuse the same session for roster status automation and isolation",
    );
    expect(providerIndependentQualificationPlan()).not.toContain(
      "optionally reuse the same session for roster status automation and isolation",
    );
  });
});
