import { describe, expect, it } from "vitest";

import {
  determineCommunicationPlaceholderContext,
  extractCommunicationPlaceholders,
  isPlaceholderCompatibleWithAudience,
  isPlaceholderCompatibleWithChannel,
  removeCommunicationPlaceholder,
  templateMatchesCommunicationContext,
  validateCommunicationContext,
  visibleCommunicationPlaceholders,
  findCommunicationPlaceholderDefinition,
  type CommunicationAudienceLike,
} from "./communicationPlaceholders";

function audience(
  targetAudiences: CommunicationAudienceLike["targetAudiences"],
  eventId: string | null = null,
): CommunicationAudienceLike {
  return {
    eventId,
    targetAudiences,
  };
}

function getDef(tag: string) {
  const def = findCommunicationPlaceholderDefinition(tag);
  if (!def) {
    throw new Error(`Missing placeholder definition for ${tag}`);
  }
  return def;
}

describe("communicationPlaceholders domain logic", () => {
  describe("safe intersection audience compatibility", () => {
    it("allows member-only RSVP link for Members only, but rejects for Ticket Buyers or mixed audiences", () => {
      const rsvpDef = getDef("{{RSVP_LINKS}}");
      expect(rsvpDef).toBeDefined();

      expect(isPlaceholderCompatibleWithAudience(rsvpDef, ["Members"])).toBe(true);
      expect(isPlaceholderCompatibleWithAudience(rsvpDef, ["Ticket Buyers"])).toBe(false);
      expect(isPlaceholderCompatibleWithAudience(rsvpDef, ["Donors"])).toBe(false);
      expect(isPlaceholderCompatibleWithAudience(rsvpDef, ["Members", "Ticket Buyers"])).toBe(
        false,
      );
      expect(isPlaceholderCompatibleWithAudience(rsvpDef, ["Members", "Donors"])).toBe(false);
    });

    it("allows practice player link for Members only and rejects for mixed audiences", () => {
      const playerDef = getDef("{{PLAYER_LINK}}");
      expect(playerDef).toBeDefined();

      expect(isPlaceholderCompatibleWithAudience(playerDef, ["Members"])).toBe(true);
      expect(isPlaceholderCompatibleWithAudience(playerDef, ["Ticket Buyers"])).toBe(false);
      expect(isPlaceholderCompatibleWithAudience(playerDef, ["Members", "Ticket Buyers"])).toBe(
        false,
      );
    });

    it("allows shared event fields for Members, Ticket Buyers, Contacts, and mixed audiences", () => {
      const eventTitleDef = getDef("{eventTitle}");
      const eventDateDef = getDef("{eventDate}");

      expect(isPlaceholderCompatibleWithAudience(eventTitleDef, ["Members"])).toBe(true);
      expect(isPlaceholderCompatibleWithAudience(eventTitleDef, ["Ticket Buyers"])).toBe(true);
      expect(isPlaceholderCompatibleWithAudience(eventTitleDef, ["Contacts"])).toBe(true);
      expect(isPlaceholderCompatibleWithAudience(eventTitleDef, ["Members", "Ticket Buyers"])).toBe(
        true,
      );
      expect(isPlaceholderCompatibleWithAudience(eventTitleDef, ["Contacts", "Members"])).toBe(
        true,
      );
      expect(isPlaceholderCompatibleWithAudience(eventTitleDef, ["Donors"])).toBe(false);
      expect(isPlaceholderCompatibleWithAudience(eventTitleDef, ["Members", "Donors"])).toBe(false);

      expect(isPlaceholderCompatibleWithAudience(eventDateDef, ["Members", "Ticket Buyers"])).toBe(
        true,
      );
      expect(isPlaceholderCompatibleWithAudience(eventDateDef, ["Contacts"])).toBe(true);
    });

    it("allows ticket fields only for Ticket Buyers", () => {
      const ticketLinkDef = getDef("{{TICKET_LINK}}");
      const ticketEventListDef = getDef("{{TICKET_EVENT_LIST}}");
      const ticketQtyDef = getDef("{ticketQuantity}");

      expect(isPlaceholderCompatibleWithAudience(ticketLinkDef, ["Ticket Buyers"])).toBe(true);
      expect(isPlaceholderCompatibleWithAudience(ticketEventListDef, ["Ticket Buyers"])).toBe(true);
      expect(isPlaceholderCompatibleWithAudience(ticketLinkDef, ["Members"])).toBe(false);
      expect(isPlaceholderCompatibleWithAudience(ticketEventListDef, ["Members"])).toBe(false);
      expect(isPlaceholderCompatibleWithAudience(ticketLinkDef, ["Members", "Ticket Buyers"])).toBe(
        false,
      );

      expect(isPlaceholderCompatibleWithAudience(ticketQtyDef, ["Ticket Buyers"])).toBe(true);
      expect(isPlaceholderCompatibleWithAudience(ticketQtyDef, ["Members", "Ticket Buyers"])).toBe(
        false,
      );
    });

    it("describes bundle concerts with venue details and exposes the list only for bundle messages", () => {
      const content = "{{TICKET_EVENT_LIST}}";
      const context = determineCommunicationPlaceholderContext(content);
      const definition = getDef("{{TICKET_EVENT_LIST}}");
      const placeholders = visibleCommunicationPlaceholders(
        audience(["Ticket Buyers"]),
        "Email",
        context,
        content,
      );

      expect(context).toBe("bundle");
      expect(definition.description).toContain("date and time");
      expect(definition.description).toContain("address or event-location fallback");
      expect(placeholders.map(({ tag }) => tag)).toContain("{{TICKET_EVENT_LIST}}");
    });

    it("allows universal placeholders for any audience combination", () => {
      const recipientNameDef = getDef("{recipientName}");
      const orgNameDef = getDef("{organizationName}");

      expect(isPlaceholderCompatibleWithAudience(recipientNameDef, ["Members"])).toBe(true);
      expect(isPlaceholderCompatibleWithAudience(recipientNameDef, ["Contacts"])).toBe(true);
      expect(isPlaceholderCompatibleWithAudience(recipientNameDef, ["Ticket Buyers"])).toBe(true);
      expect(isPlaceholderCompatibleWithAudience(recipientNameDef, ["Donors"])).toBe(true);
      expect(
        isPlaceholderCompatibleWithAudience(recipientNameDef, [
          "Members",
          "Contacts",
          "Ticket Buyers",
          "Donors",
        ]),
      ).toBe(true);

      expect(isPlaceholderCompatibleWithAudience(orgNameDef, ["Members", "Ticket Buyers"])).toBe(
        true,
      );
    });

    it("recognizes legacy recipient tokens as the canonical recipient placeholder", () => {
      const recipientNameDef = getDef("{recipientName}");
      for (const token of [
        "{singerName}",
        "{{singerName}}",
        "{buyerName}",
        "{{buyerName}}",
        "{{recipientName}}",
      ]) {
        expect(findCommunicationPlaceholderDefinition(token)).toEqual(recipientNameDef);
      }
      expect(
        extractCommunicationPlaceholders(
          "Hi {recipientName}, {singerName}, {{singerName}}, {buyerName}, and {{buyerName}}",
        ),
      ).toEqual([
        "{recipientName}",
        "{singerName}",
        "{{singerName}}",
        "{buyerName}",
        "{{buyerName}}",
      ]);
    });
  });

  describe("channel compatibility", () => {
    it("validates channel restrictions for email-only placeholders", () => {
      const rsvpDef = getDef("{{RSVP_LINKS}}");
      expect(isPlaceholderCompatibleWithChannel(rsvpDef, "Email")).toBe(true);
      expect(isPlaceholderCompatibleWithChannel(rsvpDef, "SMS")).toBe(false);
      expect(isPlaceholderCompatibleWithChannel(rsvpDef, "Both")).toBe(false);
    });

    it("allows universal placeholders on all channels", () => {
      const recipientNameDef = getDef("{recipientName}");
      expect(isPlaceholderCompatibleWithChannel(recipientNameDef, "Email")).toBe(true);
      expect(isPlaceholderCompatibleWithChannel(recipientNameDef, "SMS")).toBe(true);
      expect(isPlaceholderCompatibleWithChannel(recipientNameDef, "Both")).toBe(true);
    });
  });

  describe("visibleCommunicationPlaceholders", () => {
    it("shows one canonical recipient token for each audience and mixed audiences", () => {
      for (const targetAudiences of [
        ["Members"],
        ["Contacts"],
        ["Ticket Buyers"],
        ["Donors"],
        ["Members", "Ticket Buyers", "Donors"],
      ]) {
        const recipientTags = visibleCommunicationPlaceholders(
          audience(targetAudiences),
          "Email",
          "standard",
        )
          .filter(({ category }) => category === "Recipient")
          .map(({ tag }) => tag);
        expect(recipientTags).toEqual(["{recipientName}"]);
      }
    });

    it("returns RSVP and player links for Members with an event on Email", () => {
      const placeholders = visibleCommunicationPlaceholders(
        audience(["Members"], "event-123"),
        "Email",
        "standard",
      );
      const tags = placeholders.map((p) => p.tag);
      expect(tags).toContain("{{RSVP_LINKS}}");
      expect(tags).toContain("{{PLAYER_LINK}}");
      expect(tags).toContain("{eventTitle}");
      expect(tags).toContain("{eventDate}");
      expect(tags).not.toContain("{{TICKET_LINK}}");
    });

    it("excludes RSVP and player links when event is missing", () => {
      const placeholders = visibleCommunicationPlaceholders(
        audience(["Members"], null),
        "Email",
        "standard",
      );
      const tags = placeholders.map((p) => p.tag);
      expect(tags).not.toContain("{{RSVP_LINKS}}");
      expect(tags).not.toContain("{{PLAYER_LINK}}");
      expect(tags).not.toContain("{eventTitle}");
      expect(tags).toContain("{recipientName}");
      expect(tags).not.toContain("{singerName}");
      expect(tags).not.toContain("{buyerName}");
      expect(tags).toContain("{organizationName}");
    });

    it("excludes RSVP when Ticket Buyers are included in mixed audience", () => {
      const placeholders = visibleCommunicationPlaceholders(
        audience(["Members", "Ticket Buyers"], "event-123"),
        "Email",
        "standard",
      );
      const tags = placeholders.map((p) => p.tag);
      expect(tags).not.toContain("{{RSVP_LINKS}}");
      expect(tags).not.toContain("{{PLAYER_LINK}}");
      expect(tags).toContain("{eventTitle}");
      expect(tags).toContain("{eventDate}");
      expect(tags).not.toContain("{{TICKET_LINK}}");
    });
  });

  describe("validateCommunicationContext", () => {
    it("returns no issues for valid message with Members, event, and RSVP", () => {
      const issues = validateCommunicationContext({
        audience: audience(["Members"], "event-123"),
        channel: "Email",
        contentMarkdown: "Please RSVP: {{RSVP_LINKS}} for {eventTitle}",
        subject: "Rehearsal notice",
      });
      expect(issues).toHaveLength(0);
    });

    it("returns no issues for legacy recipient aliases with buyer and donor audiences", () => {
      const issues = validateCommunicationContext({
        audience: audience(["Ticket Buyers", "Donors"]),
        channel: "Email",
        contentMarkdown: "Hello {{singerName}} and {buyerName}.",
        subject: "Hello {singerName}",
      });
      expect(issues).toEqual([]);
    });

    it("returns incompatible_audience issue when mixed audience contains RSVP", () => {
      const issues = validateCommunicationContext({
        audience: audience(["Members", "Ticket Buyers"], "event-123"),
        channel: "Email",
        contentMarkdown: "Please RSVP: {{RSVP_LINKS}}",
        subject: "Notice",
      });
      expect(issues).toHaveLength(1);
      const firstIssue = issues[0];
      expect(firstIssue).toBeDefined();
      expect(firstIssue?.code).toBe("incompatible_audience");
      expect(firstIssue?.placeholder).toBe("{{RSVP_LINKS}}");
      expect(firstIssue?.message).toContain("Ticket Buyers");
    });

    it("returns event_required issue when event is removed after inserting event placeholder", () => {
      const issues = validateCommunicationContext({
        audience: audience(["Members"], null),
        channel: "Email",
        contentMarkdown: "Please RSVP: {{RSVP_LINKS}} for {eventTitle}",
        subject: "Notice",
      });
      expect(issues).toHaveLength(2);
      expect(issues.map((i) => i.code)).toEqual(["event_required", "event_required"]);
    });

    it("returns incompatible_channel issue when channel changed to SMS for email-only placeholder", () => {
      const issues = validateCommunicationContext({
        audience: audience(["Members"], "event-123"),
        channel: "SMS",
        contentMarkdown: "Please RSVP: {{RSVP_LINKS}}",
        subject: "Notice",
      });
      expect(issues).toHaveLength(1);
      const firstIssue = issues[0];
      expect(firstIssue).toBeDefined();
      expect(firstIssue?.code).toBe("incompatible_channel");
    });
  });

  describe("templateMatchesCommunicationContext", () => {
    it("matches template with RSVP for Members + Email + event", () => {
      const template = {
        channel: "Email" as const,
        contentMarkdown: "Hi {recipientName}, please RSVP: {{RSVP_LINKS}}",
        subject: "RSVP for {eventTitle}",
        title: "Rehearsal RSVP",
      };
      expect(
        templateMatchesCommunicationContext(template, audience(["Members"], "event-123"), "Email"),
      ).toBe(true);
      expect(
        templateMatchesCommunicationContext(
          template,
          audience(["Members", "Ticket Buyers"], "event-123"),
          "Email",
        ),
      ).toBe(false);
      expect(
        templateMatchesCommunicationContext(template, audience(["Members"], null), "Email"),
      ).toBe(false);
      expect(
        templateMatchesCommunicationContext(template, audience(["Members"], "event-123"), "SMS"),
      ).toBe(false);
    });

    it("matches saved templates that use either legacy recipient alias", () => {
      for (const token of [
        "{singerName}",
        "{{singerName}}",
        "{buyerName}",
        "{{buyerName}}",
      ] as const) {
        const template = {
          channel: "Email" as const,
          contentMarkdown: `Hello ${token}`,
          subject: "General announcement",
          title: "General Announcement",
        };
        expect(
          templateMatchesCommunicationContext(
            template,
            audience(["Members", "Ticket Buyers", "Donors"]),
            "Email",
          ),
        ).toBe(true);
      }
    });

    it("matches universal template for mixed audiences", () => {
      const template = {
        channel: "Email" as const,
        contentMarkdown: "Hi {singerName}, message from {organizationName}",
        subject: "General announcement",
        title: "General Announcement",
      };
      expect(
        templateMatchesCommunicationContext(
          template,
          audience(["Members", "Ticket Buyers"]),
          "Email",
        ),
      ).toBe(true);
    });
  });

  describe("removeCommunicationPlaceholder", () => {
    it("cleanly removes a placeholder from content", () => {
      const text = "Hello {recipientName},\n\nPlease RSVP: {{RSVP_LINKS}}\n\nThank you!";
      expect(removeCommunicationPlaceholder(text, "{{RSVP_LINKS}}")).toBe(
        "Hello {recipientName},\n\nPlease RSVP:\n\nThank you!",
      );
    });

    it("removes the exact legacy alias found in message content", () => {
      const text = "Hello {{singerName}}\n\nThank you {buyerName}!";
      const token = extractCommunicationPlaceholders(text).find((tag) => tag.startsWith("{{"));
      expect(token).toBe("{{singerName}}");
      expect(removeCommunicationPlaceholder(text, token ?? "")).toBe(
        "Hello\n\nThank you {buyerName}!",
      );
    });
  });
});
