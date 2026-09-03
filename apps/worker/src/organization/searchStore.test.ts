import { searchResultItemSchema } from "@choir/contracts";
import type { SqlStorageValue } from "@cloudflare/workers-types";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { organizationSchemaMigrations } from "./schema/migrations";
import { searchOrganizationEntitiesFromStore, type SearchStoreStorage } from "./searchStore";

const storeSearchResponseSchema = z.object({
  results: z.array(searchResultItemSchema),
});

function toSupportedValue(v: unknown): null | number | bigint | string | Uint8Array {
  if (
    v === null ||
    typeof v === "number" ||
    typeof v === "bigint" ||
    typeof v === "string" ||
    v instanceof Uint8Array
  ) {
    return v;
  }
  if (typeof v === "boolean") {
    return v ? 1 : 0;
  }
  throw new Error(`Unsupported SQLite binding type: ${typeof v}`);
}

function isRowArray<T>(value: unknown, fallback: readonly T[]): value is T[] {
  return Array.isArray(value) && fallback.length >= 0;
}

function createRealSqliteStorage(organizationId: string): {
  storage: SearchStoreStorage;
  db: DatabaseSync;
} {
  const db = new DatabaseSync(":memory:");
  for (const migration of organizationSchemaMigrations) {
    for (const statement of migration.statements) {
      db.exec(statement);
    }
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO organization_metadata
       (organization_id, name, slug, lifecycle_state, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)`,
  ).run(organizationId, "Test Organization", "test-org", now, now);

  const storage: SearchStoreStorage = {
    sql: {
      exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
        query: string,
        ...bindings: readonly unknown[]
      ) {
        const stmt = db.prepare(query);
        const params = bindings.map(toSupportedValue);
        const rawRows = stmt.all(...params);
        const fallback: readonly T[] = [];
        return {
          toArray(): T[] {
            return isRowArray(rawRows, fallback) ? rawRows : [];
          },
        };
      },
    },
  };

  return { db, storage };
}

function seedTestData(db: DatabaseSync): void {
  const now = new Date().toISOString();

  // Seed profiles
  const insertProfile = db.prepare(
    `INSERT INTO profiles
       (id, display_name, phone, voice_part, global_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insertProfile.run("prof-jane", "Jane Doe", "555-0199", "Alto 1", "Active", now, now);
  insertProfile.run("prof-john", "John Smith", "555-0144", "Tenor 2", "Idle", now, now);

  // Seed events (one active, one archived)
  const insertEvent = db.prepare(
    `INSERT INTO events
       (id, title, type, starts_at, duration_minutes, call_time, location,
        venue_id, parent_performance_id, details, set_list_json, set_list_approved,
        is_archived, public_graphic_file_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 90, '', ?, NULL, NULL, '', '[]', 1, ?, NULL, ?, ?)`,
  );
  insertEvent.run(
    "event-active",
    "Fall Concert",
    "Performance",
    "2026-11-15T19:00:00Z",
    "Symphony Hall",
    0,
    now,
    now,
  );
  insertEvent.run(
    "event-archived",
    "Past Concert",
    "Performance",
    "2025-11-15T19:00:00Z",
    "Old Hall",
    1,
    now,
    now,
  );

  // Seed music pieces
  const insertPiece = db.prepare(
    `INSERT INTO music_pieces
       (id, title, composer, arranger, duration_seconds, notes, section_buckets_json,
        genres_json, track_file_ids_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 240, '', '[]', '[]', '{}', ?, ?)`,
  );
  insertPiece.run("piece-1", "Sing We Now of Christmas", "Traditional", "Shaw", now, now);

  // Seed polls (one active, one archived)
  const insertPoll = db.prepare(
    `INSERT INTO polls
       (id, title, description, multiple_choice, expires_at, archived_at,
        created_by, created_at, updated_at)
     VALUES (?, ?, '', 0, ?, ?, 'prof-jane', ?, ?)`,
  );
  insertPoll.run("poll-active", "Holiday Party Date", "2026-12-01T00:00:00Z", "", now, now);
  insertPoll.run(
    "poll-archived",
    "Old Summer Picnic",
    "2025-06-01T00:00:00Z",
    "2025-06-02T00:00:00Z",
    now,
    now,
  );
}

function isTableInfoRow(row: unknown): row is { name: string } {
  if (typeof row !== "object" || row === null) return false;
  if (!("name" in row)) return false;
  const nameVal = Object.getOwnPropertyDescriptor(row, "name")?.value;
  return typeof nameVal === "string";
}

describe("searchOrganizationEntitiesFromStore with real SQLite", () => {
  it("rejects mismatched organization identity with 409", () => {
    const { storage } = createRealSqliteStorage("org-correct");
    const response = searchOrganizationEntitiesFromStore(storage, {
      organizationId: "org-wrong",
      query: "test",
    });
    expect(response.status).toBe(409);
  });

  it("returns empty results for empty queries when no profileIds provided", async () => {
    const { storage } = createRealSqliteStorage("org-1");
    const response = searchOrganizationEntitiesFromStore(storage, {
      organizationId: "org-1",
      query: "   ",
    });

    expect(response.status).toBe(200);
    const parsed = storeSearchResponseSchema.parse(await response.json());
    expect(parsed).toEqual({ results: [] });
  });

  it("searches roster by display_name", async () => {
    const { db, storage } = createRealSqliteStorage("org-1");
    seedTestData(db);

    const response = searchOrganizationEntitiesFromStore(storage, {
      organizationId: "org-1",
      query: "Jane",
    });

    expect(response.status).toBe(200);
    const parsed = storeSearchResponseSchema.parse(await response.json());
    expect(parsed.results.some((r) => r.id === "roster-prof-jane" && r.title === "Jane Doe")).toBe(
      true,
    );
  });

  it("searches roster by voice_part", async () => {
    const { db, storage } = createRealSqliteStorage("org-1");
    seedTestData(db);

    const response = searchOrganizationEntitiesFromStore(storage, {
      category: "roster",
      organizationId: "org-1",
      query: "Alto",
    });

    expect(response.status).toBe(200);
    const parsed = storeSearchResponseSchema.parse(await response.json());
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]?.id).toBe("roster-prof-jane");
    expect(parsed.results[0]?.subtitle).toBe("Alto 1");
  });

  it("searches roster by phone", async () => {
    const { db, storage } = createRealSqliteStorage("org-1");
    seedTestData(db);

    const response = searchOrganizationEntitiesFromStore(storage, {
      category: "roster",
      organizationId: "org-1",
      query: "555-0144",
    });

    expect(response.status).toBe(200);
    const parsed = storeSearchResponseSchema.parse(await response.json());
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]?.id).toBe("roster-prof-john");
    expect(parsed.results[0]?.title).toBe("John Smith");
    expect(parsed.results[0]?.badge).toBe("Idle");
  });

  it("matches profiles through options.profileIds email bridge even when query does not match text", async () => {
    const { db, storage } = createRealSqliteStorage("org-1");
    seedTestData(db);

    const response = searchOrganizationEntitiesFromStore(storage, {
      organizationId: "org-1",
      profileIds: ["prof-john"],
      query: "unmatched-string",
    });

    expect(response.status).toBe(200);
    const parsed = storeSearchResponseSchema.parse(await response.json());
    expect(parsed.results.some((r) => r.id === "roster-prof-john")).toBe(true);
  });

  it("searches events and excludes archived events", async () => {
    const { db, storage } = createRealSqliteStorage("org-1");
    seedTestData(db);

    const response = searchOrganizationEntitiesFromStore(storage, {
      category: "events",
      organizationId: "org-1",
      query: "Concert",
    });

    expect(response.status).toBe(200);
    const parsed = storeSearchResponseSchema.parse(await response.json());
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]?.id).toBe("event-event-active");
    expect(parsed.results[0]?.title).toBe("Fall Concert");
  });

  it("searches music pieces by title, composer, and arranger", async () => {
    const { db, storage } = createRealSqliteStorage("org-1");
    seedTestData(db);

    for (const query of ["Christmas", "Traditional", "Shaw"]) {
      const response = searchOrganizationEntitiesFromStore(storage, {
        category: "music",
        organizationId: "org-1",
        query,
      });
      expect(response.status).toBe(200);
      const parsed = storeSearchResponseSchema.parse(await response.json());
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0]?.id).toBe("music-piece-1");
      expect(parsed.results[0]?.subtitle).toBe("Composer: Traditional • Arr: Shaw");
    }
  });

  it("searches polls and excludes archived polls", async () => {
    const { db, storage } = createRealSqliteStorage("org-1");
    seedTestData(db);

    const activeResponse = searchOrganizationEntitiesFromStore(storage, {
      category: "polls",
      organizationId: "org-1",
      query: "Holiday Party",
    });
    expect(activeResponse.status).toBe(200);
    const activeParsed = storeSearchResponseSchema.parse(await activeResponse.json());
    expect(activeParsed.results).toHaveLength(1);
    expect(activeParsed.results[0]?.id).toBe("poll-poll-active");

    const archivedResponse = searchOrganizationEntitiesFromStore(storage, {
      category: "polls",
      organizationId: "org-1",
      query: "Summer Picnic",
    });
    expect(archivedResponse.status).toBe(200);
    const archivedParsed = storeSearchResponseSchema.parse(await archivedResponse.json());
    expect(archivedParsed.results).toHaveLength(0);
  });

  it("clamps limit between 1 and 50", async () => {
    const { db, storage } = createRealSqliteStorage("org-1");
    seedTestData(db);

    // Limit 0 should clamp to 1
    const responseZero = searchOrganizationEntitiesFromStore(storage, {
      limit: 0,
      organizationId: "org-1",
      query: "o", // matches Doe, John, Concert, etc.
    });
    expect(responseZero.status).toBe(200);
    const parsedZero = storeSearchResponseSchema.parse(await responseZero.json());
    expect(parsedZero.results.length).toBeLessThanOrEqual(1);

    // Limit 100 should clamp to 50
    const responseHigh = searchOrganizationEntitiesFromStore(storage, {
      limit: 100,
      organizationId: "org-1",
      query: "o",
    });
    expect(responseHigh.status).toBe(200);
    const parsedHigh = storeSearchResponseSchema.parse(await responseHigh.json());
    expect(parsedHigh.results.length).toBeLessThanOrEqual(50);
  });

  it("verifies static schema columns against real migration DDL", () => {
    const { db } = createRealSqliteStorage("org-verify");

    const expectedColumnsByTable: Record<string, string[]> = {
      events: ["id", "title", "type", "starts_at", "location", "is_archived"],
      music_pieces: ["id", "title", "composer", "arranger"],
      organization_metadata: ["organization_id"],
      polls: ["id", "title", "expires_at", "archived_at", "created_at"],
      profiles: ["id", "display_name", "voice_part", "global_status", "phone"],
    };

    for (const [table, columns] of Object.entries(expectedColumnsByTable)) {
      const tableInfo = db.prepare(`PRAGMA table_info(${table})`).all().filter(isTableInfoRow);
      const existingColumnNames = new Set(tableInfo.map((c) => c.name));
      for (const col of columns) {
        expect(
          existingColumnNames.has(col),
          `Column "${col}" was expected in table "${table}", but was not found in real migrations DDL.`,
        ).toBe(true);
      }
    }
  });
});
