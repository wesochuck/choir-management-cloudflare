import { describe, expect, it } from "vitest";

import {
  deriveContactDisplayName,
  deriveDisplayName,
  hasAcceptableContactIdentity,
  mergeContactCommunicationPreferenceStatus,
  mergeContactCommunicationStatus,
  mergeContactConsentStatus,
  normalizeContactEmail,
  normalizeContactPhone,
  normalizeEmail,
  normalizePhone,
} from "@choir/domain";

describe("Contact normalization", () => {
  it("normalizes email for matching while leaving display values to callers", () => {
    expect(normalizeEmail("  Jane@Example.COM  ")).toBe("jane@example.com");
    expect(normalizeContactEmail(" ")).toBe("");
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });

  it("normalizes common phone formats to E.164 deterministically", () => {
    expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
    expect(normalizeContactPhone("555-123-4567")).toBe("+15551234567");
    expect(normalizePhone("0044 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("not a phone")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
  });

  it("derives a display name without requiring first and last names", () => {
    expect(deriveDisplayName({ displayName: "  Choir Friends  " })).toBe("Choir Friends");
    expect(deriveDisplayName({ firstName: " Jane ", lastName: " Smith " })).toBe("Jane Smith");
    expect(deriveContactDisplayName({ firstName: "Jane" })).toBe("Jane");
    expect(deriveDisplayName({ email: "  jane@example.com  " })).toBe("jane@example.com");
    expect(deriveDisplayName("Jane", "Smith")).toBe("Jane Smith");
    expect(deriveDisplayName({})).toBe("");
  });

  it("recognizes any useful name, method, or linked profile as contact identity", () => {
    expect(hasAcceptableContactIdentity({ displayName: "Known name" })).toBe(true);
    expect(hasAcceptableContactIdentity({ email: "jane@example.com" })).toBe(true);
    expect(hasAcceptableContactIdentity({ phone: "+15551234567" })).toBe(true);
    expect(
      hasAcceptableContactIdentity({ profileId: "11111111-1111-4111-8111-111111111111" }),
    ).toBe(true);
    expect(
      hasAcceptableContactIdentity({ displayName: "   ", email: null, phone: undefined }),
    ).toBe(false);
    expect(hasAcceptableContactIdentity(null)).toBe(false);
  });
});

describe("Contact communication consent", () => {
  it("preserves unsubscribed and suppressed statuses against imported subscriptions", () => {
    expect(mergeContactCommunicationStatus("unsubscribed", "subscribed")).toBe("unsubscribed");
    expect(mergeContactCommunicationPreferenceStatus("suppressed", "subscribed")).toBe(
      "suppressed",
    );
    expect(mergeContactConsentStatus("subscribed", "unsubscribed")).toBe("unsubscribed");
  });

  it("does not let blank or unknown imports erase stronger existing consent", () => {
    for (const imported of ["", "   ", "unknown", null, undefined]) {
      expect(mergeContactCommunicationStatus("subscribed", imported)).toBe("subscribed");
      expect(mergeContactCommunicationStatus("unsubscribed", imported)).toBe("unsubscribed");
      expect(mergeContactCommunicationStatus("suppressed", imported)).toBe("suppressed");
    }
  });

  it("promotes only meaningful incoming statuses", () => {
    expect(mergeContactCommunicationStatus(undefined, "unknown")).toBe("unknown");
    expect(mergeContactCommunicationStatus("unknown", "subscribed")).toBe("subscribed");
    expect(mergeContactCommunicationStatus("unknown", "unsubscribed")).toBe("unsubscribed");
    expect(mergeContactCommunicationStatus("subscribed", "unknown")).toBe("subscribed");
    expect(mergeContactCommunicationStatus("unknown", "not-a-status")).toBe("unknown");
  });
});
