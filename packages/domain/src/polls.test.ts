import { describe, expect, it } from "vitest";

import { defaultPollExpirationAt } from "./polls";

describe("poll expiration", () => {
  it("defaults to three days after creation", () => {
    expect(defaultPollExpirationAt(new Date("2026-08-08T12:34:56.000Z"))).toBe(
      "2026-08-11T12:34:56.000Z",
    );
  });
});
