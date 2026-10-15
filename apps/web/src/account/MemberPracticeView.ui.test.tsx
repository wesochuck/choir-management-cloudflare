import * as singerApi from "../api/singer";
import * as api from "../auth/api";
import { MemberPracticeView } from "./MemberPracticeView";

vi.mock("../api/singer", () => ({
  getMySchedule: vi.fn(),
}));

vi.mock("../auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    listOrganizationEvents: vi.fn(),
    listSingerLearningTracks: vi.fn(),
  };
});

const PIECE_ONE_ID = "11111111-1111-4111-8111-111111111111";
const PIECE_TWO_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_WITH_ART_ID = "33333333-3333-4333-8333-333333333333";
const EVENT_WITHOUT_ART_ID = "44444444-4444-4444-8444-444444444444";
const EVENT_ARTWORK_FILE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function trackPiece(id: string, title: string) {
  return {
    arranger: "",
    composer: "Mozart",
    durationSeconds: 240,
    id,
    parentId: null,
    scoreFileIds: {},
    title,
    trackFileIds: { alto: `file-alto-${id.slice(0, 8)}`, tutti: `file-tutti-${id.slice(0, 8)}` },
  };
}

import type { SingerEvent } from "@choir/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function mockSingerEvent(
  overrides: Partial<SingerEvent> & { id: string; title: string },
): SingerEvent {
  return {
    attendanceWarning: null,
    callTime: "",
    details: "",
    directRsvp: "Yes",
    durationMinutes: 120,
    featuredAssignments: [],
    inheritedFromParent: false,
    location: "",
    practice: {
      sourceEventId: overrides.id,
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
      { pieceId: PIECE_ONE_ID, title: "Alleluia", type: "song" },
      { pieceId: PIECE_TWO_ID, title: "Ave Verum", type: "song" },
    ],
    startsAt: "2026-10-15T19:00:00Z",
    type: "Performance",
    venueAddress: "",
    venueName: "",
    ...overrides,
  };
}

function renderWithEvent(eventId: string | null) {
  const url = eventId ? `/practice?eventId=${eventId}` : "/practice";
  window.history.replaceState({}, "", url);
  return render(<MemberPracticeView enabled />);
}

beforeEach(() => {
  vi.mocked(api.listSingerLearningTracks).mockResolvedValue([
    trackPiece(PIECE_ONE_ID, "Alleluia"),
    trackPiece(PIECE_TWO_ID, "Ave Verum"),
  ]);
  vi.mocked(singerApi.getMySchedule).mockResolvedValue({
    events: [
      mockSingerEvent({
        id: EVENT_WITH_ART_ID,
        publicGraphicFileId: EVENT_ARTWORK_FILE_ID,
        title: "Spring Concert",
      }),
      mockSingerEvent({ id: EVENT_WITHOUT_ART_ID, title: "Summer Sing" }),
    ],
    profileId: "00000000-0000-4000-8000-000000000000",
    requestId: "11111111-1111-4111-8111-111111111111",
    timezone: "UTC",
  });
});

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("MemberPracticeView event artwork", () => {
  it("shows the linked event image through the session file URL", async () => {
    renderWithEvent(EVENT_WITH_ART_ID);
    const artwork = await screen.findByAltText("Spring Concert artwork");
    expect(artwork).toHaveAttribute("src", `/api/organization/files/${EVENT_ARTWORK_FILE_ID}`);
  });

  it("keeps the same artwork when moving to the next track", async () => {
    const user = userEvent.setup();
    renderWithEvent(EVENT_WITH_ART_ID);
    const artwork = await screen.findByAltText("Spring Concert artwork");
    await user.click(screen.getByRole("button", { name: "Next track" }));
    expect(await screen.findByAltText("Spring Concert artwork")).toHaveAttribute(
      "src",
      artwork.getAttribute("src"),
    );
  });

  it("shows the placeholder when the event has no image", async () => {
    renderWithEvent(EVENT_WITHOUT_ART_ID);
    await screen.findByRole("tab", { name: "Published set lists" });
    await screen.findByLabelText("Search this set list");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(document.querySelector(".public-player__artwork--placeholder")).toBeInTheDocument();
  });

  it("shows no event artwork for an unmatched event", async () => {
    renderWithEvent("55555555-5555-4555-8555-555555555555");
    await screen.findByLabelText("Search tracks");
    await waitFor(() => {
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });
  });

  it("publishes src-only media-session artwork with the event album", async () => {
    class FakeMediaSession {
      metadata:
        { album?: string; artwork?: { src: string; sizes?: string; type?: string }[] } | undefined =
        undefined;
      playbackState = "none";
    }
    const sessionStub = new FakeMediaSession();
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: sessionStub,
      writable: true,
    });
    vi.stubGlobal(
      "MediaMetadata",
      class {
        album?: string;
        artwork?: { src: string }[];
        artist?: string;
        title?: string;
        constructor(init?: {
          album?: string;
          artwork?: { src: string }[];
          artist?: string;
          title?: string;
        }) {
          Object.assign(this, init);
        }
      },
    );
    try {
      renderWithEvent(EVENT_WITH_ART_ID);
      await screen.findByAltText("Spring Concert artwork");
      await waitFor(() => {
        expect(sessionStub.metadata?.album).toBe("Spring Concert");
      });
      expect(sessionStub.metadata?.artwork).toEqual([
        { src: `/api/organization/files/${EVENT_ARTWORK_FILE_ID}` },
      ]);
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(navigator, "mediaSession");
    }
  });
});

describe("MemberPracticeView playable-only filter", () => {
  it("renders the playable-only toggle and count badge", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listSingerLearningTracks).mockResolvedValue([
      trackPiece(PIECE_ONE_ID, "Alleluia"),
      trackPiece(PIECE_TWO_ID, "Ave Verum"),
      {
        arranger: "",
        composer: "Mozart",
        durationSeconds: 180,
        id: "piece-no-audio",
        parentId: null,
        scoreFileIds: {},
        title: "Lacrimosa",
        trackFileIds: {},
      },
    ]);
    renderWithEvent(null);
    await user.click(await screen.findByRole("tab", { name: "All tracks" }));
    await screen.findByText("Showing 2 playable of 3 total pieces");
    const toggle = screen.getByRole("checkbox", { name: "Playable only" });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("Lacrimosa")).toBeInTheDocument();
  });

  it("filters out unplayable tracks when toggled on", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listSingerLearningTracks).mockResolvedValue([
      trackPiece(PIECE_ONE_ID, "Alleluia"),
      {
        arranger: "",
        composer: "Mozart",
        durationSeconds: 180,
        id: "piece-no-audio",
        parentId: null,
        scoreFileIds: {},
        title: "Lacrimosa",
        trackFileIds: {},
      },
    ]);
    renderWithEvent(null);
    await user.click(await screen.findByRole("tab", { name: "All tracks" }));
    await screen.findByText("Showing 1 playable of 2 total pieces");
    expect(screen.getByText("Lacrimosa")).toBeInTheDocument();

    const toggle = screen.getByRole("checkbox", { name: "Playable only" });
    await user.click(toggle);
    expect(toggle).toBeChecked();

    expect(screen.queryByText("Lacrimosa")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Alleluia" })).toBeInTheDocument();
  });

  it("shows empty state when no tracks match playable filter", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listSingerLearningTracks).mockResolvedValue([
      {
        arranger: "",
        composer: "Mozart",
        durationSeconds: 180,
        id: "piece-no-audio",
        parentId: null,
        scoreFileIds: {},
        title: "Lacrimosa",
        trackFileIds: {},
      },
    ]);
    renderWithEvent(null);
    await user.click(await screen.findByRole("tab", { name: "All tracks" }));
    await screen.findByText("Showing 0 playable of 1 total pieces");

    const toggle = screen.getByRole("checkbox", { name: "Playable only" });
    await user.click(toggle);

    expect(screen.getByText("No playable tracks match the current filters.")).toBeInTheDocument();
  });
});

describe("MemberPracticeView published set lists and selection", () => {
  it("defaults to Published set lists view when approved performance lists exist", async () => {
    renderWithEvent(null);
    const setListsTab = await screen.findByRole("tab", { name: "Published set lists" });
    expect(setListsTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Choose a performance")).toBeInTheDocument();
    expect(screen.getByText(/playable of 2 music selections/)).toBeInTheDocument();
  });

  it("switches performance when selected from the dropdown", async () => {
    const user = userEvent.setup();
    renderWithEvent(null);
    const select = await screen.findByLabelText("Choose a performance");
    expect(select).toHaveValue(EVENT_WITH_ART_ID);

    await user.selectOptions(select, EVENT_WITHOUT_ART_ID);
    expect(select).toHaveValue(EVENT_WITHOUT_ART_ID);
  });

  it("scopes search to the chosen published set list", async () => {
    const user = userEvent.setup();
    renderWithEvent(null);
    const searchInput = await screen.findByPlaceholderText("Search this set list");
    await user.type(searchInput, "Alleluia");

    expect(screen.getByRole("heading", { name: "Alleluia" })).toBeInTheDocument();
    expect(screen.queryByText("Ave Verum")).not.toBeInTheDocument();
  });

  it("shows stale event notice when requested eventId is not found", async () => {
    renderWithEvent("stale-or-deleted-event-id");
    expect(
      await screen.findByText("The requested set list is no longer available."),
    ).toBeInTheDocument();
    // Falls back to All tracks tab
    const allTracksTab = screen.getByRole("tab", { name: "All tracks" });
    expect(allTracksTab).toHaveAttribute("aria-selected", "true");
  });
});
