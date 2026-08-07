import { describe, expect, it } from "vitest";

import { parseCloudflareEmailEvent } from "./emailFeedback";

const baseEvent = {
  metadata: { eventTimestamp: "2026-08-06T12:00:00.000Z" },
  payload: {
    eventId: "0190d0c4-7e9b-7714-9004-11f0b6d9a341",
    messageId: "0101018f7d0c4d9a-msg-test",
    recipient: "Recipient@example.test",
    sender: "auth@mail.staging.musicsite.org",
    subject: "Test message",
    terminal: true,
  },
  source: { domain: "mail.staging.musicsite.org", type: "email.sending" },
};

describe("Cloudflare email provider events", () => {
  it.each([
    ["delivered", "delivered"],
    ["deferred", "deferred"],
    ["bounced", "bounced"],
    ["failed", "failed"],
    ["rejected", "rejected"],
    ["complained", "complained"],
  ] as const)("normalizes message.%s events", (eventType, expectedStatus) => {
    const parsed = parseCloudflareEmailEvent({
      ...baseEvent,
      payload: {
        ...baseEvent.payload,
        delivery: { status: expectedStatus },
        terminal: eventType !== "deferred",
      },
      type: `cf.email.sending.message.${eventType}`,
    });
    expect(parsed).toMatchObject({
      eventType: expectedStatus,
      recipient: "recipient@example.test",
      sourceDomain: "mail.staging.musicsite.org",
      terminal: eventType !== "deferred",
    });
  });

  it("retains hard-bounce metadata and bounds provider reason fields", () => {
    const parsed = parseCloudflareEmailEvent({
      ...baseEvent,
      payload: {
        ...baseEvent.payload,
        bounce: { reason: "550 5.1.1 User unknown", type: "hard" },
        delivery: {
          smtpEnhancedStatusCode: "5.1.1",
          smtpResponse: "550 5.1.1 User unknown",
          smtpStatusCode: "550",
          status: "bounced",
        },
      },
      type: "cf.email.sending.message.bounced",
    });
    expect(parsed).toMatchObject({
      bounceType: "hard",
      eventType: "bounced",
      reason: "550 5.1.1 User unknown",
      smtpEnhancedStatusCode: "5.1.1",
      smtpStatusCode: "550",
    });
  });

  it("retains recipient-scoped rejection context for suppression policy", () => {
    const parsed = parseCloudflareEmailEvent({
      ...baseEvent,
      payload: {
        ...baseEvent.payload,
        delivery: { status: "rejected" },
        rejection: { party: "recipient", reason: "policy" },
      },
      type: "cf.email.sending.message.rejected",
    });
    expect(parsed.reason).toContain("rejection_party=recipient");
  });

  it("rejects non-Email-Sending envelopes and missing required identifiers", () => {
    expect(() =>
      parseCloudflareEmailEvent({ ...baseEvent, type: "cf.email.routing.forwarded" }),
    ).toThrow("Cloudflare email event payload was invalid");
    expect(() =>
      parseCloudflareEmailEvent({
        ...baseEvent,
        payload: { ...baseEvent.payload, messageId: "" },
        type: "cf.email.sending.message.delivered",
      }),
    ).toThrow("Cloudflare email event payload was invalid");
  });

  it("rejects invalid timestamps, unapproved sending domains, and inconsistent status fields", () => {
    expect(() =>
      parseCloudflareEmailEvent(
        {
          ...baseEvent,
          metadata: { eventTimestamp: "not-a-date" },
          type: "cf.email.sending.message.delivered",
        },
        "mail.staging.musicsite.org",
      ),
    ).toThrow("timestamp was invalid");
    expect(() =>
      parseCloudflareEmailEvent(
        { ...baseEvent, type: "cf.email.sending.message.delivered" },
        "mail.production.musicsite.org",
      ),
    ).toThrow("source domain");
    expect(() =>
      parseCloudflareEmailEvent({
        ...baseEvent,
        payload: {
          ...baseEvent.payload,
          delivery: { status: "bounced" },
          terminal: true,
        },
        type: "cf.email.sending.message.delivered",
      }),
    ).toThrow("status did not match");
  });

  it("rejects a deferred event marked terminal", () => {
    expect(() =>
      parseCloudflareEmailEvent({
        ...baseEvent,
        payload: {
          ...baseEvent.payload,
          delivery: { status: "deferred" },
          terminal: true,
        },
        type: "cf.email.sending.message.deferred",
      }),
    ).toThrow("terminal flag");
  });
});
