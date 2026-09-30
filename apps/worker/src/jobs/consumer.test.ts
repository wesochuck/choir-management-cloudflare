import { describe, expect, it } from "vitest";

import { renderCommunicationMarkdown } from "../communications/provider";
import { verifySignedLink } from "../security/signedLinks";
import { renderPlayerLinks, renderRsvpLinks } from "./consumer";
import {
  deliveryOrigin,
  type JobConsumerEnv,
  renderPollLinks,
  renderTicketLinks,
  resolveCanonicalOrigin,
} from "./deliveries/shared";

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

describe("canonical origin resolution and link render query deduplication", () => {
  function createMockControlDb(hostnames: Record<string, string>): {
    readonly db: NonNullable<JobConsumerEnv["CONTROL_DB"]>;
    getQueryCount: () => number;
  } {
    let queryCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
    const db = {
      prepare: () => {
        queryCount += 1;
        return {
          bind: (organizationId: string) => ({
            first: <T>() => {
              const hostname = hostnames[organizationId];
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock
              return Promise.resolve((hostname ? { hostname } : null) as T);
            },
          }),
        };
      },
    } as unknown as NonNullable<JobConsumerEnv["CONTROL_DB"]>;

    return {
      db,
      getQueryCount: () => queryCount,
    };
  }

  it("resolves canonical active domain from CONTROL_DB", async () => {
    const { db, getQueryCount } = createMockControlDb({
      "org-1": "singers.org-1.com",
    });

    const origin = await resolveCanonicalOrigin({ CONTROL_DB: db }, "org-1");
    expect(origin).toBe("https://singers.org-1.com");
    expect(getQueryCount()).toBe(1);

    const missingOrigin = await resolveCanonicalOrigin({ CONTROL_DB: db }, "org-none");
    expect(missingOrigin).toBeNull();
    expect(getQueryCount()).toBe(2);

    const noDbOrigin = await resolveCanonicalOrigin({}, "org-1");
    expect(noDbOrigin).toBeNull();
  });

  it("preserves fallback to recipient unsubscribeUrl when canonicalOrigin is null", async () => {
    const { db, getQueryCount } = createMockControlDb({});
    const env = {
      CONTROL_DB: db,
      PRODUCT_BASE_DOMAIN: "base.example.test",
    };

    // Passing canonicalOrigin = null explicitly avoids D1 queries and falls back to recipient unsubscribeUrl
    const origin = await deliveryOrigin(
      env,
      "org-without-domain",
      { unsubscribeUrl: "https://recipient-specific.example.test/unsub?t=1" },
      null,
    );
    expect(origin).toBe("https://recipient-specific.example.test");
    expect(getQueryCount()).toBe(0);

    // When unsubscribeUrl is also null, falls back to PRODUCT_BASE_DOMAIN
    const baseOrigin = await deliveryOrigin(
      env,
      "org-without-domain",
      { unsubscribeUrl: null },
      null,
    );
    expect(baseOrigin).toBe("https://base.example.test");
    expect(getQueryCount()).toBe(0);
  });

  it("reuses resolved canonicalOrigin across all recipients and link renderers with exactly one D1 query", async () => {
    const { db, getQueryCount } = createMockControlDb({
      "org-alpha": "choir.alpha.org",
    });
    const env = {
      CONTROL_DB: db,
      PRODUCT_BASE_DOMAIN: "staging.example.test",
      SIGNED_LINK_SECRET: secret,
    };

    // Resolve canonical origin once at the job boundary
    const canonicalOrigin = await resolveCanonicalOrigin(env, "org-alpha");
    expect(canonicalOrigin).toBe("https://choir.alpha.org");
    expect(getQueryCount()).toBe(1);

    const recipients = [
      {
        profileId: "11111111-1111-4111-8111-111111111111",
        unsubscribeUrl: "https://fallback.test/u1",
      },
      {
        profileId: "22222222-2222-4222-8222-222222222222",
        unsubscribeUrl: "https://fallback.test/u2",
      },
      {
        profileId: "33333333-3333-4333-8333-333333333333",
        unsubscribeUrl: "https://fallback.test/u3",
      },
    ];

    const template =
      "Hello!\n\nRSVP: {{RSVP_LINKS}}\n\nPlayer: {{PLAYER_LINK}}\n\nPoll: {{POLL_LINK:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb}}";

    for (const recipient of recipients) {
      let content = await renderRsvpLinks(
        env,
        "org-alpha",
        template,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        recipient,
        canonicalOrigin,
      );
      content = await renderPlayerLinks(
        env,
        "org-alpha",
        content,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        recipient,
        canonicalOrigin,
      );
      content = await renderPollLinks(env, "org-alpha", content, recipient, canonicalOrigin);

      expect(content).toContain("https://choir.alpha.org/rsvp?token=");
      expect(content).toContain("https://choir.alpha.org/player?token=");
      expect(content).toContain("https://choir.alpha.org/poll?token=");
    }

    // Crucial assertion: despite 3 recipients * 3 link types = 9 link renderings,
    // the query count remains 1 because canonicalOrigin was reused!
    expect(getQueryCount()).toBe(1);
  });

  it("isolates canonical origins when two organizations are processed in succession", async () => {
    const { db, getQueryCount } = createMockControlDb({
      "org-1": "org1.com",
      "org-2": "org2.com",
    });
    const env = {
      CONTROL_DB: db,
      PRODUCT_BASE_DOMAIN: "staging.example.test",
      SIGNED_LINK_SECRET: secret,
    };

    const origin1 = await resolveCanonicalOrigin(env, "org-1");
    const origin2 = await resolveCanonicalOrigin(env, "org-2");
    expect(origin1).toBe("https://org1.com");
    expect(origin2).toBe("https://org2.com");
    expect(getQueryCount()).toBe(2);

    const rsvp1 = await renderRsvpLinks(
      env,
      "org-1",
      "{{RSVP_LINKS}}",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      { profileId: "11111111-1111-4111-8111-111111111111", unsubscribeUrl: null },
      origin1,
    );
    const rsvp2 = await renderRsvpLinks(
      env,
      "org-2",
      "{{RSVP_LINKS}}",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      { profileId: "22222222-2222-4222-8222-222222222222", unsubscribeUrl: null },
      origin2,
    );

    expect(rsvp1).toContain("https://org1.com/rsvp?token=");
    expect(rsvp2).toContain("https://org2.com/rsvp?token=");
    expect(getQueryCount()).toBe(2);
  });
});
