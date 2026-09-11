import { describe, expect, it } from "vitest";

import { issueSignedLink, verifySignedLink, type SignedLinkEnvelope } from "./signedLinks";

const secret = "unit-test-signed-link-secret-that-is-at-least-thirty-two-characters";
const envelope: SignedLinkEnvelope = {
  algorithm: "HS256",
  expiresAt: 2_000,
  issuedAt: 1_000,
  organizationId: "organization-alpha",
  purpose: "rsvp",
  resourceId: "event-alpha",
  revocation: "event-link-v1",
  subjectId: "profile-alpha",
  version: 1,
};

const validOptions = {
  expectedOrganizationId: "organization-alpha",
  expectedPurpose: "rsvp" as const,
  expectedResourceId: "event-alpha",
  expectedRevocation: "event-link-v1",
  expectedSubjectId: "profile-alpha",
  now: new Date(1_500_000),
};

describe("signed links", () => {
  it("verifies only the exact Organization, purpose, subject, resource, and revocation state", async () => {
    const token = await issueSignedLink(secret, envelope);

    await expect(verifySignedLink(secret, token, validOptions)).resolves.toEqual(envelope);
    await expect(
      verifySignedLink(secret, token, {
        ...validOptions,
        expectedOrganizationId: "organization-bravo",
      }),
    ).resolves.toBeNull();
    await expect(
      verifySignedLink(secret, token, { ...validOptions, expectedResourceId: "event-bravo" }),
    ).resolves.toBeNull();
    await expect(
      verifySignedLink(secret, token, { ...validOptions, expectedRevocation: "event-link-v2" }),
    ).resolves.toBeNull();
    await expect(
      verifySignedLink(secret, token, { ...validOptions, expectedPurpose: "poll" }),
    ).resolves.toBeNull();
  });

  it("rejects malformed, oversized, tampered, truncated, future, and expired values", async () => {
    const token = await issueSignedLink(secret, envelope);
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    const [payload = "", signature = ""] = token.split(".");
    const tamperedPayload = `${payload.startsWith("e") ? "f" : "e"}${payload.slice(1)}.${signature}`;
    const tamperedSignatureHead = `${payload}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;

    await expect(verifySignedLink(secret, "not-a-token", validOptions)).resolves.toBeNull();
    await expect(verifySignedLink(secret, "x".repeat(4097), validOptions)).resolves.toBeNull();
    await expect(verifySignedLink(secret, tampered, validOptions)).resolves.toBeNull();
    await expect(verifySignedLink(secret, tamperedPayload, validOptions)).resolves.toBeNull();
    await expect(verifySignedLink(secret, tamperedSignatureHead, validOptions)).resolves.toBeNull();
    await expect(verifySignedLink(secret, token.slice(0, -10), validOptions)).resolves.toBeNull();
    await expect(
      verifySignedLink(secret, token, { ...validOptions, now: new Date(999_000) }),
    ).resolves.toBeNull();
    await expect(
      verifySignedLink(secret, token, { ...validOptions, now: new Date(2_000_000) }),
    ).resolves.toBeNull();
  });

  it("issues and verifies roster_invite links correctly", async () => {
    const inviteEnvelope: SignedLinkEnvelope = {
      algorithm: "HS256",
      expiresAt: 2_000,
      issuedAt: 1_000,
      nonce: "random-nonce-at-least-16-chars",
      organizationId: "organization-alpha",
      purpose: "roster_invite",
      resourceId: "roster-invite-link-123",
      revocation: "v1",
      version: 1,
    };
    const token = await issueSignedLink(secret, inviteEnvelope);
    await expect(
      verifySignedLink(secret, token, {
        expectedOrganizationId: "organization-alpha",
        expectedPurpose: "roster_invite",
        expectedResourceId: "roster-invite-link-123",
        expectedRevocation: "v1",
        now: new Date(1_500_000),
      }),
    ).resolves.toEqual(inviteEnvelope);
  });
});
