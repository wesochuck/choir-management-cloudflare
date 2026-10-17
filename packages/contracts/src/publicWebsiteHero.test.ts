import { expect, it } from "vitest";
import { publicWebsiteSettingsRequestSchema } from "./organization";

it("accepts an explicitly blank or whitespace-only hero headline", () => {
  for (const heroHeadline of ["", " \n "])
    expect(publicWebsiteSettingsRequestSchema.parse({ heroHeadline }).heroHeadline).toBe("");
});
it("keeps the existing default for omitted headlines and the length limit", () => {
  expect(publicWebsiteSettingsRequestSchema.parse({}).heroHeadline).toBe("Welcome to Our Choir");
  expect(
    publicWebsiteSettingsRequestSchema.safeParse({ heroHeadline: "x".repeat(301) }).success,
  ).toBe(false);
});
