import { describe, expect, it } from "vitest";

import { organizationProfileSchema, type OrganizationProfile } from "@choir/contracts";
import {
  renderCommunicationMarkdown,
  renderCommunicationText,
} from "../src/communications/provider";
import {
  buildAlertContent,
  escapeMarkdown,
  financialAlertRecipients,
  formatEventDate,
  formatMoney,
  type FinancialAlertDatabase,
} from "../src/organization/ticketSaleAlerts";

function createMockProfile(overrides: Partial<OrganizationProfile> = {}): OrganizationProfile {
  return organizationProfileSchema.parse({
    createdAt: "2026-07-20T20:00:00.000Z",
    displayName: "Test Singer",
    id: crypto.randomUUID(),
    phone: "555-0100",
    updatedAt: "2026-07-20T20:00:00.000Z",
    ...overrides,
  });
}

function createMockD1Database(
  rows: readonly {
    readonly profileId: string | null;
    readonly email: string;
    readonly role?: string;
  }[],
): FinancialAlertDatabase {
  return {
    prepare: () => ({
      bind: () => ({
        all: () => Promise.resolve({ results: rows }),
      }),
    }),
  };
}

describe("ticketSaleAlerts recipient resolution", () => {
  it("includes an ordinary member role with receiveFinancialAlerts on", async () => {
    const profile = createMockProfile({
      receiveFinancialAlerts: true,
    });
    const db = createMockD1Database([
      { email: "member@example.test", profileId: profile.id, role: "member" },
    ]);

    const recipients = await financialAlertRecipients(db, "org-1", [profile]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toEqual({
      email: "member@example.test",
      name: "Test Singer",
      phone: "555-0100",
      profileId: profile.id,
    });
  });

  it("excludes profiles with receiveFinancialAlerts turned off", async () => {
    const profile = createMockProfile({
      receiveFinancialAlerts: false,
    });
    const db = createMockD1Database([
      { email: "member@example.test", profileId: profile.id, role: "admin" },
    ]);

    const recipients = await financialAlertRecipients(db, "org-1", [profile]);
    expect(recipients).toHaveLength(0);
  });

  it("excludes profiles with doNotEmail enabled", async () => {
    const profile = createMockProfile({
      doNotEmail: true,
      receiveFinancialAlerts: true,
    });
    const db = createMockD1Database([
      { email: "member@example.test", profileId: profile.id, role: "member" },
    ]);

    const recipients = await financialAlertRecipients(db, "org-1", [profile]);
    expect(recipients).toHaveLength(0);
  });

  it("excludes profiles with providerEmailSuppressed", async () => {
    const profile = createMockProfile({
      providerEmailSuppressed: true,
      receiveFinancialAlerts: true,
    });
    const db = createMockD1Database([
      { email: "member@example.test", profileId: profile.id, role: "owner" },
    ]);

    const recipients = await financialAlertRecipients(db, "org-1", [profile]);
    expect(recipients).toHaveLength(0);
  });

  it("excludes inactive or on-break profiles", async () => {
    const inactiveProfile = createMockProfile({
      globalStatus: "Inactive",
      receiveFinancialAlerts: true,
    });
    const idleProfile = createMockProfile({
      globalStatus: "Idle",
      receiveFinancialAlerts: true,
    });
    const db = createMockD1Database([
      { email: "inactive@example.test", profileId: inactiveProfile.id, role: "member" },
      { email: "idle@example.test", profileId: idleProfile.id, role: "member" },
    ]);

    const recipients = await financialAlertRecipients(db, "org-1", [inactiveProfile, idleProfile]);
    expect(recipients).toHaveLength(0);
  });

  it("excludes profiles with missing or unlinked membership/email", async () => {
    const linkedProfile = createMockProfile({
      displayName: "Linked Singer",
      receiveFinancialAlerts: true,
    });
    const unlinkedProfile = createMockProfile({
      displayName: "Unlinked Singer",
      receiveFinancialAlerts: true,
    });
    const db = createMockD1Database([
      { email: "linked@example.test", profileId: linkedProfile.id, role: "member" },
      { email: "not-an-email", profileId: unlinkedProfile.id, role: "member" },
    ]);

    const recipients = await financialAlertRecipients(db, "org-1", [
      linkedProfile,
      unlinkedProfile,
    ]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.profileId).toBe(linkedProfile.id);
  });
});

describe("ticketSaleAlerts content helpers", () => {
  it("escapes markdown special characters without escaping periods, hyphens, or parentheses", () => {
    expect(escapeMarkdown("Jane & John [VIP] *Special* _Guest_")).toBe(
      "Jane & John \\[VIP\\] \\*Special\\* \\_Guest\\_",
    );
    expect(escapeMarkdown("Robin Leach Jr. (VIP) Mary-Jane")).toBe(
      "Robin Leach Jr. (VIP) Mary-Jane",
    );
  });

  it("builds ticket sale alert markdown and renders emails without escaping email addresses or dates", () => {
    const alert = buildAlertContent(
      {
        amountPaidCents: 2091,
        buyerEmail: "leachrobing@gmail.com",
        buyerName: "Robin Leach",
        currency: "USD",
        eventId: "event-1",
        orderUrl: "https://example.test/admin/tickets",
        organizationId: "org-1",
        purchaseId: "purchase-1",
        quantity: 2,
        requestId: "req-1",
      },
      "2026 Christmas Concert",
      "2026-12-13T20:00:00.000Z",
      "America/New_York",
    );

    expect(alert.subject).toBe("Ticket sale: 2026 Christmas Concert — 2 × $20.91");
    expect(alert.contentMarkdown).toContain("- **Event:** 2026 Christmas Concert");
    expect(alert.contentMarkdown).toContain("- **Date:** Sunday, December 13, 2026 at 3:00 PM");
    expect(alert.contentMarkdown).toContain("- **Quantity:** 2");
    expect(alert.contentMarkdown).toContain("- **Amount paid:** $20.91");
    expect(alert.contentMarkdown).toContain("- **Buyer:** Robin Leach (leachrobing@gmail.com)");
    expect(alert.contentMarkdown).not.toContain("gmail\\.com");

    const html = renderCommunicationMarkdown(alert.contentMarkdown);
    expect(html).toContain("Robin Leach (leachrobing@gmail.com)");
    expect(html).not.toContain("gmail\\.com");

    const text = renderCommunicationText(alert.contentMarkdown);
    expect(text).toContain("Buyer: Robin Leach (leachrobing@gmail.com)");
    expect(text).not.toContain("gmail\\.com");
  });

  it("formats money correctly including $0.00 for comp orders", () => {
    expect(formatMoney(0, "usd")).toBe("$0.00");
    expect(formatMoney(2500, "usd")).toBe("$25.00");
    expect(formatMoney(1050, "usd")).toBe("$10.50");
  });

  it("formats event dates in timezone", () => {
    const formatted = formatEventDate("2026-12-15T19:30:00.000Z", "America/New_York");
    expect(formatted).toContain("2026");
    expect(formatted).toContain("December");
  });
});
