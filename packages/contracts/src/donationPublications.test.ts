import { describe, it, expect } from "vitest";
import {
  donationPublicationMutationSchema,
  donationSettingsSchema,
  donationInclusionMutationSchema,
  donationCheckoutRequestSchema,
  donationRecordSchema,
  publicDonationReceiptResponseSchema,
} from "./donations";
const id = "11111111-1111-4111-8111-111111111111";
const mutation = {
  id,
  name: "Holiday",
  recognitionDate: null,
  artworkDate: null,
  expectedRevision: 0,
  requestId: id,
};
describe("publication contracts", () => {
  it("accepts independent optional date values and validates real dates", () => {
    expect(donationPublicationMutationSchema.safeParse(mutation).success).toBe(true);
    expect(
      donationPublicationMutationSchema.safeParse({ ...mutation, recognitionDate: "2024-02-29" })
        .success,
    ).toBe(true);
    expect(
      donationPublicationMutationSchema.safeParse({ ...mutation, artworkDate: "2024-02-30" })
        .success,
    ).toBe(false);
  });
  it("rejects unbounded names and invalid revision/id values", () => {
    for (const value of [
      { ...mutation, name: " " },
      { ...mutation, name: "x".repeat(121) },
      { ...mutation, expectedRevision: -1 },
      { ...mutation, id: "other" },
    ])
      expect(donationPublicationMutationSchema.safeParse(value).success).toBe(false);
  });
  it("preserves settings from before publications existed", () => {
    const settings = { buttonText: "Give", description: "", levels: [] };
    expect(donationSettingsSchema.parse(settings).publication).toBeUndefined();
    expect(donationSettingsSchema.parse({ ...settings, publication: null }).publication).toBeNull();
    expect(
      donationSettingsSchema.parse({ ...settings, publication: undefined }).publication,
    ).toBeUndefined();
  });
  it("supports explicit inclusion correction and optimistic revisions", () => {
    expect(
      donationInclusionMutationSchema.safeParse({
        donationId: id,
        publicationId: null,
        expectedRevision: 1,
        requestId: id,
      }).success,
    ).toBe(true);
    expect(
      donationInclusionMutationSchema.safeParse({
        donationId: id,
        publicationId: id,
        requestId: id,
      }).success,
    ).toBe(false);
  });
  it("validates advertised checkout publication fields", () => {
    const checkout = {
      amountCents: 100,
      buyerEmail: "donor@example.test",
      buyerName: "Donor",
      checkoutRequestId: id,
    };
    expect(donationCheckoutRequestSchema.safeParse(checkout).success).toBe(true);
    expect(
      donationCheckoutRequestSchema.safeParse({
        ...checkout,
        publicationId: id,
        publicationRevision: 1,
      }).success,
    ).toBe(true);
    expect(
      donationCheckoutRequestSchema.safeParse({ ...checkout, publicationRevision: 0 }).success,
    ).toBe(false);
  });
  it("keeps staff inclusion decisions out of signed donor receipts", () => {
    const donation = donationRecordSchema.parse({
      id,
      amountCents: 100,
      anonymous: false,
      buyerEmail: "donor@example.test",
      buyerName: "Donor",
      createdAt: "2024-01-01T12:00:00Z",
      updatedAt: "2024-01-01T12:00:00Z",
      expiredAt: null,
      marketingConsent: false,
      patronId: null,
      status: "paid",
      tributeName: "",
      tributeNotifyEmail: "",
      tributeType: "none",
      includedPublicationId: id,
      includedPublicationName: "Spring",
      inclusionRevision: 1,
    });
    const receipt = publicDonationReceiptResponseSchema.parse({ ...donation, requestId: id });
    expect(receipt).not.toHaveProperty("includedPublicationId");
    expect(receipt).not.toHaveProperty("includedPublicationName");
    expect(receipt).not.toHaveProperty("inclusionRevision");
  });
});
