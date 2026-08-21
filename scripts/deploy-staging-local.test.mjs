import { describe, expect, it } from "vitest";

import {
  activeVersionId,
  assertEmailFeedbackSubscription,
  assertEmailSendingEnabled,
  assertReleaseCheckout,
  sanitizeExternalOutput,
  uploadedVersionId,
} from "./deploy-staging-local.mjs";

describe("local staging deployment safeguards", () => {
  it("requires a clean main checkout synchronized with origin", () => {
    const valid = {
      branch: "main",
      status: "",
      head: "a".repeat(40),
      originMain: "a".repeat(40),
    };
    expect(() => assertReleaseCheckout(valid)).not.toThrow();
    expect(() => assertReleaseCheckout({ ...valid, branch: "feature" })).toThrow(/main branch/u);
    expect(() => assertReleaseCheckout({ ...valid, status: " M package.json" })).toThrow(
      /clean working tree/u,
    );
    expect(() => assertReleaseCheckout({ ...valid, originMain: "b".repeat(40) })).toThrow(
      /origin\/main/u,
    );
  });

  it("accepts only the complete staging email feedback subscription", () => {
    const subscription = {
      name: "staging-email-feedback",
      enabled: true,
      source: { type: "email.sending", domain: "mail.staging.musicsite.org" },
      destination: { type: "queues.queue" },
      events: [
        "message.delivered",
        "message.deferred",
        "message.bounced",
        "message.failed",
        "message.rejected",
        "message.complained",
      ],
    };
    expect(() => assertEmailFeedbackSubscription([subscription])).not.toThrow();
    expect(() =>
      assertEmailFeedbackSubscription([{ ...subscription, events: ["message.delivered"] }]),
    ).toThrow(/missing or incomplete/u);
  });

  it("extracts active and uploaded Worker version IDs", () => {
    expect(activeVersionId({ versions: [{ version_id: "active-version", percentage: 100 }] })).toBe(
      "active-version",
    );
    expect(uploadedVersionId('{"type":"version-upload","version_id":"new-version"}\n')).toBe(
      "new-version",
    );
    expect(() => activeVersionId({ versions: [] })).toThrow(/100%/u);
    expect(() => uploadedVersionId("not json")).toThrow(/version ID/u);
  });

  it("accepts only verified and enabled email sending domains", () => {
    const tableOutput = `
┌───────────────┬────────────────────────────┬─────────┬──────────────────────────────────┐
│ zone          │ name                       │ enabled │ tag                              │
├───────────────┼────────────────────────────┼─────────┼──────────────────────────────────┤
│ musicsite.org │ mail.staging.musicsite.org │ yes     │ 672a6796460e4004886dd48c96715849 │
├───────────────┼────────────────────────────┼─────────┼──────────────────────────────────┤
│ musicsite.org │ mail.musicsite.org         │ yes     │ ddf97609ef204c588f9d1c3e2802e37c │
└───────────────┴────────────────────────────┴─────────┴──────────────────────────────────┘
`;
    expect(() =>
      assertEmailSendingEnabled(tableOutput, "mail.staging.musicsite.org"),
    ).not.toThrow();
    expect(() => assertEmailSendingEnabled(tableOutput, "mail.musicsite.org")).not.toThrow();
    expect(() => assertEmailSendingEnabled(tableOutput, "unverified.musicsite.org")).toThrow(
      /Email Sending is not enabled/u,
    );
  });

  it("redacts email addresses and secret-like values from captured failures", () => {
    expect(sanitizeExternalOutput("user@example.com token=abc123")).toBe(
      "[redacted-email] token=[redacted]",
    );
  });
});
