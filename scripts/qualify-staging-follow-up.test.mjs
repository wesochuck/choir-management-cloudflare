import { describe, expect, it } from "vitest";

import {
  followUpPhases,
  followUpQualificationPlan,
  reusableStagingSessionCookie,
} from "./qualify-staging-follow-up.mjs";

describe("staging follow-up qualification runner", () => {
  it("describes one authentication session and guarded follow-up phases", () => {
    expect(followUpQualificationPlan().join(" ")).toContain("authenticate once");
    expect(followUpQualificationPlan().join(" ")).toContain("STAGING_EXPORT_CREATE=1");
    expect(followUpQualificationPlan().join(" ")).toContain("without printing the session cookie");
  });

  it("keeps both phases enabled by default and permits explicit narrowing", () => {
    expect(followUpPhases()).toEqual(["export", "ticket-reminder"]);
    expect(followUpPhases({ runExport: false })).toEqual(["ticket-reminder"]);
    expect(followUpPhases({ runTicketReminder: false })).toEqual(["export"]);
    expect(followUpPhases({ runExport: false, runTicketReminder: false })).toEqual([]);
  });

  it("accepts only a staging session cookie and never transforms its value", () => {
    const cookie = "choir-management.session_token=opaque-value";
    expect(reusableStagingSessionCookie(cookie)).toBe(cookie);
    expect(reusableStagingSessionCookie(" ")).toBeNull();
    expect(() => reusableStagingSessionCookie("other=value")).toThrow(
      "not a staging session cookie",
    );
  });
});
