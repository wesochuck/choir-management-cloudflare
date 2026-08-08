import { describe, expect, it } from "vitest";

import { organizationPollRequestSchema } from "./polls";

const validPoll = {
  expiresAt: "2026-08-11T12:34:56.000Z",
  options: [
    { id: "a0000000-0000-4000-8000-000000000001", label: "Yes", sortOrder: 0 },
    { id: "a0000000-0000-4000-8000-000000000002", label: "No", sortOrder: 1 },
  ],
  title: "Attend?",
};

describe("organization poll request", () => {
  it("requires an expiration date and time", () => {
    expect(organizationPollRequestSchema.safeParse(validPoll).success).toBe(true);
    expect(organizationPollRequestSchema.safeParse({ ...validPoll, expiresAt: "" }).success).toBe(
      false,
    );
    const withoutExpiration: Record<string, unknown> = { ...validPoll };
    delete withoutExpiration.expiresAt;
    expect(organizationPollRequestSchema.safeParse(withoutExpiration).success).toBe(false);
  });
});
