import { describe, expect, it } from "vitest";

import {
  communicationFailureCategory,
  communicationReach,
  maskCommunicationDestination,
  renderCommunicationTemplate,
  renderOrganizationLogoPlaceholder,
  summarizeCommunicationDeliveries,
} from "./communications";

describe("Organization communications", () => {
  it("calculates channel-specific reach without counting unreachable recipients", () => {
    const recipients = [
      { email: "email@example.test", phone: "" },
      { email: "", phone: "+1 555 123 4567" },
      { email: "both@example.test", phone: "+1 555 987 6543" },
      { email: "", phone: "" },
    ];
    expect(communicationReach(recipients, "Email")).toEqual({
      both: 1,
      email: 2,
      sms: 2,
      total: 2,
      unreachable: 2,
    });
    expect(communicationReach(recipients, "Both").total).toBe(3);
  });

  it("masks destinations and categorizes raw provider failures", () => {
    expect(maskCommunicationDestination("person@example.test", "email")).toBe("p***@example.test");
    expect(maskCommunicationDestination("+1 (555) 123-4567", "sms")).toBe("***4567");
    expect(communicationFailureCategory("429 provider rate limit")).toBe("rate-limit");
    expect(communicationFailureCategory("credential unauthorized")).toBe("authentication");
  });

  it("inserts recipient names literally without replacement-token interpretation", () => {
    expect(renderCommunicationTemplate("Hello {singerName}", "$& $1 $$")).toBe("Hello $& $1 $$");
  });

  it("supports both scalar placeholder styles", () => {
    expect(
      renderCommunicationTemplate("Hello {singerName}; {{eventTitle}}", "Ada Alto", {
        eventTitle: "Spring Concert",
      }),
    ).toBe("Hello Ada Alto; Spring Concert");
  });

  it("supports buyerName placeholder as recipient name alias", () => {
    expect(
      renderCommunicationTemplate("Thank you {buyerName}; order for {{buyerName}}", "Jane Buyer"),
    ).toBe("Thank you Jane Buyer; order for Jane Buyer");
  });

  it("renders organization logo placeholder with image, fallback text, or plain text for SMS", () => {
    expect(
      renderOrganizationLogoPlaceholder({
        channel: "email",
        logoUrl: "https://example.com/logo.png",
        organizationName: "Seattle Chorale",
      }),
    ).toContain('<img src="https://example.com/logo.png" alt="Seattle Chorale"');

    expect(
      renderOrganizationLogoPlaceholder({
        channel: "email",
        logoUrl: null,
        organizationName: "Seattle Chorale",
      }),
    ).toContain(
      '<span style="font-size:18px;font-weight:bold;color:#1b4d3e;">Seattle Chorale</span>',
    );

    expect(
      renderOrganizationLogoPlaceholder({
        channel: "sms",
        logoUrl: "https://example.com/logo.png",
        organizationName: "Seattle Chorale",
      }),
    ).toBe("Seattle Chorale");
  });

  it("summarizes delivery state without exposing raw errors or destinations", () => {
    const summary = summarizeCommunicationDeliveries("message-1", [
      {
        attempts: 1,
        channel: "email",
        destination: "person@example.test",
        failureDetail: "provider rejected secret payload",
        status: "failed",
        updatedAt: "2026-07-22T12:00:00.000Z",
      },
      {
        attempts: 1,
        channel: "sms",
        destination: "+15551234567",
        failureDetail: "",
        status: "sent",
        updatedAt: "2026-07-22T12:01:00.000Z",
      },
    ]);
    expect(summary.state).toBe("partial");
    expect(summary.failures[0]).toMatchObject({
      category: "provider-rejected",
      maskedDestination: "p***@example.test",
    });
    expect(JSON.stringify(summary)).not.toContain("secret payload");
    expect(JSON.stringify(summary)).not.toContain("person@example.test");
  });
});
