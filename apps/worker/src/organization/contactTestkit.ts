import type { SqlStorageValue } from "@cloudflare/workers-types";
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";

import { ContactStoreError, type ContactStoreStorage } from "./contactStore";
import { organizationSchemaMigrations } from "./schema/migrations";

export const DEFAULT_CONTACT_TEST_ORG_ID = "org-contacts-test";
export const DEFAULT_CONTACT_TEST_ACTOR_ID = "user-tester-001";

export function toSupportedValue(value: unknown): null | number | bigint | string | Uint8Array {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "string" ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new Error(`Unsupported SQLite binding type: ${typeof value}`);
}

export function isReadQuery(query: string): boolean {
  const normalized = query.trim().toUpperCase();
  return (
    normalized.startsWith("SELECT") ||
    normalized.startsWith("PRAGMA") ||
    normalized.startsWith("EXPLAIN") ||
    normalized.startsWith("WITH")
  );
}

export function isRowArray<T>(value: unknown, fallback: readonly T[]): value is T[] {
  return Array.isArray(value) && fallback.length >= 0;
}

export function dbAllUnknown(
  db: DatabaseSync,
  query: string,
  ...params: readonly unknown[]
): unknown[] {
  const raw: unknown = db.prepare(query).all(...params.map(toSupportedValue));
  return Array.isArray(raw) ? raw : [];
}

export function descriptorValue(row: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(row, key)?.value;
}

export function isCountRow(value: unknown): value is { readonly count: number } {
  if (typeof value !== "object" || value === null) return false;
  if (!("count" in value)) return false;
  return typeof descriptorValue(value, "count") === "number";
}

export function isNameRow(value: unknown): value is { readonly name: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("name" in value)) return false;
  return typeof descriptorValue(value, "name") === "string";
}

export function isVersionRow(value: unknown): value is { readonly version: number } {
  if (typeof value !== "object" || value === null) return false;
  if (!("version" in value)) return false;
  return typeof descriptorValue(value, "version") === "number";
}

export function isChangeSummaryRow(value: unknown): value is { readonly changeSummary: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("changeSummary" in value)) return false;
  return typeof descriptorValue(value, "changeSummary") === "string";
}

export function isPlanDetailRow(value: unknown): value is { readonly detail: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("detail" in value)) return false;
  return typeof descriptorValue(value, "detail") === "string";
}

export function countFor(db: DatabaseSync, query: string, ...params: readonly unknown[]): number {
  for (const row of dbAllUnknown(db, query, ...params)) {
    if (isCountRow(row)) return row.count;
  }
  return 0;
}

export interface ContactTestContext {
  readonly db: DatabaseSync;
  readonly queryCount: () => number;
  readonly resetQueryCount: () => void;
  readonly storage: ContactStoreStorage;
}

export function createContactTestAdapter(db: DatabaseSync): ContactTestContext {
  let count = 0;
  const exec = <T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: readonly unknown[]
  ): { readonly one: () => T; readonly toArray: () => T[] } & Iterable<T> => {
    count += 1;
    const statement = db.prepare(query);
    const params = bindings.map(toSupportedValue);
    if (isReadQuery(query)) {
      const rawRows: unknown = statement.all(...params);
      const fallback: readonly T[] = [];
      const rows: T[] = isRowArray(rawRows, fallback) ? rawRows : [];
      return {
        *[Symbol.iterator]() {
          yield* rows;
        },
        one(): T {
          const first = rows[0];
          if (first === undefined) throw new Error("Expected exactly one row.");
          return first;
        },
        toArray(): T[] {
          return rows;
        },
      };
    }
    statement.run(...params);
    const empty: T[] = [];
    return {
      *[Symbol.iterator]() {
        yield* empty;
      },
      one(): T {
        throw new Error("Expected exactly one row.");
      },
      toArray(): T[] {
        return empty;
      },
    };
  };

  let depth = 0;
  const storage: ContactStoreStorage = {
    sql: { exec },
    transactionSync<T>(fn: () => T): T {
      if (depth > 0) return fn();
      db.exec("BEGIN");
      depth += 1;
      try {
        const result = fn();
        depth -= 1;
        db.exec("COMMIT");
        return result;
      } catch (error: unknown) {
        depth -= 1;
        try {
          db.exec("ROLLBACK");
        } catch {
          // Preserve the original error when rollback itself fails.
        }
        throw error;
      }
    },
  };
  return {
    db,
    queryCount: () => count,
    resetQueryCount: () => {
      count = 0;
    },
    storage,
  };
}

export function runMigrations(db: DatabaseSync, upToVersion?: number): void {
  db.exec(`CREATE TABLE IF NOT EXISTS organization_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT`);
  const applied = new Set<number>();
  for (const row of dbAllUnknown(db, "SELECT version FROM organization_schema_migrations")) {
    if (isVersionRow(row)) applied.add(row.version);
  }
  for (const migration of organizationSchemaMigrations) {
    if (upToVersion !== undefined && migration.version > upToVersion) continue;
    if (applied.has(migration.version)) continue;
    for (const statement of migration.statements) {
      db.exec(statement);
    }
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO organization_schema_migrations (version, applied_at) VALUES (?, ?)",
    ).run(migration.version, now);
    applied.add(migration.version);
  }
}

export function seedOrganization(db: DatabaseSync, organizationId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO organization_metadata
      (organization_id, name, slug, lifecycle_state, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)`,
  ).run(organizationId, "Contacts Test Org", "contacts-test", now, now);
}

export function seedProfile(db: DatabaseSync, profileId: string, displayName: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(profileId, displayName, now, now);
}

export function createFreshContactContext(
  organizationId: string = DEFAULT_CONTACT_TEST_ORG_ID,
): ContactTestContext {
  const db = new DatabaseSync(":memory:");
  const context = createContactTestAdapter(db);
  runMigrations(db);
  seedOrganization(db, organizationId);
  context.resetQueryCount();
  return context;
}

export function uuidFor(index: number, prefix = "aaaaaaaa-aaaa-4aaa-8aaa"): string {
  return `${prefix}-${index.toString(16).padStart(12, "0")}`;
}

export function expectContactStoreError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error: unknown) {
    if (error instanceof ContactStoreError) {
      expect(error.code).toBe(code);
      return;
    }
    throw new Error(`Expected ContactStoreError with code ${code}.`, { cause: error });
  }
  throw new Error(`Expected ContactStoreError with code ${code}.`);
}
