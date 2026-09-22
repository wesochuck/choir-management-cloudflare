import { describe, expect, it } from "vitest";

import { parsePlayerDetails, parsePublicPlaylistDetails } from "./api";

describe("public player api parsing", () => {
  const validPlaylistResponse = {
    allPieces: [
      {
        title: "Alleluia",
        trackFileIds: { tutti: "track-1" },
      },
    ],
    event: {
      artworkFileId: "artwork-123",
      date: "2026-12-13T19:00:00.000Z",
      id: "event-123",
      title: "2026 Christmas Concert",
    },
    organizationName: "Lancaster Community Chorus",
    performerLabel: "Singer",
    pieces: [
      {
        title: "Alleluia",
        trackFileIds: { tutti: "track-1" },
      },
    ],
  };

  it("parsePublicPlaylistDetails preserves organizationName", () => {
    const details = parsePublicPlaylistDetails(validPlaylistResponse);
    expect(details.organizationName).toBe("Lancaster Community Chorus");
    expect(details.eventId).toBe("event-123");
    expect(details.eventTitle).toBe("2026 Christmas Concert");
    expect(details.eventArtworkFileId).toBe("artwork-123");
    expect(details.items).toHaveLength(1);
    expect(details.items[0]?.title).toBe("Alleluia");
  });

  it("parsePublicPlaylistDetails safely handles missing legacy organizationName", () => {
    const legacyResponse = {
      allPieces: validPlaylistResponse.allPieces,
      event: validPlaylistResponse.event,
      performerLabel: validPlaylistResponse.performerLabel,
      pieces: validPlaylistResponse.pieces,
    };
    const details = parsePublicPlaylistDetails(legacyResponse);
    expect(details.organizationName).toBeUndefined();
    expect(details.eventId).toBe("event-123");
    expect(details.eventTitle).toBe("2026 Christmas Concert");
  });

  it("parsePlayerDetails preserves organizationName from cached metadata or recipient details", () => {
    const cachedData = {
      eventArtworkFileId: "artwork-123",
      eventId: "event-123",
      eventStartsAt: "2026-12-13T19:00:00.000Z",
      eventTitle: "2026 Christmas Concert",
      items: [
        {
          title: "Alleluia",
          trackFileIds: { tutti: "track-1" },
        },
      ],
      organizationName: "Lancaster Community Chorus",
      performerLabel: "Singer",
      profileName: "Alice",
    };

    const details = parsePlayerDetails(cachedData);
    expect(details.organizationName).toBe("Lancaster Community Chorus");
    expect(details.eventId).toBe("event-123");
    expect(details.profileName).toBe("Alice");
  });

  it("parsePlayerDetails safely handles missing legacy organizationName", () => {
    const legacyCachedData = {
      eventArtworkFileId: null,
      eventId: "event-123",
      eventStartsAt: "2026-12-13T19:00:00.000Z",
      eventTitle: "2026 Christmas Concert",
      items: [
        {
          title: "Alleluia",
          trackFileIds: { tutti: "track-1" },
        },
      ],
      performerLabel: "Singer",
      profileName: "Alice",
    };

    const details = parsePlayerDetails(legacyCachedData);
    expect(details.organizationName).toBeUndefined();
    expect(details.eventId).toBe("event-123");
  });
});
