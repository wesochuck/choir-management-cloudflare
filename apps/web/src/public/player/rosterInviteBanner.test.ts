import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ROSTER_INVITE_BANNER_STORAGE_KEY,
  readRosterInviteBannerDismissed,
  shouldShowRosterInviteBanner,
  writeRosterInviteBannerDismissed,
} from "./rosterInviteBanner";

describe("rosterInviteBanner eligibility and persistence", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("shows the banner only when an active invite exists, visitor is anonymous, and not dismissed", () => {
    expect(
      shouldShowRosterInviteBanner({
        hasActiveInvite: true,
        isAnonymous: true,
        isDismissed: false,
      }),
    ).toBe(true);

    expect(
      shouldShowRosterInviteBanner({
        hasActiveInvite: false,
        isAnonymous: true,
        isDismissed: false,
      }),
    ).toBe(false);

    expect(
      shouldShowRosterInviteBanner({
        hasActiveInvite: true,
        isAnonymous: false,
        isDismissed: false,
      }),
    ).toBe(false);

    expect(
      shouldShowRosterInviteBanner({
        hasActiveInvite: true,
        isAnonymous: true,
        isDismissed: true,
      }),
    ).toBe(false);
  });

  it("persists dismissal in sessionStorage under the scoped key", () => {
    const scope = "alpha.localhost";
    expect(readRosterInviteBannerDismissed(scope)).toBe(false);

    writeRosterInviteBannerDismissed(scope);
    expect(readRosterInviteBannerDismissed(scope)).toBe(true);
    expect(sessionStorage.getItem(`${ROSTER_INVITE_BANNER_STORAGE_KEY}:${scope}`)).toBe("true");

    // Other scopes are not dismissed
    expect(readRosterInviteBannerDismissed("bravo.localhost")).toBe(false);
  });
});
