import { describe, expect, it } from "vitest";
import {
  donationCheckoutRequestSchema,
  donationRecordSchema,
  manualDonationCreateRequestSchema,
} from "./donations";

describe("Donation tribute contracts", () => {
  const baseCheckoutRequest = {
    amountCents: 2500,
    anonymous: false,
    buyerEmail: "donor@example.com",
    buyerName: "Jane Donor",
    checkoutRequestId: "11111111-1111-4111-8111-111111111111",
  };

  const baseManualRequest = {
    amountCents: 5000,
    anonymous: false,
    buyerEmail: "donor@example.com",
    buyerName: "John Donor",
  };

  const baseRecord = {
    amountCents: 2500,
    anonymous: false,
    buyerEmail: "donor@example.com",
    buyerName: "Jane Donor",
    createdAt: "2026-09-22T12:00:00.000Z",
    expiredAt: null,
    feeCents: 0,
    id: "22222222-2222-4222-8222-222222222222",
    marketingConsent: false,
    patronId: null,
    paymentMethod: "stripe" as const,
    paymentReference: "",
    refundRequested: false,
    status: "paid" as const,
    thankYouSentAt: null,
    tributeName: "",
    tributeNotifyEmail: "",
    updatedAt: "2026-09-22T12:00:00.000Z",
  };

  it("accepts none, honor, and memory for new checkout requests and defaults to none", () => {
    const defaulted = donationCheckoutRequestSchema.parse(baseCheckoutRequest);
    expect(defaulted.tributeType).toBe("none");

    const honor = donationCheckoutRequestSchema.parse({
      ...baseCheckoutRequest,
      tributeName: "Alice",
      tributeType: "honor",
    });
    expect(honor.tributeType).toBe("honor");

    const memory = donationCheckoutRequestSchema.parse({
      ...baseCheckoutRequest,
      tributeName: "Bob",
      tributeType: "memory",
    });
    expect(memory.tributeType).toBe("memory");
  });

  it("rejects tributeType 'anonymous' for new checkout requests", () => {
    const result = donationCheckoutRequestSchema.safeParse({
      ...baseCheckoutRequest,
      tributeType: "anonymous",
    });
    expect(result.success).toBe(false);
  });

  it("accepts none, honor, and memory for manual donation requests and defaults to none", () => {
    const defaulted = manualDonationCreateRequestSchema.parse(baseManualRequest);
    expect(defaulted.tributeType).toBe("none");

    const honor = manualDonationCreateRequestSchema.parse({
      ...baseManualRequest,
      tributeName: "Alice",
      tributeType: "honor",
    });
    expect(honor.tributeType).toBe("honor");
  });

  it("rejects tributeType 'anonymous' for manual donation requests", () => {
    const result = manualDonationCreateRequestSchema.safeParse({
      ...baseManualRequest,
      tributeType: "anonymous",
    });
    expect(result.success).toBe(false);
  });

  it("accepts historical 'anonymous' tributeType in stored donation records", () => {
    const historical = donationRecordSchema.parse({
      ...baseRecord,
      tributeType: "anonymous",
    });
    expect(historical.tributeType).toBe("anonymous");
  });

  it("keeps donor anonymity boolean completely independent from tribute type", () => {
    const anonWithHonor = donationCheckoutRequestSchema.parse({
      ...baseCheckoutRequest,
      anonymous: true,
      tributeName: "Alice",
      tributeType: "honor",
    });
    expect(anonWithHonor.anonymous).toBe(true);
    expect(anonWithHonor.tributeType).toBe("honor");

    const nonAnonNoTribute = donationCheckoutRequestSchema.parse({
      ...baseCheckoutRequest,
      anonymous: false,
      tributeType: "none",
    });
    expect(nonAnonNoTribute.anonymous).toBe(false);
    expect(nonAnonNoTribute.tributeType).toBe("none");
  });
});
