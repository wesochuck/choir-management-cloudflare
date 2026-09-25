import { describe, expect, it } from "vitest";

import { organizationProfileSchema, type OrganizationProfile } from "@choir/contracts";
import {
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
  it("escapes markdown special characters", () => {
    expect(escapeMarkdown("Jane & John [VIP] *Special* _Guest_")).toBe(
      "Jane & John \\[VIP\\] \\*Special\\* \\_Guest\\_",
    );
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
