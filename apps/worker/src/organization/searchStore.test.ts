import { searchResultItemSchema } from "@choir/contracts";
import type { SqlStorageValue } from "@cloudflare/workers-types";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { searchOrganizationEntitiesFromStore, type SearchStoreStorage } from "./searchStore";

const storeSearchResponseSchema = z.object({
  results: z.array(searchResultItemSchema),
});

function isRowArray<T>(value: unknown): value is T[] {
  return Array.isArray(value);
}

function createMockStorage(organizationId: string): SearchStoreStorage {
  return {
    sql: {
      exec: <T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
        query: string,
      ) => {
        let rows: readonly Record<string, SqlStorageValue>[] = [];

        if (query.includes("organization_metadata")) {
          rows = [{ organizationId }];
        } else if (query.includes("FROM profiles")) {
          rows = [
            {
              displayName: "Jane Doe",
              globalStatus: "Active",
              id: "prof-1",
              voicePart: "Alto 1",
            },
          ];
        } else if (query.includes("FROM events")) {
          rows = [
            {
              id: "event-1",
              location: "Sanctuary",
              startsAt: "2026-10-15T19:00:00Z",
              title: "Fall Rehearsal",
              type: "Rehearsal",
            },
          ];
        } else if (query.includes("FROM music_pieces")) {
          rows = [
            {
              arranger: "Shaw",
              composer: "Traditional",
              id: "piece-1",
              title: "Sing We Now of Christmas",
            },
          ];
        } else if (query.includes("FROM polls")) {
          rows = [
            {
              expiresAt: "2026-11-01T00:00:00Z",
              id: "poll-1",
              title: "Holiday Party Date",
            },
          ];
        }

        return {
          toArray: () => (isRowArray<T>(rows) ? rows : []),
        };
      },
    },
  };
}

describe("searchOrganizationEntitiesFromStore", () => {
  it("rejects mismatched organization identity", () => {
    const mockStorage = createMockStorage("org-correct");

    const response = searchOrganizationEntitiesFromStore(mockStorage, {
      organizationId: "org-wrong",
      query: "test",
    });

    expect(response.status).toBe(409);
  });

  it("returns empty results for empty queries", async () => {
    const mockStorage = createMockStorage("org-1");

    const response = searchOrganizationEntitiesFromStore(mockStorage, {
      organizationId: "org-1",
      query: "   ",
    });

    expect(response.status).toBe(200);
    const parsed = storeSearchResponseSchema.parse(await response.json());
    expect(parsed).toEqual({ results: [] });
  });

  it("queries and maps profiles, events, music, and polls results", async () => {
    const mockStorage = createMockStorage("org-1");

    const response = searchOrganizationEntitiesFromStore(mockStorage, {
      organizationId: "org-1",
      query: "sing",
    });

    expect(response.status).toBe(200);
    const parsed = storeSearchResponseSchema.parse(await response.json());
    expect(parsed.results).toHaveLength(4);
    expect(parsed.results[0]?.category).toBe("roster");
    expect(parsed.results[0]?.title).toBe("Jane Doe");
    expect(parsed.results[0]?.subtitle).toBe("Alto 1");
    expect(parsed.results[1]?.category).toBe("events");
    expect(parsed.results[1]?.title).toBe("Fall Rehearsal");
    expect(parsed.results[1]?.subtitle).toBe("Rehearsal • 2026-10-15 • Sanctuary");
    expect(parsed.results[2]?.category).toBe("music");
    expect(parsed.results[2]?.title).toBe("Sing We Now of Christmas");
    expect(parsed.results[3]?.category).toBe("polls");
    expect(parsed.results[3]?.title).toBe("Holiday Party Date");
  });

  it("supports querying with profileIds", async () => {
    const mockStorage = createMockStorage("org-1");

    const response = searchOrganizationEntitiesFromStore(mockStorage, {
      organizationId: "org-1",
      profileIds: ["prof-1"],
      query: "jane",
    });

    expect(response.status).toBe(200);
    const parsed = storeSearchResponseSchema.parse(await response.json());
    expect(parsed.results[0]?.title).toBe("Jane Doe");
  });
});
