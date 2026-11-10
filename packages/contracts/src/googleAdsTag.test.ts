import { expect, it } from "vitest";
import { publicWebsiteSettingsRequestSchema } from "./organization";

it("accepts an optional Google Ads destination and clearing it", () => {
  for (const googleAdsTagId of [undefined, "", "AW-123456789"]) {
    expect(publicWebsiteSettingsRequestSchema.safeParse({ googleAdsTagId }).success).toBe(true);
  }
});
it("rejects script snippets, other tag types, null, and oversized IDs", () => {
  for (const googleAdsTagId of [
    null,
    "GTM-ABC",
    "G-ABC",
    "<script>alert(1)</script>",
    "AW-x",
    "AW-" + "1".repeat(30),
  ]) {
    expect(publicWebsiteSettingsRequestSchema.safeParse({ googleAdsTagId }).success).toBe(false);
  }
});
