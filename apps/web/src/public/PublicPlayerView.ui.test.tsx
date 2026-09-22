import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlayerBrand, type PlayerDetails } from "./player";
import { PublicPlayerView } from "./PublicPlayerView";
import * as playerApi from "./player/api";

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
});
