import { describe, expect, it } from "vitest";

import {
  isNullableBoolean,
  isNullableNumber,
  isNullableString,
  isPlayerDetails,
  isPlayerPlaylistItem,
  isRecord,
  isStringRecord,
} from "./guards";

describe("Player guard null-matrix and type verification", () => {
  describe("primitive guards", () => {
    it("validates isRecord", () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord({ a: 1 })).toBe(true);
      expect(isRecord(null)).toBe(false);
      expect(isRecord(undefined)).toBe(false);
      expect(isRecord("string")).toBe(false);
      expect(isRecord(123)).toBe(false);
      expect(isRecord(true)).toBe(false);
    });

    it("validates isStringRecord", () => {
      expect(isStringRecord({})).toBe(true);
      expect(isStringRecord({ soprano: "file-1", alto: "file-2" })).toBe(true);
      expect(isStringRecord({ soprano: 123 })).toBe(false);
      expect(isStringRecord({ soprano: null })).toBe(false);
      expect(isStringRecord(null)).toBe(false);
      expect(isStringRecord("not an object")).toBe(false);
    });

    it("validates isNullableString", () => {
      expect(isNullableString(undefined)).toBe(true);
      expect(isNullableString(null)).toBe(true);
      expect(isNullableString("valid string")).toBe(true);
      expect(isNullableString("")).toBe(true);
      expect(isNullableString(123)).toBe(false);
      expect(isNullableString(false)).toBe(false);
      expect(isNullableString({})).toBe(false);
    });

    it("validates isNullableNumber", () => {
      expect(isNullableNumber(undefined)).toBe(true);
      expect(isNullableNumber(null)).toBe(true);
      expect(isNullableNumber(0)).toBe(true);
      expect(isNullableNumber(120)).toBe(true);
      expect(isNullableNumber("120")).toBe(false);
      expect(isNullableNumber(false)).toBe(false);
      expect(isNullableNumber({})).toBe(false);
    });

    it("validates isNullableBoolean", () => {
      expect(isNullableBoolean(undefined)).toBe(true);
      expect(isNullableBoolean(null)).toBe(true);
      expect(isNullableBoolean(true)).toBe(true);
      expect(isNullableBoolean(false)).toBe(true);
      expect(isNullableBoolean(1)).toBe(false);
      expect(isNullableBoolean("true")).toBe(false);
      expect(isNullableBoolean({})).toBe(false);
    });
  });

  describe("isPlayerPlaylistItem null-matrix", () => {
    const validBaseItem = {
      title: "Alleluia",
      trackFileIds: { soprano: "file-1" },
    };

    it("accepts a fully populated item", () => {
      expect(
        isPlayerPlaylistItem({
          ...validBaseItem,
          arranger: "Shaw",
          composer: "Mozart",
          durationSeconds: 240,
          isFeaturedNumber: true,
          notes: "Solo section",
          pieceId: "piece-1",
        }),
      ).toBe(true);
    });

    it("accepts an item with all nullable fields set to null", () => {
      expect(
        isPlayerPlaylistItem({
          ...validBaseItem,
          arranger: null,
          composer: null,
          durationSeconds: null,
          isFeaturedNumber: null,
          notes: null,
          pieceId: null,
        }),
      ).toBe(true);
    });

    it("accepts an item with all optional fields omitted (undefined)", () => {
      expect(isPlayerPlaylistItem(validBaseItem)).toBe(true);
    });

    it("accepts missing or null trackFileIds (normalizing to empty record)", () => {
      expect(isPlayerPlaylistItem({ title: "A Cappella" })).toBe(true);
      expect(isPlayerPlaylistItem({ title: "A Cappella", trackFileIds: null })).toBe(true);
      expect(isPlayerPlaylistItem({ title: "A Cappella", trackFileIds: undefined })).toBe(true);
    });

    it("rejects wrong types for each optional/nullable field", () => {
      expect(isPlayerPlaylistItem({ ...validBaseItem, arranger: 123 })).toBe(false);
      expect(isPlayerPlaylistItem({ ...validBaseItem, arranger: {} })).toBe(false);
      expect(isPlayerPlaylistItem({ ...validBaseItem, composer: 456 })).toBe(false);
      expect(isPlayerPlaylistItem({ ...validBaseItem, composer: [] })).toBe(false);
      expect(isPlayerPlaylistItem({ ...validBaseItem, durationSeconds: "240" })).toBe(false);
      expect(isPlayerPlaylistItem({ ...validBaseItem, durationSeconds: {} })).toBe(false);
      expect(isPlayerPlaylistItem({ ...validBaseItem, isFeaturedNumber: "true" })).toBe(false);
      expect(isPlayerPlaylistItem({ ...validBaseItem, isFeaturedNumber: 1 })).toBe(false);
      expect(isPlayerPlaylistItem({ ...validBaseItem, notes: 789 })).toBe(false);
      expect(isPlayerPlaylistItem({ ...validBaseItem, pieceId: 999 })).toBe(false);
      expect(isPlayerPlaylistItem({ ...validBaseItem, trackFileIds: { soprano: 123 } })).toBe(
        false,
      );
      expect(isPlayerPlaylistItem({ ...validBaseItem, trackFileIds: "file-1" })).toBe(false);
    });

    it("rejects invalid title or non-record value", () => {
      expect(isPlayerPlaylistItem(null)).toBe(false);
      expect(isPlayerPlaylistItem(undefined)).toBe(false);
      expect(isPlayerPlaylistItem("Alleluia")).toBe(false);
      expect(isPlayerPlaylistItem({ ...validBaseItem, title: 123 })).toBe(false);
      expect(isPlayerPlaylistItem({ ...validBaseItem, title: null })).toBe(false);
      expect(isPlayerPlaylistItem({ trackFileIds: {} })).toBe(false);
    });
  });

  describe("isPlayerDetails null-matrix", () => {
    const validBaseDetails = {
      eventId: "event-123",
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
      profileId: "profile-1",
      profileName: "Jane Doe",
    };

    it("accepts a fully populated details payload with non-nulls", () => {
      expect(
        isPlayerDetails({
          ...validBaseDetails,
          eventArtworkFileId: "artwork-file-1",
          organizationName: "Great Choir",
          performerLabel: "Singer",
        }),
      ).toBe(true);
    });

    it("accepts details payload with nulls for all nullable fields", () => {
      expect(
        isPlayerDetails({
          ...validBaseDetails,
          eventArtworkFileId: null,
          organizationName: null,
          performerLabel: null,
          profileName: null,
        }),
      ).toBe(true);
    });

    it("accepts details payload with omitted (undefined) optional fields", () => {
      expect(isPlayerDetails(validBaseDetails)).toBe(true);
    });

    it("rejects details payload if an item fails validation", () => {
      expect(
        isPlayerDetails({
          ...validBaseDetails,
          items: [{ title: 123 }], // Invalid item
        }),
      ).toBe(false);
    });

    it("rejects details payload with wrong types for required fields", () => {
      expect(isPlayerDetails({ ...validBaseDetails, eventId: 123 })).toBe(false);
      expect(isPlayerDetails({ ...validBaseDetails, eventTitle: null })).toBe(false);
      expect(isPlayerDetails({ ...validBaseDetails, eventStartsAt: {} })).toBe(false);
      expect(isPlayerDetails({ ...validBaseDetails, items: "not-an-array" })).toBe(false);
      expect(isPlayerDetails(null)).toBe(false);
    });
  });
});
