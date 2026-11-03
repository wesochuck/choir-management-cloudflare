import { describe, expect, it } from "vitest";
import {
  checkoutRecoveryChoicesSchema,
  checkoutReminderSettingsMutationSchema,
  checkoutReminderTokenRequestSchema,
} from "./checkoutReminders";

describe("checkout reminder transport boundaries", () => {
  it("accepts only a boolean reminder setting", () => {
    expect(checkoutReminderSettingsMutationSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(checkoutReminderSettingsMutationSchema.safeParse({ enabled: "false" }).success).toBe(
      false,
    );
    expect(checkoutReminderSettingsMutationSchema.safeParse({}).success).toBe(false);
  });

  it("bounds signed input before verification", () => {
    expect(checkoutReminderTokenRequestSchema.safeParse({ token: "valid-shape" }).success).toBe(
      true,
    );
    expect(checkoutReminderTokenRequestSchema.safeParse({ token: "x".repeat(4097) }).success).toBe(
      false,
    );
    expect(checkoutReminderTokenRequestSchema.safeParse({ token: "" }).success).toBe(false);
  });

  it("returns only the allowed recovery projection and validates nullable choices", () => {
    const choices = {
      kind: "donation",
      bundleId: null,
      resourceId: "00000000-0000-4000-8000-000000000001",
      email: "donor@example.org",
      eventIds: [],
      quantity: null,
      amountCents: 5000,
      levelId: null,
      discountCode: null,
      buyerName: "Private name",
      artworkFileId: "private",
    };
    const parsed = checkoutRecoveryChoicesSchema.parse(choices);
    expect(parsed).not.toHaveProperty("buyerName");
    expect(parsed).not.toHaveProperty("artworkFileId");
    expect(checkoutRecoveryChoicesSchema.safeParse({ ...choices, amountCents: -1 }).success).toBe(
      false,
    );
    expect(checkoutRecoveryChoicesSchema.safeParse({ ...choices, email: "invalid" }).success).toBe(
      false,
    );
    expect(
      checkoutRecoveryChoicesSchema.safeParse({ ...choices, levelId: undefined }).success,
    ).toBe(false);
    const missing: Record<string, unknown> = { ...choices };
    delete missing.levelId;
    expect(checkoutRecoveryChoicesSchema.safeParse(missing).success).toBe(false);
    expect(
      checkoutRecoveryChoicesSchema.safeParse({ ...choices, levelId: "sponsor" }).success,
    ).toBe(true);
  });
});
