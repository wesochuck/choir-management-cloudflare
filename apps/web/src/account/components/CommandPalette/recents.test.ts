import { beforeEach, describe, expect, it } from "vitest";

import { addRecentSearch, clearRecentSearches, getRecentSearches } from "./recents";

interface MockLocalStorage {
  clear(): void;
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

describe("Command Palette Recents", () => {
  const hostname = "test-chorus.app";
  let storageMap: Map<string, string>;

  beforeEach(() => {
    storageMap = new Map<string, string>();
    const mockStorage: MockLocalStorage = {
      clear() {
        storageMap.clear();
      },
      getItem(key: string) {
        return storageMap.get(key) ?? null;
      },
      removeItem(key: string) {
        storageMap.delete(key);
      },
      setItem(key: string, value: string) {
        storageMap.set(key, value);
      },
    };

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: mockStorage },
      writable: true,
    });
  });

  it("adds and retrieves recent searches", () => {
    expect(getRecentSearches(hostname)).toEqual([]);

    addRecentSearch(hostname, {
      category: "roster",
      href: "/admin/roster?profileId=123",
      id: "roster-123",
      subtitle: "Tenor 1",
      title: "John Doe",
    });

    const recents = getRecentSearches(hostname);
    expect(recents).toHaveLength(1);
    expect(recents[0]?.title).toBe("John Doe");
    expect(recents[0]?.category).toBe("roster");
  });

  it("deduplicates recent searches and moves most recent to front", () => {
    addRecentSearch(hostname, {
      category: "roster",
      id: "roster-1",
      title: "Alice",
    });
    addRecentSearch(hostname, {
      category: "events",
      id: "event-2",
      title: "Spring Concert",
    });
    addRecentSearch(hostname, {
      category: "roster",
      id: "roster-1",
      title: "Alice",
    });

    const recents = getRecentSearches(hostname);
    expect(recents).toHaveLength(2);
    expect(recents[0]?.title).toBe("Alice");
    expect(recents[1]?.title).toBe("Spring Concert");
  });

  it("clears recents for the specific hostname", () => {
    addRecentSearch(hostname, {
      category: "music",
      id: "music-1",
      title: "Ave Maria",
    });
    expect(getRecentSearches(hostname)).toHaveLength(1);

    clearRecentSearches(hostname);
    expect(getRecentSearches(hostname)).toEqual([]);
  });

  it("isolates recents between workspaces", () => {
    addRecentSearch(
      hostname,
      {
        category: "navigation",
        href: "/admin/tickets",
        id: "nav-ticketing",
        title: "Ticket Sales & Orders",
      },
      "organization",
    );

    addRecentSearch(
      hostname,
      {
        category: "navigation",
        href: "/schedule",
        id: "nav-member-schedule",
        title: "My Schedule",
      },
      "member",
    );

    const adminRecents = getRecentSearches(hostname, "organization");
    expect(adminRecents).toHaveLength(1);
    expect(adminRecents[0]?.title).toBe("Ticket Sales & Orders");

    const memberRecents = getRecentSearches(hostname, "member");
    expect(memberRecents).toHaveLength(1);
    expect(memberRecents[0]?.title).toBe("My Schedule");

    // Clearing member recents does not affect admin recents
    clearRecentSearches(hostname, "member");
    expect(getRecentSearches(hostname, "member")).toEqual([]);
    expect(getRecentSearches(hostname, "organization")).toHaveLength(1);
  });
});
