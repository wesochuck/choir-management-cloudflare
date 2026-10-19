import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SingerEvent, SingerLearningTrackPiece } from "@choir/contracts";

import { MemberPracticeView } from "./MemberPracticeView";
import {
  filterLibraryPieces,
  filterPlaylistItems,
  getApprovedPerformanceSetLists,
  isPiecePlayableForPart,
  mapSetListToPlaylistItems,
  singerPiecesToPlaylistItems,
} from "./memberPracticeLibrary";

function piece(overrides: Partial<SingerLearningTrackPiece> = {}): SingerLearningTrackPiece {
  return {
    arranger: "",
    composer: "Mozart",
    durationSeconds: 240,
    id: "11111111-1111-4111-8111-111111111111",
    parentId: null,
    scoreFileIds: {},
    title: "Alleluia",
    trackFileIds: { alto: "file-alto", tutti: "file-tutti" },
    ...overrides,
  };
}

function singerEvent(overrides: Partial<SingerEvent> = {}): SingerEvent {
  return {
    attendanceWarning: null,
    callTime: "18:30",
    details: "",
    directRsvp: "Yes",
    durationMinutes: 120,
    featuredAssignments: [],
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    inheritedFromParent: false,
    location: "Main Hall",
    practice: {
      sourceEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "available",
      trackCount: 2,
    },
    publicGraphicFileId: null,
    resolvedRsvp: "Yes",
    rsvpDeadlineAt: null,
    rsvpDeadlineDate: null,
    rsvpDeadlinePassed: false,
    rsvpNote: "",
    rsvpSelfServiceOpen: true,
    seating: { status: "not_published" },
    setList: [
      {
        composer: "Mozart",
        pieceId: "11111111-1111-4111-8111-111111111111",
        title: "Alleluia",
        type: "song",
      },
    ],
    startsAt: "2026-11-20T19:00:00.000Z",
    title: "Winter Concert",
    type: "Performance",
    venueAddress: "123 Main St",
    venueName: "Concert Hall",
    ...overrides,
  };
}

describe("singerPiecesToPlaylistItems", () => {
  it("maps library pieces to player items", () => {
    expect(
      singerPiecesToPlaylistItems([
        piece(),
        piece({
          id: "22222222-2222-4222-8222-222222222222",
          title: "Ave Verum",
          trackFileIds: { tenor: "file-tenor" },
        }),
      ]),
    ).toEqual([
      {
        arranger: "",
        composer: "Mozart",
        durationSeconds: 240,
        pieceId: "11111111-1111-4111-8111-111111111111",
        title: "Alleluia",
        trackFileIds: { alto: "file-alto", tutti: "file-tutti" },
        type: "song",
      },
      {
        arranger: "",
        composer: "Mozart",
        durationSeconds: 240,
        pieceId: "22222222-2222-4222-8222-222222222222",
        title: "Ave Verum",
        trackFileIds: { tenor: "file-tenor" },
        type: "song",
      },
    ]);
  });
});

describe("isPiecePlayableForPart", () => {
  it("marks pieces without track files as unplayable", () => {
    expect(isPiecePlayableForPart(piece({ trackFileIds: {} }), "Alto")).toBe(false);
    expect(isPiecePlayableForPart(piece({ trackFileIds: {} }), null)).toBe(false);
  });

  it("marks piece with matching voice part track as playable", () => {
    expect(isPiecePlayableForPart(piece({ trackFileIds: { alto: "f-alto" } }), "Alto")).toBe(true);
    expect(isPiecePlayableForPart(piece({ trackFileIds: { alto: "f-alto" } }), "A1")).toBe(true);
    expect(isPiecePlayableForPart(piece({ trackFileIds: { tenor: "f-tenor" } }), "Tenor")).toBe(
      true,
    );
  });

  it("falls back to full mix / tutti / all when assigned part track is missing", () => {
    expect(isPiecePlayableForPart(piece({ trackFileIds: { tutti: "f-tutti" } }), "Bass")).toBe(
      true,
    );
    expect(isPiecePlayableForPart(piece({ trackFileIds: { fullmix: "f-mix" } }), "Soprano")).toBe(
      true,
    );
  });

  it("marks piece as playable via fallback to ANY recorded part when singer's part has no direct recording", () => {
    expect(isPiecePlayableForPart(piece({ trackFileIds: { soprano: "f-sop" } }), "Bass")).toBe(
      true,
    );
    expect(isPiecePlayableForPart(piece({ trackFileIds: { tenor: "f-ten" } }), "Alto")).toBe(true);
    expect(isPiecePlayableForPart(piece({ trackFileIds: { alto: "f-alto" } }), "Tenor 2")).toBe(
      true,
    );
  });

  it("marks piece with any audio as playable when user has no assigned voice part", () => {
    expect(isPiecePlayableForPart(piece({ trackFileIds: { soprano: "f-sop" } }), null)).toBe(true);
    expect(isPiecePlayableForPart(piece({ trackFileIds: { soprano: "f-sop" } }), "")).toBe(true);
  });
});

describe("getApprovedPerformanceSetLists", () => {
  const now = new Date("2026-10-15T12:00:00.000Z");

  it("returns empty array when events list has no approved set lists", () => {
    expect(
      getApprovedPerformanceSetLists(
        [
          singerEvent({
            practice: { sourceEventId: null, status: "not_published", trackCount: 0 },
            setList: [],
          }),
        ],
        now,
      ),
    ).toEqual([]);
  });

  it("deduplicates rehearsals inheriting a performance set list and orders upcoming before past", () => {
    const perfUpcoming = singerEvent({
      id: "11111111-1111-4111-8111-111111111111",
      practice: {
        sourceEventId: "11111111-1111-4111-8111-111111111111",
        status: "available",
        trackCount: 1,
      },
      startsAt: "2026-11-20T19:00:00.000Z",
      title: "Upcoming Concert",
      type: "Performance",
    });

    const rehearsalUpcoming = singerEvent({
      id: "22222222-2222-4222-8222-222222222222",
      inheritedFromParent: true,
      practice: {
        sourceEventId: "11111111-1111-4111-8111-111111111111",
        status: "available",
        trackCount: 1,
      },
      startsAt: "2026-11-15T19:00:00.000Z",
      title: "Concert Rehearsal",
      type: "Rehearsal",
    });

    const perfPast = singerEvent({
      id: "33333333-3333-4333-8333-333333333333",
      practice: {
        sourceEventId: "33333333-3333-4333-8333-333333333333",
        status: "available",
        trackCount: 1,
      },
      startsAt: "2026-09-01T19:00:00.000Z",
      title: "Past Gala",
      type: "Performance",
    });

    const options = getApprovedPerformanceSetLists(
      [perfPast, rehearsalUpcoming, perfUpcoming],
      now,
    );
    expect(options).toHaveLength(2);
    expect(options[0]?.title).toBe("Upcoming Concert");
    expect(options[0]?.eventId).toBe("11111111-1111-4111-8111-111111111111");
    expect(options[1]?.title).toBe("Past Gala");
  });
});

describe("mapSetListToPlaylistItems", () => {
  const pieces = [
    piece({
      composer: "Mozart",
      id: "11111111-1111-4111-8111-111111111111",
      title: "Alleluia",
      trackFileIds: { alto: "f-alto" },
    }),
    piece({
      composer: "Handel",
      id: "22222222-2222-4222-8222-222222222222",
      parentId: "parent-handel",
      title: "Messiah: Hallelujah",
      trackFileIds: { tutti: "f-tutti" },
    }),
  ];

  it("maps items in stored program order, expanding parent/movements and cues", () => {
    const setList = [
      {
        pieceId: "11111111-1111-4111-8111-111111111111",
        title: "Alleluia (Opener)",
      },
      {
        title: "Intermission",
        type: "intermission" as const,
      },
      {
        pieceId: "parent-handel",
        title: "Handel Masterwork",
      },
      {
        pieceId: "11111111-1111-4111-8111-111111111111",
        title: "Alleluia (Reprise)",
      },
      {
        pieceId: "deleted-piece-id",
        title: "Missing Song",
      },
    ];

    const playlist = mapSetListToPlaylistItems(setList, pieces);
    expect(playlist).toHaveLength(5);
    expect(playlist[0]?.title).toBe("Alleluia (Opener)");
    expect(playlist[0]?.trackFileIds).toEqual({ alto: "f-alto" });
    expect(playlist[1]?.title).toBe("Intermission");
    expect(playlist[1]?.type).toBe("intermission");
    expect(playlist[1]?.trackFileIds).toEqual({});
    expect(playlist[2]?.title).toBe("Messiah: Hallelujah");
    expect(playlist[2]?.pieceId).toBe("22222222-2222-4222-8222-222222222222");
    expect(playlist[3]?.title).toBe("Alleluia (Reprise)");
    expect(playlist[3]?.pieceId).toBe("11111111-1111-4111-8111-111111111111");
    // Distinct objects even with duplicated pieceId
    expect(playlist[0]).not.toBe(playlist[3]);
    expect(playlist[4]?.title).toBe("Missing Song");
    expect(playlist[4]?.trackFileIds).toEqual({});
  });

  it("omits parent holder when parent holder is present in pieces with trackFileIds: {} and movements are in setList", () => {
    const parentHolder = piece({
      arranger: "Arranger",
      composer: "Ola Gjeilo",
      id: "parent-sunrise",
      movementOrder: ["mov-1", "mov-2"],
      title: "Sunrise Mass",
      trackFileIds: {},
    });
    const mov1 = piece({
      composer: "Ola Gjeilo",
      id: "mov-1",
      parentId: "parent-sunrise",
      title: "The Spheres",
      trackFileIds: { soprano: "f-spheres" },
    });
    const mov2 = piece({
      composer: "Ola Gjeilo",
      id: "mov-2",
      parentId: "parent-sunrise",
      title: "Sunrise",
      trackFileIds: { alto: "f-sunrise" },
    });

    const setList = [
      {
        pieceId: "parent-sunrise",
        title: "Sunrise Mass",
      },
      {
        pieceId: "mov-1",
        title: "The Spheres",
      },
      {
        pieceId: "mov-2",
        title: "Sunrise",
      },
    ];

    const playlist = mapSetListToPlaylistItems(setList, [parentHolder, mov1, mov2]);
    expect(playlist).toHaveLength(2);
    expect(playlist[0]?.pieceId).toBe("mov-1");
    expect(playlist[0]?.title).toBe("The Spheres");
    expect(playlist[0]?.arranger).toBe("Arranger");
    expect(playlist[0]?.trackFileIds).toEqual({ soprano: "f-spheres" });
    expect(playlist[1]?.pieceId).toBe("mov-2");
    expect(playlist[1]?.title).toBe("Sunrise");
    expect(playlist[1]?.arranger).toBe("Arranger");
    expect(playlist[1]?.trackFileIds).toEqual({ alto: "f-sunrise" });
  });

  it("expands parent holder into movements in movementOrder order when only parent holder is in setList", () => {
    const parentHolder = piece({
      arranger: "Arranger",
      composer: "Ola Gjeilo",
      id: "parent-sunrise",
      movementOrder: ["mov-1", "mov-2"],
      title: "Sunrise Mass",
      trackFileIds: {},
    });
    const mov1 = piece({
      composer: "",
      id: "mov-1",
      parentId: "parent-sunrise",
      title: "The Spheres",
      trackFileIds: { soprano: "f-spheres" },
    });
    const mov2 = piece({
      composer: "",
      id: "mov-2",
      parentId: "parent-sunrise",
      title: "Sunrise",
      trackFileIds: { alto: "f-sunrise" },
    });

    const setList = [
      {
        composer: "Gjeilo SetList",
        isFeaturedNumber: true,
        notes: "Full performance",
        pieceId: "parent-sunrise",
        title: "Sunrise Mass",
      },
    ];

    const playlist = mapSetListToPlaylistItems(setList, [parentHolder, mov2, mov1]);
    expect(playlist).toHaveLength(2);
    expect(playlist[0]?.pieceId).toBe("mov-1");
    expect(playlist[0]?.title).toBe("The Spheres");
    expect(playlist[0]?.composer).toBe("Ola Gjeilo");
    expect(playlist[0]?.arranger).toBe("Arranger");
    expect(playlist[0]?.isFeaturedNumber).toBe(true);
    expect(playlist[0]?.notes).toBe("Full performance");
    expect(playlist[0]?.trackFileIds).toEqual({ soprano: "f-spheres" });

    expect(playlist[1]?.pieceId).toBe("mov-2");
    expect(playlist[1]?.title).toBe("Sunrise");
    expect(playlist[1]?.composer).toBe("Ola Gjeilo");
    expect(playlist[1]?.trackFileIds).toEqual({ alto: "f-sunrise" });
  });
});

describe("filterPlaylistItems", () => {
  const items = [
    {
      composer: "Mozart",
      title: "Alleluia",
      trackFileIds: { alto: "f-alto" },
    },
    {
      composer: "Handel",
      title: "Intermission",
      trackFileIds: {},
      type: "intermission" as const,
    },
    {
      composer: "Bach",
      title: "Cantata",
      trackFileIds: {},
    },
  ];

  it("filters by search query and playableOnly", () => {
    expect(filterPlaylistItems(items, "alle", false, "Alto")).toHaveLength(1);
    expect(filterPlaylistItems(items, "", true, "Alto")).toHaveLength(1);
    expect(filterPlaylistItems(items, "", false, "Alto")).toHaveLength(3);
  });
});

describe("filterLibraryPieces", () => {
  const pieces = [
    piece(),
    piece({
      composer: "Bach",
      id: "22222222-2222-4222-8222-222222222222",
      parentId: "33333333-3333-4333-8333-333333333333",
      title: "Jesu, Joy",
      trackFileIds: { soprano: "file-soprano" },
    }),
    piece({
      composer: "Handel",
      id: "33333333-3333-4333-8333-333333333333",
      title: "Messiah",
      trackFileIds: {},
    }),
  ];

  it("matches title, composer, and arranger case-insensitively", () => {
    expect(filterLibraryPieces(pieces, "alle", null, null)).toHaveLength(1);
    expect(filterLibraryPieces(pieces, "BACH", null, null)).toHaveLength(1);
    expect(filterLibraryPieces(pieces, "", null, null)).toHaveLength(3);
  });

  it("scopes to one piece including its children", () => {
    expect(
      filterLibraryPieces(pieces, "", null, "33333333-3333-4333-8333-333333333333"),
    ).toHaveLength(2);
    expect(
      filterLibraryPieces(pieces, "", new Set(["11111111-1111-4111-8111-111111111111"]), null),
    ).toHaveLength(1);
  });

  it("combines scoping with search", () => {
    expect(filterLibraryPieces(pieces, "jesu", null, null)).toHaveLength(1);
    expect(
      filterLibraryPieces(pieces, "jesu", new Set(["11111111-1111-4111-8111-111111111111"]), null),
    ).toHaveLength(0);
  });

  it("filters to playable tracks only when playableOnly is true", () => {
    // Alleluia has alto/tutti (playable), Jesu has soprano only (playable via ANY fallback), Messiah has none (unplayable)
    expect(filterLibraryPieces(pieces, "", null, null, true, "Alto")).toHaveLength(2);
    expect(filterLibraryPieces(pieces, "", null, null, true, "Alto").map((p) => p.title)).toEqual([
      "Alleluia",
      "Jesu, Joy",
    ]);

    // When playableOnly is false, all 3 pieces are returned
    expect(filterLibraryPieces(pieces, "", null, null, false, "Alto")).toHaveLength(3);
  });
});

describe("MemberPracticeView", () => {
  it("renders nothing when disabled", () => {
    expect(renderToString(<MemberPracticeView enabled={false} />)).toBe("");
  });

  it("shows a loading state before the library arrives", () => {
    const html = renderToString(<MemberPracticeView enabled />);
    expect(html).toContain("Loading learning tracks…");
  });
});
