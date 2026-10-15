import { describe, expect, it } from "vitest";
import { getDirectoryListingReason, isProfileDirectoryListed } from "./directoryListing";

describe("directoryListing", () => {
  it("considers active, visible, opted-in profile as listed", () => {
    const profile = { globalStatus: "Active", hidden: false, showInDirectory: true };
    expect(isProfileDirectoryListed(profile)).toBe(true);
    expect(getDirectoryListingReason(profile)).toBeNull();
  });

  it("considers on-break (Idle), visible, opted-in profile as listed", () => {
    const profile = { globalStatus: "Idle", hidden: false, showInDirectory: true };
    expect(isProfileDirectoryListed(profile)).toBe(true);
    expect(getDirectoryListingReason(profile)).toBeNull();
  });

  it("considers profile not listed if directory preference is off", () => {
    const profile = { globalStatus: "Active", hidden: false, showInDirectory: false };
    expect(isProfileDirectoryListed(profile)).toBe(false);
    expect(getDirectoryListingReason(profile)).toBe("Not listed: directory preference off");
  });

  it("considers profile not listed if off-roster (hidden=true) even when showInDirectory is true", () => {
    const profile = { globalStatus: "Active", hidden: true, showInDirectory: true };
    expect(isProfileDirectoryListed(profile)).toBe(false);
    expect(getDirectoryListingReason(profile)).toBe("Not listed: off roster");
  });

  it("considers profile not listed if Inactive even when showInDirectory is true and hidden is false", () => {
    const profile = { globalStatus: "Inactive", hidden: false, showInDirectory: true };
    expect(isProfileDirectoryListed(profile)).toBe(false);
    expect(getDirectoryListingReason(profile)).toBe("Not listed: inactive");
  });
});
