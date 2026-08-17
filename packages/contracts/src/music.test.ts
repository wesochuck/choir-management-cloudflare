import { describe, expect, it } from "vitest";

import { organizationMusicCreditRenameRequestSchema } from "./music";

describe("organizationMusicCreditRenameRequestSchema", () => {
  it("trims valid exact credit names", () => {
    expect(
      organizationMusicCreditRenameRequestSchema.parse({
        currentName: "  Jane Doe ",
        newName: " Jane Q. Doe ",
      }),
    ).toEqual({ currentName: "Jane Doe", newName: "Jane Q. Doe" });
  });

  it("rejects missing, unchanged, and unknown request fields", () => {
    expect(
      organizationMusicCreditRenameRequestSchema.safeParse({
        currentName: "Jane Doe",
        newName: " Jane Doe ",
      }).success,
    ).toBe(false);
    expect(
      organizationMusicCreditRenameRequestSchema.safeParse({
        currentName: "",
        newName: "Jane Doe",
      }).success,
    ).toBe(false);
    expect(
      organizationMusicCreditRenameRequestSchema.safeParse({
        currentName: "Jane Doe",
        newName: "Jane Q. Doe",
        role: "composer",
      }).success,
    ).toBe(false);
  });

  it("accepts 300-character names and rejects 301-character names", () => {
    expect(
      organizationMusicCreditRenameRequestSchema.safeParse({
        currentName: "Current credit",
        newName: "n".repeat(300),
      }).success,
    ).toBe(true);
    expect(
      organizationMusicCreditRenameRequestSchema.safeParse({
        currentName: "Current credit",
        newName: "n".repeat(301),
      }).success,
    ).toBe(false);
  });
});
