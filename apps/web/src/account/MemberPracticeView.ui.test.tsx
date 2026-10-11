import { organizationEventSchema, type OrganizationEvent } from "@choir/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../auth/api";
import { MemberPracticeView } from "./MemberPracticeView";

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

function mockEvent(
  overrides: Partial<OrganizationEvent> & { id: string; title: string },
): OrganizationEvent {
  return organizationEventSchema.parse({
    callTime: "",
    createdAt: "2026-09-01T00:00:00Z",
    description: "",
    doorsOpenTime: "",
    durationMinutes: 120,
    isTicketingEnabled: false,
    location: "",
    parentPerformanceId: null,
    publicDetails: "",
    publicGraphicFileId: null,
    publishOnWebsite: false,
    setList: [
      { pieceId: PIECE_ONE_ID, title: "Alleluia" },
      { pieceId: PIECE_TWO_ID, title: "Ave Verum" },
    ],
    setListApproved: false,
    startsAt: "2026-10-15T19:00:00Z",
    status: "scheduled",
    ticketCapacity: null,
    type: "Performance",
    updatedAt: "2026-09-01T00:00:00Z",
    venueId: null,
    ...overrides,
  });
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
  vi.mocked(api.listOrganizationEvents).mockResolvedValue([
    mockEvent({
      id: EVENT_WITH_ART_ID,
      publicGraphicFileId: EVENT_ARTWORK_FILE_ID,
      title: "Spring Concert",
    }),
    mockEvent({ id: EVENT_WITHOUT_ART_ID, title: "Summer Sing" }),
  ]);
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
    await screen.findByText("Summer Sing");
    await screen.findByLabelText("Search tracks");
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
      Object.defineProperty(navigator, "mediaSession", {
        configurable: true,
        value: undefined,
        writable: true,
      });
    }
  });
});
