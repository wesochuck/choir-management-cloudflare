import { describe, expect, it } from "vitest";

import { renderRsvpLinks } from "./consumer";
import { verifySignedLink } from "../security/signedLinks";

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
