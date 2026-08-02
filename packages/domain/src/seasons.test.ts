import { describe, expect, it } from "vitest";

import { canTransitionDues } from "./seasons";

describe("dues status transitions", () => {
  it("allows stale pending dues to expire and a later checkout to complete", () => {
    expect(canTransitionDues("pending", "expired")).toBe(true);
    expect(canTransitionDues("expired", "paid")).toBe(true);
  });

  it("does not reopen refunded or paid dues", () => {
    expect(canTransitionDues("refunded", "paid")).toBe(false);
    expect(canTransitionDues("paid", "pending")).toBe(false);
  });
});
