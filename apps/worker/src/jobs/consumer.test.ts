import { describe, expect, it } from "vitest";

import { renderCommunicationMarkdown } from "../communications/provider";
import { verifySignedLink } from "../security/signedLinks";
import { renderPlayerLinks, renderRsvpLinks } from "./consumer";
import { renderPollLinks, renderTicketLinks } from "./deliveries/shared";

const secret = "unit-test-rsvp-link-secret-that-is-at-least-thirty-two-characters";

describe("communication RSVP links", () => {
  it("renders a personalized no-login link scoped to the event and profile", async () => {
    const content = await renderRsvpLinks(
      { PRODUCT_BASE_DOMAIN: "staging.example.test", SIGNED_LINK_SECRET: secret },
      "organization-alpha",
      "Please respond here: {{RSVP_LINKS}}",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      {
        profileId: "11111111-1111-4111-8111-111111111111",
        unsubscribeUrl: "https://alpha.staging.example.test/unsubscribe?token=test",
      },
    );
    const link = /https:\/\/alpha\.staging\.example\.test\/rsvp\?token=([^\s)]+)/.exec(
      content,
    )?.[1];
    expect(link).toBeTruthy();
    expect(content).toContain("No login required");
    await expect(
      verifySignedLink(secret, decodeURIComponent(link ?? ""), {
        expectedOrganizationId: "organization-alpha",
        expectedPurpose: "rsvp",
        expectedResourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        expectedSubjectId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toMatchObject({
      organizationId: "organization-alpha",
      purpose: "rsvp",
      resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      subjectId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("explains when an RSVP placeholder is used without an event", async () => {
    await expect(
      renderRsvpLinks(
        { PRODUCT_BASE_DOMAIN: "staging.example.test", SIGNED_LINK_SECRET: secret },
        "organization-alpha",
        "{{RSVP_LINKS}}",
        null,
        { profileId: "11111111-1111-4111-8111-111111111111", unsubscribeUrl: null },
      ),
    ).resolves.toBe("RSVP link unavailable; select an event before sending this message.");
  });
});

describe("communication practice-player links", () => {
  it("renders a personalized no-login link scoped to the event and profile", async () => {
    const content = await renderPlayerLinks(
      { PRODUCT_BASE_DOMAIN: "staging.example.test", SIGNED_LINK_SECRET: secret },
      "organization-alpha",
      "Practice here: {{PLAYER_LINK}}",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      {
        profileId: "11111111-1111-4111-8111-111111111111",
        unsubscribeUrl: "https://alpha.staging.example.test/unsubscribe?token=test",
      },
    );
    const link = /https:\/\/alpha\.staging\.example\.test\/player\?token=([^\s)]+)/.exec(
      content,
    )?.[1];
    expect(link).toBeTruthy();
    expect(content).toContain("No login required");
    await expect(
      verifySignedLink(secret, decodeURIComponent(link ?? ""), {
        expectedOrganizationId: "organization-alpha",
        expectedPurpose: "player",
        expectedResourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        expectedSubjectId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toMatchObject({
      organizationId: "organization-alpha",
      purpose: "player",
      resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      subjectId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("explains when a practice-player placeholder is used without an event", async () => {
    await expect(
      renderPlayerLinks(
        { PRODUCT_BASE_DOMAIN: "staging.example.test", SIGNED_LINK_SECRET: secret },
        "organization-alpha",
        "{{PLAYER_LINK}}",
        null,
        { profileId: "11111111-1111-4111-8111-111111111111", unsubscribeUrl: null },
      ),
    ).resolves.toBe("Practice player unavailable; select an event before sending this message.");
  });
});

describe("communication poll links", () => {
  it("renders a personalized no-login call to action with an exact signed URL", async () => {
    const content = await renderPollLinks(
      { PRODUCT_BASE_DOMAIN: "staging.example.test", SIGNED_LINK_SECRET: secret },
      "organization-alpha",
      "Poll: Favorite color?\n\n{{POLL_LINK:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa}}",
      {
        profileId: "11111111-1111-4111-8111-111111111111",
        unsubscribeUrl: "https://alpha.staging.example.test/unsubscribe?token=test",
      },
    );
    const link = /\[Respond Here \(No login required\)\]\((https:\/\/[^)]+)\)/.exec(content)?.[1];
    expect(link).toBeTruthy();
    expect(content).toContain("Poll: Favorite color?");
    expect(content).not.toMatch(/^https?:\/\//m);
    const rendered = renderCommunicationMarkdown(content);
    expect(rendered).toContain(`href="${link ?? ""}"`);
    expect(rendered).toContain(">Respond Here (No login required)</a>");
    expect(rendered).toContain('role="presentation"');

    const token = new URL(link ?? "https://invalid.test").searchParams.get("token");
    await expect(
      verifySignedLink(secret, token ?? "", {
        expectedOrganizationId: "organization-alpha",
        expectedPurpose: "poll",
        expectedResourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        expectedSubjectId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toMatchObject({
      organizationId: "organization-alpha",
      purpose: "poll",
      resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      subjectId: "11111111-1111-4111-8111-111111111111",
    });
  });
});

describe("ticket order links", () => {
  it("uses a refund-safe order-details label while preserving the ticket link label", async () => {
    const content = await renderTicketLinks(
      { PRODUCT_BASE_DOMAIN: "staging.example.test", SIGNED_LINK_SECRET: secret },
      "organization-alpha",
      "{{TICKET_ORDER_LINK}}\n\n{{TICKET_LINK}}",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "2026-10-01T20:00:00Z",
    );

    const [refundAction, confirmationAction] = content.split("\n\n");
    expect(refundAction).toMatch(
      /^\[View order details\]\(https:\/\/staging\.example\.test\/tickets\/order\/success\?token=/,
    );
    expect(refundAction).not.toContain("View ticket / QR code");
    expect(confirmationAction).toContain(
      "[View ticket / QR code](https://staging.example.test/tickets/order/success?token=",
    );
    const token = new URL(
      /\((https:\/\/[^)]+)\)/.exec(refundAction ?? "")?.[1] ?? "https://invalid.test",
    ).searchParams.get("token");
    await expect(
      verifySignedLink(secret, token ?? "", {
        expectedOrganizationId: "organization-alpha",
        expectedPurpose: "ticket_receipt",
        expectedResourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    ).resolves.toMatchObject({
      organizationId: "organization-alpha",
      purpose: "ticket_receipt",
      resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    const refundUsingLegacyPlaceholder = await renderTicketLinks(
      { PRODUCT_BASE_DOMAIN: "staging.example.test", SIGNED_LINK_SECRET: secret },
      "organization-alpha",
      "{{TICKET_LINK}}",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "2026-10-01T20:00:00Z",
      true,
    );
    expect(refundUsingLegacyPlaceholder).toContain("[View order details](");
    expect(refundUsingLegacyPlaceholder).not.toContain("View ticket / QR code");
  });
});
