import { describe, expect, it } from "vitest";

import { findExpiringDateFixtures } from "./check-date-fixtures.mjs";

describe("findExpiringDateFixtures", () => {
  it("runs against the current repository and returns no expiring date violations", () => {
    const violations = findExpiringDateFixtures();
    expect(violations).toEqual([]);
  });
});
