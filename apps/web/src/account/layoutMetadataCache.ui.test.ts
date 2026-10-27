import { beforeEach, describe, expect, it } from "vitest";

import {
  clearAuthenticatedLayoutMetadata,
  readAuthenticatedLayoutMetadata,
  updateAuthenticatedLayoutMetadata,
  writeAuthenticatedLayoutModules,
} from "./layoutMetadataCache";

describe("authenticated layout metadata cache", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("scopes metadata by host and user and merges fresh layout values", () => {
    const modules = [
      { id: "practice_player", enabled: false, label: "Practice" },
      { id: "roster", enabled: true },
    ];
    writeAuthenticatedLayoutModules("chorus.example.test", "user-a", modules);
    updateAuthenticatedLayoutMetadata("chorus.example.test", "user-a", {
      logoFileId: "logo-id",
      organizationName: "Test Chorus",
      performerLabel: "Singer",
      rosterStructure: "sections_only",
    });

    expect(readAuthenticatedLayoutMetadata("chorus.example.test", "user-a")).toEqual({
      host: "chorus.example.test",
      logoFileId: "logo-id",
      modules,
      organizationName: "Test Chorus",
      performerLabel: "Singer",
      rosterStructure: "sections_only",
      userId: "user-a",
      version: 2,
    });
    expect(readAuthenticatedLayoutMetadata("other.example.test", "user-a")).toBeNull();
    expect(readAuthenticatedLayoutMetadata("chorus.example.test", "user-b")).toBeNull();
  });

  it("keeps module readiness unknown until a module snapshot is stored", () => {
    updateAuthenticatedLayoutMetadata("chorus.example.test", "user-a", {
      organizationName: "Test Chorus",
    });

    expect(readAuthenticatedLayoutMetadata("chorus.example.test", "user-a")?.modules).toBeNull();
  });

  it("removes malformed cached values and clears only the matching identity", () => {
    updateAuthenticatedLayoutMetadata("chorus.example.test", "user-a", {
      modules: [{ id: "roster", enabled: true }],
    });
    updateAuthenticatedLayoutMetadata("chorus.example.test", "user-b", {
      modules: [{ id: "roster", enabled: false }],
    });

    clearAuthenticatedLayoutMetadata("chorus.example.test", "user-a");
    expect(readAuthenticatedLayoutMetadata("chorus.example.test", "user-a")).toBeNull();
    expect(readAuthenticatedLayoutMetadata("chorus.example.test", "user-b")?.modules).toEqual([
      { id: "roster", enabled: false },
    ]);

    const key = Object.keys(window.sessionStorage).find((entry) => entry.includes("user-b"));
    expect(key).toBeDefined();
    if (key) window.sessionStorage.setItem(key, "not-json");
    expect(readAuthenticatedLayoutMetadata("chorus.example.test", "user-b")).toBeNull();
  });
});
