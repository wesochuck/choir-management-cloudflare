import { describe, expect, it } from "vitest";

import {
  issuePromotionReviewSnapshot,
  verifyPromotionReviewSnapshot,
  type PromotionReviewSnapshotInput,
} from "./promotionReviewSnapshot";

const input: PromotionReviewSnapshotInput = {
  audience: { targetAudiences: ["Ticket Buyers"], excludeTicketBuyersForEventId: "event-id" },
  contentMarkdown: "Invitation body",
  draftRevision: 4,
  eventId: "123e4567-e89b-42d3-a456-426614174000",
  messageId: "123e4567-e89b-42d3-a456-426614174001",
  organizationId: "organization-id",
  recipients: [
    {
      email: "buyer@example.test",
      profileId: "123e4567-e89b-42d3-a456-426614174002",
      subject: { kind: "profile", profileId: "123e4567-e89b-42d3-a456-426614174002" },
    },
  ],
  subject: "Tickets are available",
};

describe("event promotion review snapshots", () => {
  it("binds confirmation to the audience, recipients, message, and saved revision", async () => {
    const token = await issuePromotionReviewSnapshot(
      "a-secret-that-is-long-enough-for-tests",
      input,
      1_000,
    );

    await expect(
      verifyPromotionReviewSnapshot("a-secret-that-is-long-enough-for-tests", token, input, 2_000),
    ).resolves.toBe("valid");
    await expect(
      verifyPromotionReviewSnapshot(
        "a-secret-that-is-long-enough-for-tests",
        token,
        {
          ...input,
          recipients: [],
        },
        2_000,
      ),
    ).resolves.toBe("stale");
  });

  it("binds a generic campaign review to its channel and SMS destination", async () => {
    const generic = {
      ...input,
      eventId: null,
      channel: "SMS",
      recipients: input.recipients.map((recipient) => ({ ...recipient, phone: "+15551234567" })),
    };
    const token = await issuePromotionReviewSnapshot(
      "a-secret-that-is-long-enough-for-tests",
      generic,
      1_000,
    );
    await expect(
      verifyPromotionReviewSnapshot(
        "a-secret-that-is-long-enough-for-tests",
        token,
        generic,
        2_000,
      ),
    ).resolves.toBe("valid");
    await expect(
      verifyPromotionReviewSnapshot(
        "a-secret-that-is-long-enough-for-tests",
        token,
        { ...generic, channel: "Email" },
        2_000,
      ),
    ).resolves.toBe("stale");
    await expect(
      verifyPromotionReviewSnapshot(
        "a-secret-that-is-long-enough-for-tests",
        token,
        {
          ...generic,
          recipients: generic.recipients.map((recipient) => ({
            ...recipient,
            phone: "+15557654321",
          })),
        },
        2_000,
      ),
    ).resolves.toBe("stale");
  });

  it("expires review confirmation and rejects a token signed for another secret", async () => {
    const token = await issuePromotionReviewSnapshot(
      "a-secret-that-is-long-enough-for-tests",
      input,
      1_000,
    );

    await expect(
      verifyPromotionReviewSnapshot(
        "a-secret-that-is-long-enough-for-tests",
        token,
        input,
        302_000,
      ),
    ).resolves.toBe("expired");
    await expect(
      verifyPromotionReviewSnapshot("a-different-secret", token, input, 2_000),
    ).resolves.toBe("invalid");
  });
});
