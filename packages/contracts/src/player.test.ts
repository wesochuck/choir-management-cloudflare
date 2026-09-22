import { describe, expect, it } from "vitest";

import { playerPlaylistItemSchema, publicPlayerDetailsResponseSchema } from "./player";

describe("Player contracts null-matrix and validation", () => {
  describe("playerPlaylistItemSchema", () => {
    const validBase = {
      title: "Alleluia",
      trackFileIds: { soprano: "00000000-0000-4000-8000-000000000001" },
    };

    it("parses valid fully-populated item", () => {
      const parsed = playerPlaylistItemSchema.parse({
        ...validBase,
        arranger: "Shaw",
        composer: "Mozart",
        durationSeconds: 240,
        isFeaturedNumber: true,
        notes: "Solo",
        pieceId: "11111111-1111-4111-8111-111111111111",
      });
      expect(parsed.title).toBe("Alleluia");
      expect(parsed.arranger).toBe("Shaw");
      expect(parsed.durationSeconds).toBe(240);
    });

    it("parses item with all nullable fields set to null", () => {
      const parsed = playerPlaylistItemSchema.parse({
        ...validBase,
        arranger: null,
        composer: null,
        durationSeconds: null,
        isFeaturedNumber: null,
        notes: null,
        pieceId: null,
      });
      expect(parsed.arranger).toBeNull();
      expect(parsed.composer).toBeNull();
      expect(parsed.durationSeconds).toBeNull();
      expect(parsed.pieceId).toBeNull();
    });

    it("parses backward-compatible item with all optional fields omitted", () => {
      const parsed = playerPlaylistItemSchema.parse(validBase);
      expect(parsed.title).toBe("Alleluia");
      expect(parsed.arranger).toBeUndefined();
      expect(parsed.composer).toBeUndefined();
      expect(parsed.durationSeconds).toBeUndefined();
    });

    it("rejects wrong types for nullable fields", () => {
      expect(playerPlaylistItemSchema.safeParse({ ...validBase, arranger: 123 }).success).toBe(
        false,
      );
      expect(playerPlaylistItemSchema.safeParse({ ...validBase, composer: 456 }).success).toBe(
        false,
      );
      expect(
        playerPlaylistItemSchema.safeParse({ ...validBase, durationSeconds: "120" }).success,
      ).toBe(false);
      expect(
        playerPlaylistItemSchema.safeParse({ ...validBase, durationSeconds: -5 }).success,
      ).toBe(false);
      expect(
        playerPlaylistItemSchema.safeParse({ ...validBase, isFeaturedNumber: "true" }).success,
      ).toBe(false);
      expect(
        playerPlaylistItemSchema.safeParse({ ...validBase, pieceId: "not-a-uuid" }).success,
      ).toBe(false);
    });
  });

  describe("publicPlayerDetailsResponseSchema", () => {
    const validDetails = {
      eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      eventStartsAt: "2026-11-15T19:00:00Z",
      eventTitle: "Fall Concert",
      items: [
        {
          arranger: null,
          composer: null,
          durationSeconds: null,
          title: "Alleluia",
          trackFileIds: {},
        },
      ],
      profileId: "11111111-1111-4111-8111-111111111111",
      profileName: "Jane Doe",
    };

    it("parses details with null optional fields", () => {
      const parsed = publicPlayerDetailsResponseSchema.parse({
        ...validDetails,
        eventArtworkFileId: null,
      });
      expect(parsed.eventArtworkFileId).toBeNull();
      expect(parsed.eventTitle).toBe("Fall Concert");
      expect(parsed.items).toHaveLength(1);
    });

    it("parses details with populated optional fields", () => {
      const parsed = publicPlayerDetailsResponseSchema.parse({
        ...validDetails,
        eventArtworkFileId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        organizationName: "Lancaster Community Chorus",
        performerLabel: "Choir Member",
      });
      expect(parsed.eventArtworkFileId).toBe("ffffffff-ffff-4fff-8fff-ffffffffffff");
      expect(parsed.organizationName).toBe("Lancaster Community Chorus");
      expect(parsed.performerLabel).toBe("Choir Member");
    });

    it("rejects invalid eventId or missing required fields", () => {
      expect(
        publicPlayerDetailsResponseSchema.safeParse({ ...validDetails, eventId: "invalid" })
          .success,
      ).toBe(false);
      expect(
        publicPlayerDetailsResponseSchema.safeParse({ ...validDetails, profileName: undefined })
          .success,
      ).toBe(false);
    });
  });
});
