import { describe, expect, it } from "vitest";

import { organizationInvitationDetailsSchema } from "./auth";
import {
  createRosterInviteLinkRequestSchema,
  rosterInviteLinkSummarySchema,
  rosterInvitePreviewResponseSchema,
  rosterInviteOptionsResponseSchema,
  rosterInviteRedeemRequestSchema,
} from "./rosterInvites";

describe("Roster invite contracts", () => {
  it("validates create link request schema with defaults", () => {
    const parsed = createRosterInviteLinkRequestSchema.parse({
      label: "September 2026 Singers",
    });
    expect(parsed).toEqual({
      expiresInDays: 7,
      label: "September 2026 Singers",
      maxUses: undefined,
    });

    expect(() =>
      createRosterInviteLinkRequestSchema.parse({
        expiresInDays: 14,
        label: "Invalid expiry",
      }),
    ).toThrow();

    expect(() =>
      createRosterInviteLinkRequestSchema.parse({
        label: "",
      }),
    ).toThrow();
  });

  it("validates roster invite link summary schema", () => {
    const link = {
      activeReservations: 0,
      committedUses: 3,
      createdAt: new Date().toISOString(),
      createdByUserId: "user-admin-1",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      id: "link-123",
      label: "Sopranos",
      maxUses: 10,
      organizationId: "org-alpha-123",
      revokedAt: null,
      status: "active" as const,
    };
    expect(rosterInviteLinkSummarySchema.parse(link)).toEqual(link);
  });

  it("validates preview response schema", () => {
    const preview = {
      expiresAt: new Date().toISOString(),
      logoFileId: null,
      organizationName: "Test Chorus",
      organizationSlug: "test-chorus",
      requestId: "11111111-1111-4111-8111-111111111111",
    };
    expect(rosterInvitePreviewResponseSchema.parse(preview)).toEqual(preview);
  });

  it("defaults optional match fields for clients during Worker version rollout", () => {
    const options = rosterInviteOptionsResponseSchema.parse({
      alreadyEnrolled: false,
      existingProfile: null,
      organizationName: "Test Chorus",
      performerLabel: "Voice Part",
      requestId: "11111111-1111-4111-8111-111111111111",
      rosterStructure: "sections_with_parts",
      sections: [],
      voiceParts: [],
    });
    expect(options).toMatchObject({ matchingProfile: null, profileMatchStatus: "no_match" });

    expect(
      rosterInviteOptionsResponseSchema.parse({
        ...options,
        matchingProfile: { displayName: "Existing Singer", voicePart: "" },
        profileMatchStatus: "matched",
      }),
    ).toMatchObject({
      matchingProfile: { displayName: "Existing Singer", voicePart: "" },
      profileMatchStatus: "matched",
    });
  });

  it("defaults missing invitation match status to the existing no-match experience", () => {
    const invitation = organizationInvitationDetailsSchema.parse({
      email: "singer@example.test",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      id: "invitation-1",
      inviterEmail: "manager@example.test",
      organizationId: "organization-alpha",
      organizationName: "Test Chorus",
      organizationSlug: "test-chorus",
      role: "member",
      status: "pending",
    });
    expect(invitation.profileMatchStatus).toBe("no_match");
  });

  it("validates and trims redeem request schema", () => {
    const redeem = {
      displayName: "  Alice Singer  ",
      idempotencyKey: "idem-key-1",
      phone: " (555) 123-4567 ",
      showInDirectory: true,
      token: "valid-token-at-least-16-chars-long",
      voicePart: " Soprano 1 ",
    };
    const parsed = rosterInviteRedeemRequestSchema.parse(redeem);
    expect(parsed).toEqual({
      displayName: "Alice Singer",
      idempotencyKey: "idem-key-1",
      phone: "(555) 123-4567",
      showInDirectory: true,
      token: "valid-token-at-least-16-chars-long",
      voicePart: "Soprano 1",
    });
  });
});
