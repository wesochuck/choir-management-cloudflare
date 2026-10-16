import { describe, expect, it } from "vitest";
import { renderCommunicationTemplate } from "@choir/domain";
import {
  ticketMessageTemplates,
  withDefaultTicketDoorsOpenTime,
} from "../../organization/ticketMessageTemplates";
import { ticketNotificationJobSchema } from "./shared";

const notification = {
  amountPaidCents: 1500,
  bundleTitle: null,
  buyerName: "Ticket Buyer",
  contentMarkdown: "Confirmation",
  currency: "usd",
  destination: "buyer@example.test",
  eventStartsAt: "2027-05-02T01:00:00Z",
  eventTitle: "Concert",
  id: "11111111-1111-4111-8111-111111111111",
  kind: "confirmation",
  providerEventAt: null,
  providerMessageId: null,
  providerReason: "",
  providerStatus: null,
  purchaseId: "22222222-2222-4222-8222-222222222222",
  quantity: 1,
  refundDate: null,
  status: "queued",
  subject: "Tickets confirmed",
  timezone: "America/New_York",
};

describe("optional ticket doors-open details", () => {
  it.each(["confirmation", "reminder"] as const)(
    "adds optional details to the default %s without changing custom templates",
    (kind) => {
      const template = ticketMessageTemplates.find((entry) => entry.kind === kind);
      if (!template) throw new Error("Missing default template");
      const rendered = renderCommunicationTemplate(
        withDefaultTicketDoorsOpenTime(template.contentMarkdown, kind, "18:30"),
        "Buyer",
        { eventDate: "Concert date" },
      );
      expect(rendered).toContain("**Date:** Concert date\n- **Doors open:** 18:30");
      expect(withDefaultTicketDoorsOpenTime(template.contentMarkdown, kind, "")).toBe(
        template.contentMarkdown,
      );
      const custom = `${template.contentMarkdown}\nCustom admission instructions`;
      expect(withDefaultTicketDoorsOpenTime(custom, kind, "18:30")).toBe(custom);
    },
  );

  it.each(["18:30", "", null, undefined])(
    "accepts optional doors-open fields across notification payloads: %s",
    (doorsOpenTime) => {
      const result = ticketNotificationJobSchema.parse({
        ...notification,
        doorsOpenTime,
        bundleEvents: [{ doorsOpenTime, startsAt: notification.eventStartsAt, title: "Concert" }],
      });
      expect(result.doorsOpenTime).toBe(doorsOpenTime ?? "");
      expect(result.bundleEvents[0]?.doorsOpenTime).toBe(doorsOpenTime ?? "");
    },
  );

  it("defaults omitted fields for jobs from the preceding Worker and rejects invalid times", () => {
    expect(ticketNotificationJobSchema.parse(notification).doorsOpenTime).toBe("");
    expect(
      ticketNotificationJobSchema.parse({
        ...notification,
        bundleEvents: [{ startsAt: notification.eventStartsAt, title: "Concert" }],
      }).bundleEvents[0]?.doorsOpenTime,
    ).toBe("");
    expect(
      ticketNotificationJobSchema.safeParse({ ...notification, doorsOpenTime: "25:00" }).success,
    ).toBe(false);
    expect(
      ticketNotificationJobSchema.safeParse({
        ...notification,
        bundleEvents: [
          { startsAt: notification.eventStartsAt, title: "Concert", doorsOpenTime: "18:90" },
        ],
      }).success,
    ).toBe(false);
  });
});
