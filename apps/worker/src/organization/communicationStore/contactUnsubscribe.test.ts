import { describe, expect, it } from "vitest";

import { parseUnsubscribeSubject } from "../organizationCommunications";
import {
  issueSignedLink,
  verifySignedLink,
  verifySignedLinkScope,
  type SignedLinkEnvelope,
} from "../../security/signedLinks";

const SECRET = "phase-7-contact-unsubscribe-test-secret-with-enough-length";
const ORG_A = "organization-alpha";
const ORG_B = "organization-bravo";
const CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";

// Deterministic clock values (unix seconds): issued at T, valid for one hour.
const ISSUED_AT = 1_700_000_000;
const EXPIRES_AT = ISSUED_AT + 3_600;
const WHILE_VALID = new Date((ISSUED_AT + 60) * 1_000);
const AFTER_EXPIRY = new Date((EXPIRES_AT + 60) * 1_000);
const BEFORE_ISSUE = new Date((ISSUED_AT - 60) * 1_000);

function contactEnvelope(overrides: Partial<SignedLinkEnvelope> = {}): SignedLinkEnvelope {
  return {
    algorithm: "HS256",
    expiresAt: EXPIRES_AT,
    issuedAt: ISSUED_AT,
    organizationId: ORG_A,
    purpose: "unsubscribe",
    resourceId: "contact",
    revocation: "email-v1",
    subjectId: CONTACT_ID,
    version: 1,
    ...overrides,
  };
}

describe("parseUnsubscribeSubject", () => {
  it("resolves typed contact and profile subjects", () => {
    expect(parseUnsubscribeSubject({ resourceId: "contact", subjectId: CONTACT_ID })).toEqual({
      contactId: CONTACT_ID,
      kind: "contact",
    });
    expect(parseUnsubscribeSubject({ resourceId: "profile", subjectId: PROFILE_ID })).toEqual({
      kind: "profile",
      profileId: PROFILE_ID,
    });
  });

  it("treats legacy tokens without a subject kind as profiles", () => {
    expect(parseUnsubscribeSubject({ subjectId: PROFILE_ID })).toEqual({
      kind: "profile",
      profileId: PROFILE_ID,
    });
  });

  it("rejects commerce kinds, unknown kinds, and missing subjects without touching storage", () => {
    // Ticket Buyer / Donor transaction IDs must never verify as unsubscribe
    // subjects; Phase 8/9 resolves them through Contacts instead.
    expect(
      parseUnsubscribeSubject({ resourceId: "ticket_purchase", subjectId: CONTACT_ID }),
    ).toBeNull();
    expect(parseUnsubscribeSubject({ resourceId: "donation", subjectId: CONTACT_ID })).toBeNull();
    expect(parseUnsubscribeSubject({ resourceId: "member", subjectId: CONTACT_ID })).toBeNull();
    expect(parseUnsubscribeSubject({ resourceId: "contact" })).toBeNull();
    expect(parseUnsubscribeSubject({ resourceId: "contact", subjectId: "" })).toBeNull();
    expect(parseUnsubscribeSubject({})).toBeNull();
  });
});

describe("contact unsubscribe signed links", () => {
  it("verifies a valid contact token for its Organization and purpose", async () => {
    const token = await issueSignedLink(SECRET, contactEnvelope());
    const envelope = await verifySignedLinkScope(SECRET, token, {
      expectedOrganizationId: ORG_A,
      expectedPurpose: "unsubscribe",
      now: WHILE_VALID,
    });
    expect(envelope).toMatchObject({
      organizationId: ORG_A,
      purpose: "unsubscribe",
      resourceId: "contact",
      revocation: "email-v1",
      subjectId: CONTACT_ID,
    });
    expect(parseUnsubscribeSubject(envelope ?? {})).toEqual({
      contactId: CONTACT_ID,
      kind: "contact",
    });
  });

  it("rejects expired and not-yet-valid contact tokens", async () => {
    const token = await issueSignedLink(SECRET, contactEnvelope());
    await expect(
      verifySignedLinkScope(SECRET, token, {
        expectedOrganizationId: ORG_A,
        expectedPurpose: "unsubscribe",
        now: AFTER_EXPIRY,
      }),
    ).resolves.toBeNull();
    await expect(
      verifySignedLinkScope(SECRET, token, {
        expectedOrganizationId: ORG_A,
        expectedPurpose: "unsubscribe",
        now: BEFORE_ISSUE,
      }),
    ).resolves.toBeNull();
  });

  it("rejects tampered tokens, including a modified contact ID", async () => {
    const token = await issueSignedLink(SECRET, contactEnvelope());
    const tamperedSignature = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    const scope = {
      expectedOrganizationId: ORG_A,
      expectedPurpose: "unsubscribe" as const,
      now: WHILE_VALID,
    };
    // Any byte change (flipped signature tail stands in for a modified
    // contact ID inside the signed envelope) fails constant-time verification.
    await expect(verifySignedLinkScope(SECRET, tamperedSignature, scope)).resolves.toBeNull();
    await expect(verifySignedLinkScope(SECRET, token.slice(0, -10), scope)).resolves.toBeNull();
  });

  it("rejects an Organization A contact token replayed on Organization B", async () => {
    const token = await issueSignedLink(SECRET, contactEnvelope());
    await expect(
      verifySignedLinkScope(SECRET, token, {
        expectedOrganizationId: ORG_B,
        expectedPurpose: "unsubscribe",
        now: WHILE_VALID,
      }),
    ).resolves.toBeNull();
  });

  it("never confuses contact tokens with profile subjects", async () => {
    const token = await issueSignedLink(SECRET, contactEnvelope());
    // Strict profile verification does not accept a contact token: no fake-ID
    // bolt-on where a contact ID is treated as a profile ID.
    await expect(
      verifySignedLink(SECRET, token, {
        expectedOrganizationId: ORG_A,
        expectedPurpose: "unsubscribe",
        expectedResourceId: "profile",
        expectedRevocation: "email-v1",
        expectedSubjectId: CONTACT_ID,
        now: WHILE_VALID,
      }),
    ).resolves.toBeNull();
    // And a token minted for another purpose never verifies as unsubscribe.
    const rsvpToken = await issueSignedLink(
      SECRET,
      contactEnvelope({ purpose: "rsvp", resourceId: "event-alpha" }),
    );
    await expect(
      verifySignedLinkScope(SECRET, rsvpToken, {
        expectedOrganizationId: ORG_A,
        expectedPurpose: "unsubscribe",
        now: WHILE_VALID,
      }),
    ).resolves.toBeNull();
  });
});
