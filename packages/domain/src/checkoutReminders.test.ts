import { describe, expect, it } from "vitest";
import {
  CHECKOUT_REMINDER_WAIT_MS,
  CHECKOUT_REMINDER_COOLDOWN_MS,
  checkoutReminderCompletedBy,
  checkoutReminderTimeEligible,
  normalizeCheckoutReminderEmail,
  type CheckoutReminderPurchase,
} from "./checkoutReminders";

const attempt: CheckoutReminderPurchase = {
  kind: "ticket",
  email: " Buyer+choir@example.org ",
  organizationId: "organization-a",
  occurredAt: 100,
  performanceIds: ["spring", "summer"],
};

describe("incomplete checkout reminder rules", () => {
  it("cancels a bundle after a later individual purchase of any included performance", () => {
    expect(
      checkoutReminderCompletedBy(attempt, {
        ...attempt,
        email: "buyer+choir@example.org",
        occurredAt: 101,
        performanceIds: ["summer"],
      }),
    ).toBe(true);
  });

  it("does not match another Organization, address, type, performance, or older payment", () => {
    const unrelated: readonly CheckoutReminderPurchase[] = [
      { ...attempt, organizationId: "organization-b" },
      { ...attempt, email: "buyer@example.org" },
      { ...attempt, kind: "donation" },
      { ...attempt, performanceIds: ["winter"] },
      { ...attempt, occurredAt: 99 },
    ];
    for (const completed of unrelated)
      expect(checkoutReminderCompletedBy(attempt, completed)).toBe(false);
  });

  it("matches donations without requiring performance associations", () => {
    const donation = { ...attempt, kind: "donation" as const, performanceIds: [] };
    expect(checkoutReminderCompletedBy(donation, { ...donation, occurredAt: 101 })).toBe(true);
  });

  it("normalizes email case and whitespace without collapsing mailbox aliases", () => {
    expect(normalizeCheckoutReminderEmail(" Buyer+Choir@Example.org ")).toBe(
      "buyer+choir@example.org",
    );
  });

  it("includes exact wait, cooldown and event cutoff boundaries", () => {
    const now = CHECKOUT_REMINDER_COOLDOWN_MS;
    const input = {
      now,
      startedAt: now - CHECKOUT_REMINDER_WAIT_MS,
      lastSentAt: 0,
      firstPerformanceAt: now + CHECKOUT_REMINDER_WAIT_MS,
    };
    expect(checkoutReminderTimeEligible(input)).toBe(true);
    expect(checkoutReminderTimeEligible({ ...input, startedAt: input.startedAt + 1 })).toBe(false);
    expect(checkoutReminderTimeEligible({ ...input, lastSentAt: 1 })).toBe(false);
    expect(
      checkoutReminderTimeEligible({ ...input, firstPerformanceAt: input.firstPerformanceAt - 1 }),
    ).toBe(false);
  });

  it("permits a first donation reminder but fails closed on invalid timestamps", () => {
    const input = {
      now: CHECKOUT_REMINDER_WAIT_MS,
      startedAt: 0,
      lastSentAt: null,
      firstPerformanceAt: null,
    };
    expect(checkoutReminderTimeEligible(input)).toBe(true);
    expect(checkoutReminderTimeEligible({ ...input, now: NaN })).toBe(false);
    expect(checkoutReminderTimeEligible({ ...input, firstPerformanceAt: NaN })).toBe(false);
    expect(checkoutReminderCompletedBy(attempt, { ...attempt, occurredAt: NaN })).toBe(false);
  });
});
