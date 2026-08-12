import { describe, expect, it } from "vitest";

import {
  activeVersionId,
  assertEmailFeedbackSubscription,
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

  it("redacts email addresses and secret-like values from captured failures", () => {
    expect(sanitizeExternalOutput("user@example.com token=abc123")).toBe(
      "[redacted-email] token=[redacted]",
    );
  });
});
