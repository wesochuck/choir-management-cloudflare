import { describe, expect, it } from "vitest";

import {
  buildDonationAlertContent,
  formatDonationPaymentMethod,
  queueDonationAlert,
  type DonationAlertInput,
} from "../src/organization/donationAlerts";

describe("formatDonationPaymentMethod", () => {
  it("formats standard and offline payment methods", () => {
    expect(formatDonationPaymentMethod("stripe")).toBe("Credit/Debit Card (Stripe)");
    expect(formatDonationPaymentMethod("check")).toBe("Check");
    expect(formatDonationPaymentMethod("cash")).toBe("Cash");
    expect(formatDonationPaymentMethod("bank_transfer")).toBe("Bank transfer");
    expect(formatDonationPaymentMethod("card_offline")).toBe("Card (offline)");
    expect(formatDonationPaymentMethod("other")).toBe("Other");
    expect(formatDonationPaymentMethod(undefined)).toBe("Stripe");
    expect(formatDonationPaymentMethod("custom_gateway")).toBe("custom_gateway");
  });
});

describe("buildDonationAlertContent", () => {
  const baseInput: DonationAlertInput = {
    amountCents: 10_000,
    buyerEmail: "donor@example.test",
    buyerName: "Alex Donor",
    donationId: "11111111-1111-4111-8111-111111111111",
    orderUrl: "https://example.test/admin/donations",
    organizationId: "org-alpha",
    requestId: "22222222-2222-4222-8222-222222222222",
  };

  it("builds a concise donation receipt alert for a standard online donation", () => {
    const alert = buildDonationAlertContent(baseInput);

    expect(alert.subject).toBe("Donation receipt: Alex Donor — $100.00");
    expect(alert.contentMarkdown).toContain("## Donation receipt");
    expect(alert.contentMarkdown).toContain("- **Amount:** $100.00");
    expect(alert.contentMarkdown).toContain("- **Donor:** Alex Donor (donor@example\\.test)");
    expect(alert.contentMarkdown).toContain("- **Payment method:** Stripe");
    expect(alert.contentMarkdown).toContain(
      "[View donations in admin](https://example.test/admin/donations)",
    );
    expect(alert.contentMarkdown).not.toContain("Processing fee covered");
  });

  it("includes covered processing fee and total charged when feeCents is present", () => {
    const alert = buildDonationAlertContent({
      ...baseInput,
      feeCents: 320,
    });

    expect(alert.contentMarkdown).toContain("- **Amount:** $100.00");
    expect(alert.contentMarkdown).toContain("- **Processing fee covered:** $3.20");
    expect(alert.contentMarkdown).toContain("- **Total charged:** $103.20");
  });

  it("formats manual donation without email and with check reference", () => {
    const alert = buildDonationAlertContent({
      ...baseInput,
      buyerEmail: "",
      paymentMethod: "check",
      paymentReference: "Check #1042",
    });

    expect(alert.contentMarkdown).toContain("- **Donor:** Alex Donor");
    expect(alert.contentMarkdown).not.toContain("()");
    expect(alert.contentMarkdown).toContain("- **Payment method:** Check");
    expect(alert.contentMarkdown).toContain("- **Payment reference:** Check \\#1042");
  });

  it("includes donation level, tribute, and program ad sponsorship details", () => {
    const alert = buildDonationAlertContent({
      ...baseInput,
      includesProgramAd: true,
      selectedLevelName: "Benefactor Circle",
      sponsorName: "Acme Corp",
      tributeName: "Grandma Rose",
      tributeType: "memory",
    });

    expect(alert.contentMarkdown).toContain("- **Donation level:** Benefactor Circle");
    expect(alert.contentMarkdown).toContain("- **Tribute:** In memory of Grandma Rose");
    expect(alert.contentMarkdown).toContain(
      "- **Program ad sponsorship:** Included (Sponsor: Acme Corp)",
    );
  });

  it("formats honor tribute and program ad without separate sponsor name", () => {
    const alert = buildDonationAlertContent({
      ...baseInput,
      includesProgramAd: true,
      tributeName: "Maestro Smith",
      tributeType: "honor",
    });

    expect(alert.contentMarkdown).toContain("- **Tribute:** In honor of Maestro Smith");
    expect(alert.contentMarkdown).toContain("- **Program ad sponsorship:** Included");
  });

  it("escapes markdown special characters in user-provided text fields", () => {
    const alert = buildDonationAlertContent({
      ...baseInput,
      buyerName: "O'Connor & [Friends] *Special*",
      includesProgramAd: true,
      paymentReference: "Ref_#123*456*",
      sponsorName: "Dr. Jekyll & Mr. *Hyde*",
      tributeName: "Mary_Jane (1950-2020) [Honoree]",
      tributeType: "memory",
    });

    expect(alert.contentMarkdown).toContain("O'Connor & \\[Friends\\] \\*Special\\*");
    expect(alert.contentMarkdown).toContain("Ref\\_\\#123\\*456\\*");
    expect(alert.contentMarkdown).toContain("Dr\\. Jekyll & Mr\\. \\*Hyde\\*");
    expect(alert.contentMarkdown).toContain("Mary\\_Jane \\(1950\\-2020\\) \\[Honoree\\]");
  });
});

function createMockEnv(
  overrides: Record<string, unknown>,
): Parameters<typeof queueDonationAlert>[0] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test-only mock environment
  return overrides as unknown as Parameters<typeof queueDonationAlert>[0];
}

describe("queueDonationAlert", () => {
  it("returns null when CONTROL_DB is not configured", async () => {
    const result = await queueDonationAlert(
      createMockEnv({
        ORGANIZATION_STORE: {},
        SIGNED_LINK_SECRET: "secret",
      }),
      {
        amountCents: 5000,
        buyerName: "Sam Donor",
        donationId: "11111111-1111-4111-8111-111111111111",
        orderUrl: "https://example.test/admin/donations",
        organizationId: "org-1",
        requestId: "req-1",
      },
    );

    expect(result).toBeNull();
  });
});
