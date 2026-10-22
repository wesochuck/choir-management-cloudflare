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
    expect(details.trackLabels).toEqual({});
  });

  it("parsePublicPlaylistDetails preserves trackLabels when present", () => {
    const details = parsePublicPlaylistDetails({
      ...validPlaylistResponse,
      trackLabels: { B1: "Bass 1", SATB: "Full Chorus", tutti: "Choir Mix" },
    });
    expect(details.trackLabels).toEqual({
      B1: "Bass 1",
      SATB: "Full Chorus",
      tutti: "Choir Mix",
    });
  });

  it("parsePlayerDetails preserves trackLabels when present", () => {
    const details = parsePlayerDetails({
      eventArtworkFileId: "artwork-123",
      eventId: "event-123",
      eventStartsAt: "2026-12-13T19:00:00.000Z",
      eventTitle: "2026 Christmas Concert",
      items: [
        {
          title: "Alleluia",
          trackFileIds: { B1: "file-b1" },
        },
      ],
      organizationName: "Lancaster Community Chorus",
      trackLabels: { B1: "Bass 1", T1: "Tenor 1" },
    });
    expect(details.trackLabels).toEqual({ B1: "Bass 1", T1: "Tenor 1" });
  });
});

describe("versioned loudness metadata parsing", () => {
  const fileId = "8dd17839-19ac-4b24-8479-f600861e902b";
  const measurement = {
    analysisVersion: 1,
    contentVersion: "r2-upload-version",
    integratedLufs: -26,
    truePeakDbtp: -3,
  };
  const details = {
    eventId: "event",
    eventStartsAt: "",
    eventTitle: "Practice",
    items: [{ title: "Song", trackFileIds: { tutti: fileId } }],
  };
  it("retains ready versioned metadata through repeated offline normalization", () => {
    const parsed = parsePlayerDetails({ ...details, loudnessByFileId: { [fileId]: measurement } });
    expect(parsePlayerDetails(parsed).loudnessByFileId).toEqual({ [fileId]: measurement });
    expect(
      parsePublicPlaylistDetails({
        event: { id: "event", title: "Practice", date: "" },
        pieces: details.items,
        loudnessByFileId: parsed.loudnessByFileId,
      }).loudnessByFileId,
    ).toEqual(parsed.loudnessByFileId);
  });
  it("preserves the configured target in signed-player and offline payloads", () => {
    const configured = { ...measurement, targetLufs: -14 };
    const parsed = parsePlayerDetails({ ...details, loudnessByFileId: { [fileId]: configured } });
    expect(parsePlayerDetails(parsed).loudnessByFileId?.[fileId]?.targetLufs).toBe(-14);
    expect(
      parsePublicPlaylistDetails({
        event: { id: "event", title: "Practice", date: "" },
        pieces: details.items,
        loudnessByFileId: parsed.loudnessByFileId,
      }).loudnessByFileId?.[fileId]?.targetLufs,
    ).toBe(-14);
  });
  it("keeps old and malformed analysis payloads playable at unity", () => {
    for (const value of [
      undefined,
      null,
      {},
      { [fileId]: { ...measurement, truePeakDbtp: Infinity } },
      { [fileId]: { ...measurement, analysisVersion: 2 } },
    ]) {
      const parsed = parsePlayerDetails({ ...details, loudnessByFileId: value });
      expect(parsed.items).toHaveLength(1);
      expect(parsed.loudnessByFileId?.[fileId]).toBeUndefined();
    }
  });
});
