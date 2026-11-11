import { isPublicContentPath, isPublicWebsiteSlug } from "@choir/contracts";
import { describe, expect, it } from "vitest";
import { authenticatedRoutePrefixes, defaultAuthenticatedExactRoutes } from "../auth/postSignIn";

describe("website page route ownership", () => {
  it("reserves every owning root in the actual authenticated frontend route inventory", () => {
    for (const path of [...defaultAuthenticatedExactRoutes, ...authenticatedRoutePrefixes]) {
      const root = path.split("/")[1] ?? "";
      expect(isPublicWebsiteSlug(root), path).toBe(false);
      expect(isPublicContentPath(path), path).toBe(false);
    }
  });
  it("reserves transaction, signed-link, public system, and asset roots", () => {
    for (const root of [
      "api",
      "assets",
      "tickets",
      "donate",
      "checkout",
      "auditions",
      "join",
      "rsvp",
      "poll",
      "unsubscribe",
      "player",
      "privacy",
      "terms",
      "documents",
      "performances",
    ])
      expect(isPublicWebsiteSlug(root), root).toBe(false);
    expect(isPublicContentPath("/history")).toBe(true);
    expect(isPublicContentPath("/our-story")).toBe(true);
  });
});
