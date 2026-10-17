import { describe, expect, it } from "vitest";
import { publicWebsiteSettingsRequestSchema } from "./organization";

const embed = {
  kind: "image",
  title: "Our seal",
  src: "https://widgets.example.org/seal.svg",
  href: "https://example.org/profile",
  height: 240,
};

describe("public website footer contracts", () => {
  it("accepts older settings and omitted or undefined footer fields", () => {
    for (const input of [
      {},
      { footerText: undefined, footerEmbeds: undefined },
      { footerText: "", footerEmbeds: [] },
    ]) {
      expect(publicWebsiteSettingsRequestSchema.safeParse(input).success).toBe(true);
    }
  });
  it("accepts independent Organization image and iframe URLs", () => {
    expect(
      publicWebsiteSettingsRequestSchema.parse({
        footerText: "**Supporters**",
        footerEmbeds: [
          embed,
          { ...embed, kind: "iframe", src: "https://another-provider.test/widget", href: "" },
        ],
      }).footerEmbeds,
    ).toHaveLength(2);
  });
  it.each([
    "javascript:alert(1)",
    "data:image/svg+xml,test",
    "http://insecure.test",
    "https://user:pass@example.org",
    "/relative",
    "invalid",
  ])("rejects unsafe source and link: %s", (url) => {
    for (const key of ["src", "href"])
      expect(
        publicWebsiteSettingsRequestSchema.safeParse({ footerEmbeds: [{ ...embed, [key]: url }] })
          .success,
      ).toBe(false);
  });
  it.each([
    { footerText: null },
    { footerEmbeds: null },
    { footerText: "x".repeat(10_001) },
    { footerEmbeds: Array(7).fill(embed) },
    { footerEmbeds: [{ ...embed, title: "" }] },
    { footerEmbeds: [{ ...embed, height: 801 }] },
  ])("rejects invalid or unbounded content: %j", (input) => {
    expect(publicWebsiteSettingsRequestSchema.safeParse(input).success).toBe(false);
  });
});
