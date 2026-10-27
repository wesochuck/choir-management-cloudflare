import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PlayerBrand,
  PublicPracticePlayer,
  createTokenTrackSource,
  type PlayerDetails,
} from "./player";
import { PublicPlayerView } from "./PublicPlayerView";
import * as playerApi from "./player/api";
import {
  clearPinnedPieceTrack,
  readPinnedPieceTracks,
  writePinnedPieceTrack,
} from "./player/format";
import * as usePlayerOfflineModule from "./player/usePlayerOffline";

const mockDetails: PlayerDetails = {
  eventArtworkFileId: "artwork-uuid-123",
  eventId: "event-uuid-123",
  eventStartsAt: "2026-12-13T19:00:00.000Z",
  eventTitle: "2026 Christmas Concert",
  items: [
    {
      composer: "Mozart",
      durationSeconds: 240,
      title: "Alleluia",
      trackFileIds: { tutti: "track-1" },
    },
  ],
  organizationName: "Lancaster Community Chorus",
  performerLabel: "Chamber Singer",
  profileName: "Alice",
};

interface FakeRequest<T> {
  error: Error | null;
  onerror: (() => void) | null;
  onsuccess: (() => void) | null;
  result: T;
}

function successfulRequest<T>(result: T): FakeRequest<T> {
  const request: FakeRequest<T> = { error: null, onerror: null, onsuccess: null, result };
  queueMicrotask(() => {
    request.onsuccess?.();
  });
  return request;
}

function installIndexedDatabase(): void {
  const records = new Map<string, unknown>();
  const store = {
    delete: (key: string) => {
      records.delete(key);
      return successfulRequest(undefined);
    },
    get: (key: string) => successfulRequest(records.get(key)),
    getAll: () => successfulRequest([...records.values()]),
    put: (record: { readonly key: string }) => {
      records.set(record.key, record);
      return successfulRequest(record.key);
    },
  };
  const database = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({ objectStore: () => store }),
  };
  vi.stubGlobal("indexedDB", {
    open: () => successfulRequest(database),
  });
}

function setLocationSearch(search: string): void {
  const url = new URL(`https://example.com/player${search}`);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: url,
  });
}

describe("PublicPlayerView UI & Branding", () => {
  const originalLocation = window.location;
  const originalTitle = document.title;

  beforeEach(() => {
    vi.restoreAllMocks();
    installIndexedDatabase();
    document.title = "Original Title";
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    vi.unstubAllGlobals();
    document.title = originalTitle;
  });

  describe("PlayerBrand component", () => {
    it("renders Organization logo URL and name", () => {
      const { container } = render(<PlayerBrand organizationName="Lancaster Community Chorus" />);
      expect(screen.getByText("Lancaster Community Chorus")).toBeInTheDocument();
      const img = container.querySelector("img");
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", "/api/public/logo");
      expect(img).toHaveAttribute("alt", "");
    });

    it("falls back to Organization initials when logo fails to load", () => {
      const { container } = render(<PlayerBrand organizationName="Lancaster Community Chorus" />);
      const img = container.querySelector("img");
      expect(img).toBeInTheDocument();

      // Trigger image error
      if (img) fireEvent.error(img);

      expect(container.querySelector("img")).not.toBeInTheDocument();
      expect(screen.getByText("LC")).toBeInTheDocument();
      expect(screen.getByText("Lancaster Community Chorus")).toBeInTheDocument();
    });

    it("renders nothing when organizationName is omitted", () => {
      const { container } = render(<PlayerBrand organizationName={undefined} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("PublicPlayerView integration", () => {
    it("does not show false branding or Choir Management during loading", () => {
      setLocationSearch("?token=test-token");

      // Never resolving promise to test loading state
      vi.spyOn(playerApi, "fetchPlayerDetails").mockReturnValue(
        new Promise<PlayerDetails>(() => undefined),
      );

      render(<PublicPlayerView />);

      expect(screen.getByText("Loading practice player…")).toBeInTheDocument();
      expect(screen.queryByText("Choir Management")).not.toBeInTheDocument();
      expect(screen.queryByText("Lancaster Community Chorus")).not.toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Account" })).not.toBeInTheDocument();
    });

    it("displays Organization branding, event title/date, and updates document title when ready", async () => {
      setLocationSearch("?token=test-token");

      vi.spyOn(playerApi, "fetchPlayerDetails").mockResolvedValue(mockDetails);

      const { container, unmount } = render(<PublicPlayerView />);

      await waitFor(() => {
        expect(screen.getByText("Lancaster Community Chorus")).toBeInTheDocument();
      });

      // Brand logo URL
      const brandLogo = container.querySelector(".public-player__brand-logo");
      expect(brandLogo).toBeInTheDocument();
      expect(brandLogo).toHaveAttribute("src", "/api/public/logo");

      // Event details
      expect(screen.getByText("2026 Christmas Concert")).toBeInTheDocument();
      expect(screen.getByText("Welcome, Alice.")).toBeInTheDocument();

      // No Choir Management fallback or generic site navigation
      expect(screen.queryByText("Choir Management")).not.toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Account" })).not.toBeInTheDocument();
      expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();

      // Browser title includes event and Organization
      expect(document.title).toBe("2026 Christmas Concert · Lancaster Community Chorus");

      // Document title restored on unmount
      unmount();
      expect(document.title).toBe("Original Title");
    });

    it("preserves organizationName in set-list mode", async () => {
      setLocationSearch("?mode=set-list&token=test-token");

      vi.spyOn(playerApi, "fetchPublicPlayerPlaylist").mockResolvedValue(mockDetails);

      render(<PublicPlayerView />);

      await waitFor(() => {
        expect(screen.getByText("Lancaster Community Chorus")).toBeInTheDocument();
      });

      expect(screen.getByText("2026 Christmas Concert")).toBeInTheDocument();
      expect(screen.queryByText("Choir Management")).not.toBeInTheDocument();
    });
  });

  describe("PublicPracticePlayer async voice part race resolution", () => {
    const multiTrackDetails: PlayerDetails = {
      eventArtworkFileId: null,
      eventId: "event-multitrack",
      eventStartsAt: "2026-10-20T19:00:00.000Z",
      eventTitle: "Fall Practice",
      items: [
        {
          composer: "Composer",
          durationSeconds: 180,
          title: "Anthem",
          trackFileIds: {
            s1: "file-s1",
            t2: "file-t2",
            tutti: "file-tutti",
          },
        },
      ],
      organizationName: "Test Chorus",
      performerLabel: "Singer",
      profileName: "Bob",
    };

    it("applies late-arriving roster voice part once loaded if user has not overridden", async () => {
      function Wrapper({ part }: { readonly part?: string | undefined }) {
        return (
          <PublicPracticePlayer
            details={multiTrackDetails}
            initialTrackKey={part}
            source={createTokenTrackSource("token-123")}
          />
        );
      }

      const { container, rerender } = render(<Wrapper part={undefined} />);

      // Initially defaults to tutti before roster part is loaded
      const audioElement = container.querySelector("audio");
      expect(audioElement).toBeInTheDocument();
      expect(audioElement?.getAttribute("src")).toContain("file-tutti");

      // Roster part resolves to "Tenor 2", matching "t2"
      rerender(<Wrapper part="Tenor 2" />);

      await waitFor(() => {
        expect(audioElement?.getAttribute("src")).toContain("file-t2");
      });
    });

    it("calls onTrackKeyChange and retains manual selection even if roster part arrives late", async () => {
      const user = userEvent.setup();
      const onTrackKeyChange = vi.fn();

      function Wrapper({ part }: { readonly part?: string | undefined }) {
        return (
          <PublicPracticePlayer
            details={multiTrackDetails}
            initialTrackKey={part}
            onTrackKeyChange={onTrackKeyChange}
            source={createTokenTrackSource("token-123")}
          />
        );
      }

      const { container, rerender } = render(<Wrapper part={undefined} />);
      const audioElement = container.querySelector("audio");

      // Select S1 manually
      const partSelect = screen.getByRole("combobox", { name: /Voice Part/i });
      await user.selectOptions(partSelect, "s1");

      expect(onTrackKeyChange).toHaveBeenCalledWith("s1");
      expect(audioElement?.getAttribute("src")).toContain("file-s1");

      // Late arrival of roster part "Tenor 2" should NOT override manual selection
      rerender(<Wrapper part="Tenor 2" />);
      expect(audioElement?.getAttribute("src")).toContain("file-s1");
    });

    it("cycles repeat modes: No repeat -> Repeat all -> Repeat one -> No repeat", async () => {
      const user = userEvent.setup();
      render(
        <PublicPracticePlayer
          details={multiTrackDetails}
          source={createTokenTrackSource("token-123")}
        />,
      );

      const repeatBtn = screen.getByRole("button", { name: "No repeat" });
      expect(repeatBtn).toHaveAttribute("aria-pressed", "false");

      await user.click(repeatBtn);
      expect(screen.getByRole("button", { name: "Repeat all" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await user.click(screen.getByRole("button", { name: "Repeat all" }));
      expect(screen.getByRole("button", { name: "Repeat one" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await user.click(screen.getByRole("button", { name: "Repeat one" }));
      expect(screen.getByRole("button", { name: "No repeat" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("resets selection index and cancels gap timer on eventId change", async () => {
      const user = userEvent.setup();
      const twoTrackDetails: PlayerDetails = {
        ...multiTrackDetails,
        items: [
          {
            title: "Track 1",
            trackFileIds: { tutti: "file-1" },
          },
          {
            title: "Track 2",
            trackFileIds: { tutti: "file-2" },
          },
        ],
      };

      function Wrapper({ details }: { readonly details: PlayerDetails }) {
        return (
          <PublicPracticePlayer details={details} source={createTokenTrackSource("token-123")} />
        );
      }

      const { rerender } = render(<Wrapper details={twoTrackDetails} />);
      await user.click(screen.getByRole("button", { name: "Next track" }));
      expect(screen.getByRole("heading", { name: "Track 2" })).toBeInTheDocument();

      // Switch event context
      const newEventDetails: PlayerDetails = {
        ...twoTrackDetails,
        eventId: "event-switched",
      };
      rerender(<Wrapper details={newEventDetails} />);

      // Index resets cleanly to 0 (Track 1)
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Track 1" })).toBeInTheDocument();
      });
    });

    it("preserves playback state and currentTime when offline copy finishes mid-playback", async () => {
      const user = userEvent.setup();
      vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(function (
        this: HTMLMediaElement,
      ) {
        this.dispatchEvent(new Event("play"));
        return Promise.resolve();
      });
      vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(function (
        this: HTMLMediaElement,
      ) {
        this.dispatchEvent(new Event("pause"));
      });

      let currentOfflineUrl: string | null = null;
      vi.spyOn(usePlayerOfflineModule, "useOfflineAudio").mockImplementation(() => ({
        url: currentOfflineUrl,
        contentVersion: null,
      }));

      function Wrapper() {
        return (
          <PublicPracticePlayer
            details={multiTrackDetails}
            source={createTokenTrackSource("token-123")}
          />
        );
      }

      const { container, rerender } = render(<Wrapper />);
      const audioElement = container.querySelector("audio");
      expect(audioElement).toBeInTheDocument();
      if (!audioElement) throw new Error("Audio element not found");

      Object.defineProperty(audioElement, "duration", { value: 180, writable: true });
      fireEvent.loadedMetadata(audioElement);

      // Start playing
      const playButton = screen.getByRole("button", { name: "Play" });
      await user.click(playButton);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
      });

      // Advance currentTime to 45
      Object.defineProperty(audioElement, "currentTime", { value: 45, writable: true });
      fireEvent.timeUpdate(audioElement);
      expect(screen.getByText("0:45")).toBeInTheDocument();

      // Now offline copy finishes resolving for the same track
      currentOfflineUrl = "blob:offline-file-tutti";
      rerender(<Wrapper />);

      // audioSrc changes to blob URL. In browser, loadedmetadata fires on the reloaded element.
      fireEvent.loadedMetadata(audioElement);

      // Verify playback remains active (Pause button still visible)
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
      // Verify currentTime is preserved at 45 (not reset to 0)
      expect(audioElement.currentTime).toBe(45);
      expect(screen.getByText("0:45")).toBeInTheDocument();
    });

    it("automatically recovers playback at currentTime on network reconnect", async () => {
      const user = userEvent.setup();
      const playSpy = vi
        .spyOn(window.HTMLMediaElement.prototype, "play")
        .mockImplementation(function (this: HTMLMediaElement) {
          this.dispatchEvent(new Event("play"));
          return Promise.resolve();
        });
      vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(function (
        this: HTMLMediaElement,
      ) {
        this.dispatchEvent(new Event("pause"));
      });

      const { container } = render(
        <PublicPracticePlayer
          details={multiTrackDetails}
          source={createTokenTrackSource("token-123")}
        />,
      );
      const audioElement = container.querySelector("audio");
      if (!audioElement) throw new Error("Audio element not found");

      Object.defineProperty(audioElement, "duration", { value: 180, writable: true });
      fireEvent.loadedMetadata(audioElement);

      // Start playing
      const playButton = screen.getByRole("button", { name: "Play" });
      await user.click(playButton);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
      });

      // Advance currentTime to 62 seconds (1:02)
      Object.defineProperty(audioElement, "currentTime", { value: 62, writable: true });
      fireEvent.timeUpdate(audioElement);
      expect(screen.getByText("1:02")).toBeInTheDocument();

      // Simulate Wi-Fi drop / network error during playback
      Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
      fireEvent.error(audioElement);

      // Cellular connects: navigator.onLine becomes true and window fires "online"
      act(() => {
        Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
        window.dispatchEvent(new Event("online"));
      });

      // Audio element reloads on reconnection and fires loadedMetadata
      act(() => {
        fireEvent.loadedMetadata(audioElement);
      });

      // Verify playback resumed at 62s without user intervention
      expect(audioElement.currentTime).toBe(62);
      expect(screen.getByText("1:02")).toBeInTheDocument();
      expect(playSpy).toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    });
  });
});

describe("PublicPracticePlayer voice-part nudge", () => {
  const nudgeDetails: PlayerDetails = {
    eventArtworkFileId: null,
    eventId: "event-nudge",
    eventStartsAt: "2026-10-21T19:00:00.000Z",
    eventTitle: "Nudge Rehearsal",
    items: [
      {
        composer: "Composer",
        durationSeconds: 180,
        pieceId: "piece-nudge-1",
        title: "Anthem",
        trackFileIds: {
          s1: "file-s1",
          t2: "file-t2",
          tutti: "file-tutti",
        },
      },
    ],
    organizationName: "Test Chorus",
    performerLabel: "Singer",
    profileName: "Pat",
  };

  const hintText =
    "Your individual part may have its own recording. Select your part above to hear it when available.";

  function renderNudgedPlayer(
    rosterProfile:
      | { status: "loading" | "assigned" | "unassigned" | "unavailable"; voicePart: string | null }
      | undefined,
  ) {
    const source = createTokenTrackSource("token-nudge");
    const utils = render(
      <PublicPracticePlayer details={nudgeDetails} rosterProfile={rosterProfile} source={source} />,
    );
    return { ...utils, audio: utils.container.querySelector("audio") };
  }

  beforeEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it("shows the hint for an unassigned profile with meaningful alternatives", () => {
    renderNudgedPlayer({ status: "unassigned", voicePart: null });

    expect(screen.getByText("Choose yours")).toBeInTheDocument();
    expect(screen.getByText(hintText)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss voice-part tip" })).toBeInTheDocument();
  });

  it("shows the hint for anonymous visitors and full-mix preferences", () => {
    const { unmount } = renderNudgedPlayer({ status: "unavailable", voicePart: null });
    expect(screen.getByText(hintText)).toBeInTheDocument();
    unmount();

    renderNudgedPlayer({ status: "assigned", voicePart: "Choir Mix" });
    expect(screen.getByText(hintText)).toBeInTheDocument();
  });

  it("hides the hint for an assigned individual part and single-choice players", () => {
    const { unmount } = renderNudgedPlayer({ status: "assigned", voicePart: "Tenor 2" });
    expect(screen.queryByText(hintText)).not.toBeInTheDocument();
    unmount();

    const singleKeyDetails: PlayerDetails = {
      ...nudgeDetails,
      items: [
        {
          composer: "Composer",
          durationSeconds: 180,
          pieceId: "piece-solo",
          title: "Solo",
          trackFileIds: { tutti: "file-tutti" },
        },
      ],
    };
    render(
      <PublicPracticePlayer
        details={singleKeyDetails}
        rosterProfile={{ status: "unassigned", voicePart: null }}
        source={createTokenTrackSource("token-nudge")}
      />,
    );
    expect(screen.queryByText(hintText)).not.toBeInTheDocument();
  });

  it("waits out the grace window, then hides on late arrival without changing playback", () => {
    vi.useFakeTimers();
    const { rerender } = renderNudgedPlayer({ status: "loading", voicePart: null });
    expect(screen.queryByText(hintText)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText(hintText)).toBeInTheDocument();
    const audio = document.querySelector("audio");
    expect(audio?.getAttribute("src")).toContain("file-tutti");

    rerender(
      <PublicPracticePlayer
        details={nudgeDetails}
        rosterProfile={{ status: "assigned", voicePart: "Bass 1" }}
        source={createTokenTrackSource("token-nudge")}
      />,
    );
    expect(screen.queryByText(hintText)).not.toBeInTheDocument();
    expect(audio?.getAttribute("src")).toContain("file-tutti");
  });

  it("dismisses on explicit selection of the displayed default and persists the choice", () => {
    renderNudgedPlayer({ status: "unassigned", voicePart: null });
    expect(screen.getByText(hintText)).toBeInTheDocument();

    // Choosing the already-displayed Tutti default still counts as engagement.
    const select = screen.getByRole("combobox", { name: /Voice Part/i });
    fireEvent.change(select, { target: { value: "tutti" } });

    expect(screen.queryByText(hintText)).not.toBeInTheDocument();
    expect(sessionStorage.getItem("choir.voice-part-hint:v1")).toBe("suppressed");
  });

  it("dismisses via the close control, restores focus, and stays hidden on revisit", async () => {
    const user = userEvent.setup();
    const { unmount } = renderNudgedPlayer({ status: "unassigned", voicePart: null });

    await user.click(screen.getByRole("button", { name: "Dismiss voice-part tip" }));
    expect(screen.queryByText(hintText)).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Voice Part/i })).toHaveFocus();
    unmount();

    renderNudgedPlayer({ status: "unassigned", voicePart: null });
    expect(screen.queryByText(hintText)).not.toBeInTheDocument();
  });
});

describe("PublicPracticePlayer persisted part selection", () => {
  const persistDetails: PlayerDetails = {
    eventArtworkFileId: null,
    eventId: "event-persist",
    eventStartsAt: "2026-10-21T19:00:00.000Z",
    eventTitle: "Persist Rehearsal",
    items: [
      {
        composer: "Composer",
        durationSeconds: 180,
        pieceId: "piece-persist-1",
        title: "Anthem",
        trackFileIds: { s1: "file-s1", t2: "file-t2", tutti: "file-tutti" },
      },
    ],
    organizationName: "Test Chorus",
    performerLabel: "Singer",
    profileName: "Pat",
  };

  function renderPersistedPlayer(rosterProfile?: {
    status: "loading" | "assigned" | "unassigned" | "unavailable";
    voicePart: string | null;
  }) {
    const utils = render(
      <PublicPracticePlayer
        details={persistDetails}
        rosterProfile={rosterProfile}
        source={createTokenTrackSource("token-persist")}
      />,
    );
    return { ...utils, audio: utils.container.querySelector("audio") };
  }

  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("retains an explicitly selected part across remounts without a login", () => {
    const { unmount } = renderPersistedPlayer({ status: "unavailable", voicePart: null });
    fireEvent.change(screen.getByRole("combobox", { name: /Voice Part/i }), {
      target: { value: "s1" },
    });
    expect(sessionStorage.getItem("choir.selected-part:v1")).toBe("s1");
    unmount();

    const { audio } = renderPersistedPlayer({ status: "unavailable", voicePart: null });
    expect(audio?.getAttribute("src")).toContain("file-s1");
    expect(screen.getByRole("combobox", { name: /Voice Part/i })).toHaveValue("s1");
  });

  it("falls back to the default when the persisted key does not resolve", () => {
    sessionStorage.setItem("choir.selected-part:v1", "bass9");
    const { audio } = renderPersistedPlayer({ status: "unavailable", voicePart: null });
    expect(audio?.getAttribute("src")).toContain("file-tutti");
  });

  it("applies a persisted selection when no roster part is assigned", () => {
    sessionStorage.setItem("choir.selected-part:v1", "s1");
    const { audio } = renderPersistedPlayer({ status: "unassigned", voicePart: null });
    // Sanity: without an assigned roster part the persisted pick applies.
    expect(audio?.getAttribute("src")).toContain("file-s1");
  });

  it("lets an assigned roster part win over a persisted manual choice", () => {
    sessionStorage.setItem("choir.selected-part:v1", "s1");
    const { container } = render(
      <PublicPracticePlayer
        details={persistDetails}
        initialTrackKey="Tenor 2"
        rosterProfile={{ status: "assigned", voicePart: "Tenor 2" }}
        source={createTokenTrackSource("token-persist")}
      />,
    );
    expect(container.querySelector("audio")?.getAttribute("src")).toContain("file-t2");
  });
});

describe("PublicPracticePlayer per-song track pins", () => {
  const pinnedDetails: PlayerDetails = {
    eventId: "event-pins",
    eventStartsAt: "2026-10-27T19:00:00.000Z",
    eventTitle: "Pinned Tracks",
    items: [
      {
        pieceId: "piece-pinned-1",
        title: "Lux Aurumque",
        trackFileIds: { t1: "file-lux-t1", t2: "file-lux-t2", tutti: "file-lux-mix" },
      },
      {
        pieceId: "piece-default-2",
        title: "Bogoroditse Devo",
        trackFileIds: { t1: "file-bog-t1", t2: "file-bog-t2", tutti: "file-bog-mix" },
      },
    ],
  };
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  let pinnedStorage: ReturnType<typeof createPinnedStorage>;

  function createPinnedStorage() {
    const records = new Map<string, string>();
    return {
      clear: () => {
        records.clear();
      },
      getItem: (key: string) => records.get(key) ?? null,
      key: (index: number) => [...records.keys()][index] ?? null,
      get length() {
        return records.size;
      },
      removeItem: (key: string) => {
        records.delete(key);
      },
      setItem: (key: string, value: string) => {
        records.set(key, value);
      },
    };
  }

  function renderPinnedPlayer() {
    const utils = render(
      <PublicPracticePlayer
        details={pinnedDetails}
        initialTrackKey="t1"
        source={createTokenTrackSource("token-pins")}
      />,
    );
    return { ...utils, audio: utils.container.querySelector("audio") };
  }

  beforeEach(() => {
    installIndexedDatabase();
    pinnedStorage = createPinnedStorage();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: pinnedStorage,
    });
    sessionStorage.removeItem("choir.selected-part:v1");
  });

  afterEach(() => {
    if (localStorageDescriptor) {
      Object.defineProperty(window, "localStorage", localStorageDescriptor);
    } else {
      Reflect.deleteProperty(window, "localStorage");
    }
    sessionStorage.removeItem("choir.selected-part:v1");
    vi.restoreAllMocks();
  });

  it("stores the latest 200 piece overrides and safely ignores storage failures", () => {
    for (let index = 0; index < 205; index += 1) {
      writePinnedPieceTrack(`piece-${String(index)}`, `t${String(index)}`);
    }
    const stored = readPinnedPieceTracks();
    expect(Object.keys(stored)).toHaveLength(200);
    expect(stored["piece-0"]).toBeUndefined();
    expect(stored["piece-204"]).toBe("t204");

    clearPinnedPieceTrack("piece-204");
    expect(readPinnedPieceTracks()["piece-204"]).toBeUndefined();

    vi.spyOn(pinnedStorage, "setItem").mockImplementation(() => {
      throw new Error("storage full");
    });
    expect(() => {
      writePinnedPieceTrack("piece-failure", "t1");
    }).not.toThrow();

    const failedSetItem = vi.mocked(pinnedStorage.setItem);
    failedSetItem.mockClear();
    const removeItem = vi.spyOn(pinnedStorage, "removeItem");
    vi.spyOn(pinnedStorage, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(() => {
      writePinnedPieceTrack("piece-read-failure", "t1");
      clearPinnedPieceTrack("piece-1");
    }).not.toThrow();
    expect(failedSetItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("plays and persists a per-song override without changing the global default", async () => {
    const user = userEvent.setup();
    const { audio, container, unmount } = renderPinnedPlayer();
    expect(audio?.getAttribute("src")).toContain("file-lux-t1");

    const trackPill = container.querySelector(
      ".public-player__desktop-panel .public-player__piece-track-picker-trigger",
    );
    if (!trackPill) throw new Error("Set-list track picker was not rendered");
    expect(trackPill.tagName).toBe("BUTTON");
    expect(trackPill.closest(".public-player__set-list-item")).toBeNull();
    await user.click(trackPill);
    const picker = trackPill.closest(".public-player__piece-track-picker");
    if (!(picker instanceof HTMLElement)) {
      throw new Error("Set-list track picker disclosure was not rendered");
    }
    await user.click(within(picker).getByRole("button", { name: "Tenor 2" }));

    expect(await screen.findByText("Pinned to Tenor 2 for this song")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Voice Part" })).toHaveValue("t1");
    expect(screen.getByRole("link", { name: "Download Lux Aurumque" })).toHaveAttribute(
      "href",
      expect.stringContaining("file-lux-t2"),
    );
    expect(readPinnedPieceTracks()["piece-pinned-1"]).toBe("t2");
    unmount();

    const remounted = renderPinnedPlayer();
    expect(remounted.audio?.getAttribute("src")).toContain("file-lux-t2");
    const badge = screen.getByRole("button", { name: /Choose track for Lux Aurumque/ });
    await user.click(badge);
    await screen.findByRole("dialog", { name: "Choose Voice Part" });
    expect(screen.getByRole("tab", { name: "Just this song" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{Escape}");
    expect(badge).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Next track" }));
    await waitFor(() => {
      expect(remounted.audio?.getAttribute("src")).toContain("file-bog-t1");
    });
    await user.selectOptions(screen.getByRole("combobox", { name: "Voice Part" }), "tutti");
    await user.click(screen.getByRole("button", { name: "Next track" }));
    await waitFor(() => {
      expect(remounted.audio?.getAttribute("src")).toContain("file-bog-mix");
    });
    await user.click(screen.getByRole("button", { name: "Previous track" }));
    await waitFor(() => {
      expect(remounted.audio?.getAttribute("src")).toContain("file-lux-t2");
    });

    await user.click(screen.getByRole("button", { name: "Use Choir Mix" }));
    await waitFor(() => {
      expect(remounted.audio?.getAttribute("src")).toContain("file-lux-mix");
    });
    expect(readPinnedPieceTracks()["piece-pinned-1"]).toBeUndefined();
    expect(screen.queryByText("Pinned to Tenor 2 for this song")).not.toBeInTheDocument();
  });
});
