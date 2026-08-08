import { describe, expect, it } from "vitest";

import { defaultPollExpirationAt, pollArchiveDueAt } from "./polls";

describe("poll expiration", () => {
  it("defaults to three days after creation", () => {
    expect(defaultPollExpirationAt(new Date("2026-08-08T12:34:56.000Z"))).toBe(
      "2026-08-11T12:34:56.000Z",
    );
  });

  it("archives two days after expiration", () => {
    expect(pollArchiveDueAt(new Date("2026-08-11T12:34:56.000Z"))).toBe("2026-08-13T12:34:56.000Z");
  });
});
