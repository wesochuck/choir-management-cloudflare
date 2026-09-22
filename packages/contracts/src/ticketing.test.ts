import { describe, expect, it } from "vitest";

import { publicTicketPurchaseResponseSchema } from "./index";

describe("publicTicketPurchaseResponseSchema", () => {
  const basePurchase = {
    amountPaidCents: 2000,
    buyerName: "Jane Doe",
    checkoutMode: "stripe" as const,
    currency: "usd" as const,
    eventId: "11111111-1111-4111-8111-111111111111",
    eventStartsAt: "2026-10-15T19:30:00Z",
    eventTitle: "Spring Concert",
    feeCents: 100,
    id: "22222222-2222-4222-8222-222222222222",
    quantity: 1,
    requestId: "33333333-3333-4333-8333-333333333333",
    timezone: "America/New_York",
    unitPriceCents: 1900,
  };

  it("accepts paid purchase with valid scan token", () => {
    const result = publicTicketPurchaseResponseSchema.parse({
      ...basePurchase,
      scanToken: "signed.scan.token",
      status: "paid",
    });
    expect(result.status).toBe("paid");
    expect(result.scanToken).toBe("signed.scan.token");
  });

  it("rejects paid purchase with null or missing scan token", () => {
    expect(() =>
      publicTicketPurchaseResponseSchema.parse({
        ...basePurchase,
        scanToken: null,
        status: "paid",
      }),
    ).toThrow(/Paid ticket order must have a scan token/);
  });

  it("accepts pending purchase with null scan token or omitted scan token", () => {
    const parsedWithNull = publicTicketPurchaseResponseSchema.parse({
      ...basePurchase,
      scanToken: null,
      status: "pending",
    });
    expect(parsedWithNull.status).toBe("pending");
    expect(parsedWithNull.scanToken).toBeNull();

    const parsedOmitted = publicTicketPurchaseResponseSchema.parse({
      ...basePurchase,
      status: "pending",
    });
    expect(parsedOmitted.status).toBe("pending");
    expect(parsedOmitted.scanToken).toBeNull();
  });

  it("rejects pending purchase with non-null scan token", () => {
    expect(() =>
      publicTicketPurchaseResponseSchema.parse({
        ...basePurchase,
        scanToken: "unexpected.token",
        status: "pending",
      }),
    ).toThrow(/Unpaid or cancelled ticket order must not have a scan token/);
  });

  it("accepts refunded and expired purchases with null scan token", () => {
    const refunded = publicTicketPurchaseResponseSchema.parse({
      ...basePurchase,
      scanToken: null,
      status: "refunded",
    });
    expect(refunded.status).toBe("refunded");
    expect(refunded.scanToken).toBeNull();

    const expired = publicTicketPurchaseResponseSchema.parse({
      ...basePurchase,
      scanToken: null,
      status: "expired",
    });
    expect(expired.status).toBe("expired");
    expect(expired.scanToken).toBeNull();
  });

  it("rejects refunded and expired purchases with non-null scan token", () => {
    expect(() =>
      publicTicketPurchaseResponseSchema.parse({
        ...basePurchase,
        scanToken: "unexpected.token",
        status: "refunded",
      }),
    ).toThrow(/Unpaid or cancelled ticket order must not have a scan token/);

    expect(() =>
      publicTicketPurchaseResponseSchema.parse({
        ...basePurchase,
        scanToken: "unexpected.token",
        status: "expired",
      }),
    ).toThrow(/Unpaid or cancelled ticket order must not have a scan token/);
  });
});
