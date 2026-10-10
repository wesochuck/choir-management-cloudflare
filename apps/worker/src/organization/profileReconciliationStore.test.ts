import type { SqlStorageValue } from "@cloudflare/workers-types";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { organizationSchemaMigrations } from "./schema/migrations";
import {
  commitProfileReconciliationInStore,
  findReconciliationCandidatesInStore,
  prepareProfileReconciliationInStore,
  previewProfileReconciliationInStore,
  resolveCanonicalProfileId,
  type ProfileReconciliationStoreStorage,
} from "./organizationStore/profileReconciliation";

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

interface ProfileCheckRow {
  readonly hidden: number;
  readonly merged_into_profile_id: string | null;
  readonly notes: string;
  readonly phone: string;
}

function isProfileCheckRow(val: unknown): val is ProfileCheckRow {
  return (
    typeof val === "object" &&
    val !== null &&
    "hidden" in val &&
    "merged_into_profile_id" in val &&
    "notes" in val &&
    "phone" in val
  );
}

interface EventRosterCheckRow {
  readonly attendance: string;
  readonly folder_number: string;
  readonly rsvp: string;
}

function isEventRosterCheckRow(val: unknown): val is EventRosterCheckRow {
  return (
    typeof val === "object" &&
    val !== null &&
    "rsvp" in val &&
    "attendance" in val &&
    "folder_number" in val
  );
}

interface SeatingChartCheckRow {
  readonly assignments_json: string;
}

function isSeatingChartCheckRow(val: unknown): val is SeatingChartCheckRow {
  return (
    typeof val === "object" &&
    val !== null &&
    "assignments_json" in val &&
    typeof val.assignments_json === "string"
  );
}

interface ProfileSuppressionCheckRow {
  readonly provider_email_suppressed: number;
  readonly provider_email_suppressed_reason: string;
}

function isProfileSuppressionCheckRow(val: unknown): val is ProfileSuppressionCheckRow {
  return (
    typeof val === "object" &&
    val !== null &&
    "provider_email_suppressed" in val &&
    "provider_email_suppressed_reason" in val
  );
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

interface CountCheckRow {
  readonly count: number;
}

function isCountCheckRow(val: unknown): val is CountCheckRow {
  return typeof val === "object" && val !== null && "count" in val;
}

interface ContactOwnerCheckRow {
  readonly profile_id: string;
}

function isContactOwnerCheckRow(val: unknown): val is ContactOwnerCheckRow {
  return typeof val === "object" && val !== null && "profile_id" in val;
}

interface RetirementCheckRow {
  readonly hidden: number;
  readonly merged_into_profile_id: string | null;
}

function isRetirementCheckRow(val: unknown): val is RetirementCheckRow {
  return (
    typeof val === "object" && val !== null && "hidden" in val && "merged_into_profile_id" in val
  );
}

function createRealSqliteStorage(organizationId: string): {
  readonly db: DatabaseSync;
  readonly storage: ProfileReconciliationStoreStorage;
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

  const storage: ProfileReconciliationStoreStorage = {
    sql: {
      exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
        query: string,
        ...bindings: readonly unknown[]
      ) {
        const stmt = db.prepare(query);
        const params = bindings.map(toSupportedValue);
        const rawRows: unknown = stmt.all(...params);
        const fallback: readonly T[] = [];
        const rows: T[] = isRowArray(rawRows, fallback) ? rawRows : [];
        return {
          [Symbol.iterator]() {
            return rows[Symbol.iterator]();
          },
          one() {
            const first = rows[0];
            if (first === undefined) throw new Error("Expected exactly one row");
            return first;
          },
          toArray() {
            return rows;
          },
        };
      },
    },
    transactionSync<T>(fn: () => T): T {
      db.exec("BEGIN TRANSACTION");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };

  return { db, storage };
}

describe("Profile Reconciliation DO Store", () => {
  const orgId = "org-test-1";

  it("handles core clean duplicate reconciliation successfully", () => {
    const { db, storage } = createRealSqliteStorage(orgId);
    const targetId = "11111111-1111-4111-8111-111111111111";
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const now = "2026-01-01T00:00:00.000Z";

    // Established historical target profile: has past attendance, notes, no phone
    db.prepare(
      `INSERT INTO profiles (id, display_name, voice_part, global_status, notes, phone, show_in_directory, created_at, updated_at)
       VALUES (?, 'Jane Smith', 'Alto 1', 'Active', 'Historical singer notes', '', 1, ?, ?)`,
    ).run(targetId, "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z");

    // Clean signup-created duplicate source profile: has phone, empty notes
    db.prepare(
      `INSERT INTO profiles (id, display_name, voice_part, global_status, notes, phone, show_in_directory, created_at, updated_at)
       VALUES (?, 'Jane Smith', 'Alto 1', 'Active', '', '555-0199', 1, ?, ?)`,
    ).run(sourceId, now, now);

    // Historical attendance on target
    db.prepare(
      `INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at)
       VALUES ('evt-1', ?, 'Yes', 'Present', ?, ?)`,
    ).run(targetId, now, now);

    // Preview
    const preview = previewProfileReconciliationInStore(storage, {
      membershipEmail: "jane@example.test",
      membershipId: "mem-1",
      memberName: "Jane Smith",
      memberRole: "member",
      organizationId: orgId,
      requestId: "req-1",
      sourceProfileId: sourceId,
      targetProfileId: targetId,
    });

    expect(preview.ok).toBe(true);
    expect(preview.preview?.canReconcile).toBe(true);
    expect(preview.preview?.status).toBe("ready");
    expect(preview.preview?.conflictInventory.blockers).toEqual([]);

    const previewData = preview.preview;
    if (!previewData) throw new Error("Expected preview");
    const revision = previewData.previewRevision;

    // Prepare
    const prepare = prepareProfileReconciliationInStore(storage, {
      actorUserId: "usr-admin",
      expectedSourceProfileId: sourceId,
      fieldChoices: { notes: "keep_target", phone: "overwrite_with_source" },
      idempotencyKey: "idem-1",
      membershipId: "mem-1",
      organizationId: orgId,
      previewRevision: revision,
      reconciliationId: "rec-1",
      requestId: "req-1",
      targetProfileId: targetId,
    });
    expect(prepare.ok).toBe(true);

    // Commit
    const commit = commitProfileReconciliationInStore(storage, {
      actorUserId: "usr-admin",
      expectedSourceProfileId: sourceId,
      fieldChoices: { notes: "keep_target", phone: "overwrite_with_source" },
      idempotencyKey: "idem-1",
      membershipId: "mem-1",
      organizationId: orgId,
      previewRevision: revision,
      reconciliationId: "rec-1",
      requestId: "req-1",
      targetProfileId: targetId,
    });

    expect(commit.ok).toBe(true);
    expect(commit.canonicalProfileId).toBe(targetId);

    // Target profile should have preserved notes and adopted phone
    const updatedTarget = db.prepare("SELECT * FROM profiles WHERE id = ?").get(targetId);
    if (!isProfileCheckRow(updatedTarget)) throw new Error("Expected ProfileCheckRow");
    expect(updatedTarget.notes).toBe("Historical singer notes");
    expect(updatedTarget.phone).toBe("555-0199");
    expect(updatedTarget.merged_into_profile_id).toBeNull();
    expect(updatedTarget.hidden).toBe(0);

    // Source profile should be retired and marked merged
    const updatedSource = db.prepare("SELECT * FROM profiles WHERE id = ?").get(sourceId);
    if (!isProfileCheckRow(updatedSource)) throw new Error("Expected ProfileCheckRow");
    expect(updatedSource.merged_into_profile_id).toBe(targetId);
    expect(updatedSource.hidden).toBe(1);

    // Resolve canonical profile id helper
    expect(resolveCanonicalProfileId(storage, sourceId)).toBe(targetId);
    expect(resolveCanonicalProfileId(storage, targetId)).toBe(targetId);

    // Repeat commit is idempotent
    const repeatCommit = commitProfileReconciliationInStore(storage, {
      actorUserId: "usr-admin",
      expectedSourceProfileId: sourceId,
      fieldChoices: { notes: "keep_target", phone: "overwrite_with_source" },
      idempotencyKey: "idem-1",
      membershipId: "mem-1",
      organizationId: orgId,
      previewRevision: revision,
      reconciliationId: "rec-1",
      requestId: "req-1",
      targetProfileId: targetId,
    });
    expect(repeatCommit.ok).toBe(true);
  });

  it("combines non-overlapping event rosters and resolves non-pending over pending", () => {
    const { db, storage } = createRealSqliteStorage(orgId);
    const targetId = "11111111-1111-4111-8111-111111111111";
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const now = "2026-01-01T00:00:00.000Z";

    db.prepare(
      "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, 'A', ?, ?)",
    ).run(targetId, now, now);
    db.prepare(
      "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, 'B', ?, ?)",
    ).run(sourceId, now, now);

    // Event 1: target has Pending, source has Yes / Present
    db.prepare(
      "INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at) VALUES ('evt-1', ?, 'Pending', 'Pending', ?, ?)",
    ).run(targetId, now, now);
    db.prepare(
      "INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at) VALUES ('evt-1', ?, 'Yes', 'Present', ?, ?)",
    ).run(sourceId, now, now);

    // Event 2: only on source
    db.prepare(
      "INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, folder_number, created_at, updated_at) VALUES ('evt-2', ?, 'Yes', 'Present', 'F-42', ?, ?)",
    ).run(sourceId, now, now);

    const preview = previewProfileReconciliationInStore(storage, {
      membershipEmail: "test@example.test",
      membershipId: "mem-1",
      memberName: "Test",
      memberRole: "member",
      organizationId: orgId,
      requestId: "req-1",
      sourceProfileId: sourceId,
      targetProfileId: targetId,
    });
    expect(preview.ok).toBe(true);
    expect(preview.preview?.canReconcile).toBe(true);

    const previewData = preview.preview;
    if (!previewData) throw new Error("Expected preview");
    const revision = previewData.previewRevision;

    commitProfileReconciliationInStore(storage, {
      actorUserId: "usr-admin",
      expectedSourceProfileId: sourceId,
      fieldChoices: { notes: "keep_target", phone: "keep_target" },
      idempotencyKey: "idem-2",
      membershipId: "mem-1",
      organizationId: orgId,
      previewRevision: revision,
      reconciliationId: "rec-2",
      requestId: "req-1",
      targetProfileId: targetId,
    });

    // Event 1 target should be updated to Yes and Present
    const evt1 = db
      .prepare("SELECT * FROM event_rosters WHERE event_id = 'evt-1' AND profile_id = ?")
      .get(targetId);
    if (!isEventRosterCheckRow(evt1)) throw new Error("Expected EventRosterCheckRow");
    expect(evt1.rsvp).toBe("Yes");
    expect(evt1.attendance).toBe("Present");

    // Event 1 source row should be deleted
    const evt1Source = db
      .prepare("SELECT * FROM event_rosters WHERE event_id = 'evt-1' AND profile_id = ?")
      .get(sourceId);
    expect(evt1Source).toBeUndefined();

    // Event 2 should now belong to target with folder number preserved
    const evt2 = db
      .prepare("SELECT * FROM event_rosters WHERE event_id = 'evt-2' AND profile_id = ?")
      .get(targetId);
    if (!isEventRosterCheckRow(evt2)) throw new Error("Expected EventRosterCheckRow");
    expect(evt2.folder_number).toBe("F-42");
  });

  it("preserves Yes over No when RSVPs conflict and commits Yes", () => {
    const { db, storage } = createRealSqliteStorage(orgId);
    const targetId = "11111111-1111-4111-8111-111111111111";
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const now = "2026-01-01T00:00:00.000Z";

    db.prepare(
      "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, 'A', ?, ?)",
    ).run(targetId, now, now);
    db.prepare(
      "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, 'B', ?, ?)",
    ).run(sourceId, now, now);

    // Event 1: target is Yes, source is No — Yes wins, no block
    db.prepare(
      "INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at) VALUES ('evt-1', ?, 'Yes', 'Pending', ?, ?)",
    ).run(targetId, now, now);
    db.prepare(
      "INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at) VALUES ('evt-1', ?, 'No', 'Pending', ?, ?)",
    ).run(sourceId, now, now);

    const preview = previewProfileReconciliationInStore(storage, {
      membershipEmail: "test@example.test",
      membershipId: "mem-1",
      memberName: "Test",
      memberRole: "member",
      organizationId: orgId,
      requestId: "req-1",
      sourceProfileId: sourceId,
      targetProfileId: targetId,
    });

    expect(preview.ok).toBe(true);
    expect(preview.preview?.canReconcile).toBe(true);
    expect(preview.preview?.conflictInventory.eventRosterConflicts.length).toBe(1);
    expect(preview.preview?.conflictInventory.warnings.some((w) => w.includes("RSVP Yes"))).toBe(
      true,
    );
    if (!preview.preview) throw new Error("Expected preview");

    const commit = commitProfileReconciliationInStore(storage, {
      actorUserId: "usr-admin",
      expectedSourceProfileId: sourceId,
      fieldChoices: { notes: "keep_target", phone: "keep_target" },
      idempotencyKey: "idem-yes-wins",
      membershipId: "mem-1",
      organizationId: orgId,
      previewRevision: preview.preview.previewRevision,
      reconciliationId: "rec-yes-wins",
      requestId: "req-1",
      targetProfileId: targetId,
    });
    expect(commit.ok).toBe(true);
    const merged = db
      .prepare(
        "SELECT rsvp, attendance, folder_number FROM event_rosters WHERE event_id = 'evt-1' AND profile_id = ?",
      )
      .get(targetId);
    if (!isEventRosterCheckRow(merged)) throw new Error("Expected EventRosterCheckRow");
    expect(merged.rsvp).toBe("Yes");
  });

  it("preserves source Yes over target No when RSVPs conflict", () => {
    const { db, storage } = createRealSqliteStorage(orgId);
    const targetId = "11111111-1111-4111-8111-111111111111";
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const now = "2026-01-01T00:00:00.000Z";

    db.prepare(
      "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, 'A', ?, ?)",
    ).run(targetId, now, now);
    db.prepare(
      "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, 'B', ?, ?)",
    ).run(sourceId, now, now);

    db.prepare(
      "INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at) VALUES ('evt-1', ?, 'No', 'Pending', ?, ?)",
    ).run(targetId, now, now);
    db.prepare(
      "INSERT INTO event_rosters (event_id, profile_id, rsvp, attendance, created_at, updated_at) VALUES ('evt-1', ?, 'Yes', 'Pending', ?, ?)",
    ).run(sourceId, now, now);

    const preview = previewProfileReconciliationInStore(storage, {
      membershipEmail: "test@example.test",
      membershipId: "mem-1",
      memberName: "Test",
      memberRole: "member",
      organizationId: orgId,
      requestId: "req-1",
      sourceProfileId: sourceId,
      targetProfileId: targetId,
    });

    expect(preview.ok).toBe(true);
    expect(preview.preview?.canReconcile).toBe(true);
    if (!preview.preview) throw new Error("Expected preview");

    const commit = commitProfileReconciliationInStore(storage, {
      actorUserId: "usr-admin",
      expectedSourceProfileId: sourceId,
      fieldChoices: { notes: "keep_target", phone: "keep_target" },
      idempotencyKey: "idem-yes-wins-source",
      membershipId: "mem-1",
      organizationId: orgId,
      previewRevision: preview.preview.previewRevision,
      reconciliationId: "rec-yes-wins-source",
      requestId: "req-1",
      targetProfileId: targetId,
    });
    expect(commit.ok).toBe(true);
    const merged = db
      .prepare(
        "SELECT rsvp, attendance, folder_number FROM event_rosters WHERE event_id = 'evt-1' AND profile_id = ?",
      )
      .get(targetId);
    if (!isEventRosterCheckRow(merged)) throw new Error("Expected EventRosterCheckRow");
    expect(merged.rsvp).toBe("Yes");
  });

  it("blocks reconciliation when both profiles voted on the same poll", () => {
    const { db, storage } = createRealSqliteStorage(orgId);
    const targetId = "11111111-1111-4111-8111-111111111111";
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const now = "2026-01-01T00:00:00.000Z";

    db.prepare(
      "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, 'A', ?, ?)",
    ).run(targetId, now, now);
    db.prepare(
      "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, 'B', ?, ?)",
    ).run(sourceId, now, now);

    db.prepare(
      "INSERT INTO polls (id, title, description, created_by, expires_at, created_at, updated_at) VALUES ('poll-1', 'Audition', '', 'usr-1', ?, ?, ?)",
    ).run(now, now, now);
    db.prepare(
      "INSERT INTO poll_options (id, poll_id, label, sort_order) VALUES ('opt-1', 'poll-1', 'Option 1', 0)",
    ).run();
    db.prepare(
      "INSERT INTO poll_responses (poll_id, profile_id, option_ids, profile_name, responded_at) VALUES ('poll-1', ?, 'opt-1', 'Test', ?)",
    ).run(targetId, now);
    db.prepare(
      "INSERT INTO poll_responses (poll_id, profile_id, option_ids, profile_name, responded_at) VALUES ('poll-1', ?, 'opt-1', 'Test', ?)",
    ).run(sourceId, now);

    const preview = previewProfileReconciliationInStore(storage, {
      membershipEmail: "test@example.test",
      membershipId: "mem-1",
      memberName: "Test",
      memberRole: "member",
      organizationId: orgId,
      requestId: "req-1",
      sourceProfileId: sourceId,
      targetProfileId: targetId,
    });

    expect(preview.preview?.canReconcile).toBe(false);
    expect(preview.preview?.conflictInventory.pollConflicts.length).toBe(1);
    expect(preview.preview?.conflictInventory.blockers.some((b) => b.includes("Poll poll-1"))).toBe(
      true,
    );
  });

  it("blocks reconciliation when source profile has settled dues", () => {
    const { db, storage } = createRealSqliteStorage(orgId);
    const targetId = "11111111-1111-4111-8111-111111111111";
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const now = "2026-01-01T00:00:00.000Z";

    db.prepare(
      "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, 'A', ?, ?)",
    ).run(targetId, now, now);
    db.prepare(
      "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, 'B', ?, ?)",
    ).run(sourceId, now, now);

    db.prepare(
      "INSERT INTO seasons (id, name, starts_at, ends_at, dues_amount_cents, created_at, updated_at) VALUES ('season-1', 'Fall 2026', ?, ?, 5000, ?, ?)",
    ).run(now, now, now, now);
    db.prepare(
      `INSERT INTO dues (id, season_id, profile_id, amount_cents, status, paid_at, created_at, updated_at)
       VALUES ('due-1', 'season-1', ?, 5000, 'paid', ?, ?, ?)`,
    ).run(sourceId, now, now, now);

    const preview = previewProfileReconciliationInStore(storage, {
      membershipEmail: "test@example.test",
      membershipId: "mem-1",
      memberName: "Test",
      memberRole: "member",
      organizationId: orgId,
      requestId: "req-1",
      sourceProfileId: sourceId,
      targetProfileId: targetId,
    });

    expect(preview.preview?.canReconcile).toBe(false);
    expect(
      preview.preview?.conflictInventory.blockers.some((b) => b.includes("Financial history")),
    ).toBe(true);
  });

  it("finds potential duplicate candidates by name and voice part", () => {
    const { db, storage } = createRealSqliteStorage(orgId);
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const targetId = "11111111-1111-4111-8111-111111111111";
    const now = "2026-01-01T00:00:00.000Z";

    db.prepare(
      "INSERT INTO profiles (id, display_name, voice_part, phone, created_at, updated_at) VALUES (?, 'Jane Smith', 'Alto 1', '555-1234', ?, ?)",
    ).run(sourceId, now, now);
    db.prepare(
      "INSERT INTO profiles (id, display_name, voice_part, phone, created_at, updated_at) VALUES (?, 'Jane Smith', 'Alto 1', '', ?, ?)",
    ).run(targetId, now, now);
    db.prepare(
      "INSERT INTO profiles (id, display_name, voice_part, phone, created_at, updated_at) VALUES ('other', 'Bob Jones', 'Bass 1', '', ?, ?)",
    ).run(now, now);

    const candidates = findReconciliationCandidatesInStore(storage, {
      sourceProfileId: sourceId,
    });

    expect(candidates.length).toBe(1);
    expect(candidates[0]?.id).toBe(targetId);
    expect(candidates[0]?.matchReasons).toContain("Exact name match");
    expect(candidates[0]?.matchReasons).toContain("Matching voice part");
  });

  it("resolves multi-hop aliases (A -> B -> C) and handles cycles safely", () => {
    const { db, storage } = createRealSqliteStorage(orgId);
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare(
      "INSERT INTO profiles (id, display_name, merged_into_profile_id, created_at, updated_at) VALUES ('A', 'A', 'B', ?, ?)",
    ).run(now, now);
    db.prepare(
      "INSERT INTO profiles (id, display_name, merged_into_profile_id, created_at, updated_at) VALUES ('B', 'B', 'C', ?, ?)",
    ).run(now, now);
    db.prepare(
      "INSERT INTO profiles (id, display_name, merged_into_profile_id, created_at, updated_at) VALUES ('C', 'C', NULL, ?, ?)",
    ).run(now, now);

    expect(resolveCanonicalProfileId(storage, "A")).toBe("C");
    expect(resolveCanonicalProfileId(storage, "B")).toBe("C");
    expect(resolveCanonicalProfileId(storage, "C")).toBe("C");

    // Cycle A -> B -> A should terminate safely without loop
    db.prepare("UPDATE profiles SET merged_into_profile_id = 'A' WHERE id = 'B'").run();
    expect(resolveCanonicalProfileId(storage, "A")).toBeDefined();
  });

  it("updates seating chart assignments and propagates provider email suppression on commit", () => {
    const { db, storage } = createRealSqliteStorage(orgId);
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const targetId = "11111111-1111-4111-8111-111111111111";
    const now = "2026-01-01T00:00:00.000Z";

    // Source has provider email suppression
    db.prepare(
      `INSERT INTO profiles (id, display_name, provider_email_suppressed, provider_email_suppressed_reason, created_at, updated_at)
       VALUES (?, 'Source Chorister', 1, 'Hard bounce via Resend', ?, ?)`,
    ).run(sourceId, now, now);

    // Target does not have suppression
    db.prepare(
      `INSERT INTO profiles (id, display_name, provider_email_suppressed, created_at, updated_at)
       VALUES (?, 'Target Chorister', 0, ?, ?)`,
    ).run(targetId, now, now);

    // Seating chart referencing sourceId
    db.prepare(
      `INSERT INTO seating_charts (id, event_id, name, formation_id, row_counts_json, assignments_json, created_at, updated_at)
       VALUES ('chart-1', 'event-1', 'Test Chart', 'form-1', '[]', ?, ?, ?)`,
    ).run(JSON.stringify({ "seat-1": sourceId }), now, now);

    const preview = previewProfileReconciliationInStore(storage, {
      membershipEmail: "test@example.test",
      membershipId: "mem-1",
      memberName: "Test Chorister",
      memberRole: "member",
      organizationId: orgId,
      requestId: "req-1",
      sourceProfileId: sourceId,
      targetProfileId: targetId,
    });
    if (!preview.preview) throw new Error("Expected preview");

    const commit = commitProfileReconciliationInStore(storage, {
      actorUserId: "usr-admin",
      expectedSourceProfileId: sourceId,
      fieldChoices: { notes: "keep_target", phone: "keep_target" },
      idempotencyKey: "idem-sup-1",
      membershipId: "mem-1",
      organizationId: orgId,
      previewRevision: preview.preview.previewRevision,
      reconciliationId: "rec-sup-1",
      requestId: "req-1",
      targetProfileId: targetId,
    });
    expect(commit.ok).toBe(true);

    // Check seating chart updated
    const chart = db
      .prepare("SELECT assignments_json FROM seating_charts WHERE id = 'chart-1'")
      .get();
    if (!isSeatingChartCheckRow(chart)) throw new Error("Expected SeatingChartCheckRow");
    const parsed: unknown = JSON.parse(chart.assignments_json);
    if (!isRecord(parsed)) throw new Error("Expected object");
    expect(parsed["seat-1"]).toBe(targetId);

    // Check target profile inherited provider suppression
    const targetRow = db
      .prepare(
        "SELECT provider_email_suppressed, provider_email_suppressed_reason FROM profiles WHERE id = ?",
      )
      .get(targetId);
    if (!isProfileSuppressionCheckRow(targetRow))
      throw new Error("Expected ProfileSuppressionCheckRow");
    expect(targetRow.provider_email_suppressed).toBe(1);
    expect(targetRow.provider_email_suppressed_reason).toContain("Hard bounce via Resend");
  });

  it("blocks reconciliation when delivery histories collide instead of deleting", () => {
    const { db, storage } = createRealSqliteStorage(orgId);
    const sourceId = "33333333-3333-4333-8333-333333333333";
    const targetId = "44444444-4444-4434-8434-444444444444";
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare(
      "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, 'Same Name', ?, ?)",
    ).run(sourceId, now, now);
    db.prepare(
      "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, 'Same Name', ?, ?)",
    ).run(targetId, now, now);
    db.prepare(
      "INSERT INTO communication_deliveries (id, message_id, profile_id, recipient_name, channel, destination, status, created_at, updated_at) VALUES ('del-s', 'msg-1', ?, 'Same Name', 'email', 'same@example.test', 'sent', ?, ?)",
    ).run(sourceId, now, now);
    db.prepare(
      "INSERT INTO communication_deliveries (id, message_id, profile_id, recipient_name, channel, destination, status, created_at, updated_at) VALUES ('del-t', 'msg-1', ?, 'Same Name', 'email', 'same@example.test', 'sent', ?, ?)",
    ).run(targetId, now, now);

    const preview = previewProfileReconciliationInStore(storage, {
      membershipEmail: "same@example.test",
      membershipId: "mem-del",
      memberName: "Same Name",
      memberRole: "member",
      organizationId: orgId,
      requestId: "req-del",
      sourceProfileId: sourceId,
      targetProfileId: targetId,
    });
    expect(preview.ok).toBe(true);
    expect(preview.preview?.canReconcile).toBe(false);
    expect(preview.preview?.status).toBe("blocked");
    expect(preview.preview?.conflictInventory.deliveryConflicts.length).toBeGreaterThan(0);

    const commit = commitProfileReconciliationInStore(storage, {
      actorUserId: "usr-admin",
      expectedSourceProfileId: sourceId,
      fieldChoices: { notes: "keep_target", phone: "keep_target" },
      idempotencyKey: "idem-del-1",
      membershipId: "mem-del",
      organizationId: orgId,
      previewRevision: preview.preview?.previewRevision ?? "",
      reconciliationId: "rec-del-1",
      requestId: "req-del",
      targetProfileId: targetId,
    });
    expect(commit.ok).toBe(false);
    const sourceDeliveries = db
      .prepare("SELECT COUNT(*) AS count FROM communication_deliveries WHERE profile_id = ?")
      .get(sourceId);
    if (!isCountCheckRow(sourceDeliveries)) throw new Error("Expected CountCheckRow");
    expect(sourceDeliveries.count).toBe(1);
  });

  it("moves source contacts to an empty target without violating email uniqueness", () => {
    const { db, storage } = createRealSqliteStorage(orgId);
    const sourceId = "55555555-5555-4555-8555-555555555555";
    const targetId = "66666666-6666-4656-8656-666666666666";
    const now = "2026-01-01T00:00:00.000Z";
    for (const [id, name] of [
      [sourceId, "Same Name"],
      [targetId, "Same Name"],
    ] as const) {
      db.prepare(
        "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      ).run(id, name, now, now);
    }
    db.prepare(
      "INSERT INTO contacts (id, profile_id, email, normalized_email, display_name, created_at, updated_at) VALUES ('c-source', ?, 'same@example.test', 'same@example.test', 'Same', ?, ?)",
    ).run(sourceId, now, now);

    const preview = previewProfileReconciliationInStore(storage, {
      membershipEmail: "same@example.test",
      membershipId: "mem-contact",
      memberName: "Same Name",
      memberRole: "member",
      organizationId: orgId,
      requestId: "req-contact",
      sourceProfileId: sourceId,
      targetProfileId: targetId,
    });
    expect(preview.ok).toBe(true);
    expect(preview.preview?.canReconcile).toBe(true);
    if (!preview.preview) throw new Error("Expected preview");

    const commit = commitProfileReconciliationInStore(storage, {
      actorUserId: "usr-admin",
      expectedSourceProfileId: sourceId,
      fieldChoices: { notes: "keep_target", phone: "keep_target" },
      idempotencyKey: "idem-contact-1",
      membershipId: "mem-contact",
      organizationId: orgId,
      previewRevision: preview.preview.previewRevision,
      reconciliationId: "rec-contact-1",
      requestId: "req-contact",
      targetProfileId: targetId,
    });
    expect(commit.ok).toBe(true);
    const moved = db.prepare("SELECT profile_id FROM contacts WHERE id = 'c-source'").get();
    if (!isContactOwnerCheckRow(moved)) throw new Error("Expected ContactOwnerCheckRow");
    expect(moved.profile_id).toBe(targetId);
  });

  it("does not auto-merge same-name different people without explicit execute", () => {
    const { db, storage } = createRealSqliteStorage(orgId);
    const sourceId = "88888888-8888-4888-8888-888888888888";
    const targetId = "99999999-9999-4999-8999-999999999999";
    const now = "2026-01-01T00:00:00.000Z";
    db.prepare(
      "INSERT INTO profiles (id, display_name, voice_part, created_at, updated_at) VALUES (?, 'Alex Rivera', 'Alto 1', ?, ?)",
    ).run(sourceId, now, now);
    db.prepare(
      "INSERT INTO profiles (id, display_name, voice_part, created_at, updated_at) VALUES (?, 'Alex Rivera', 'Alto 1', ?, ?)",
    ).run(targetId, now, now);
    const preview = previewProfileReconciliationInStore(storage, {
      membershipEmail: "alex@example.test",
      membershipId: "mem-alex",
      memberName: "Alex Rivera",
      memberRole: "member",
      organizationId: orgId,
      requestId: "req-alex",
      sourceProfileId: sourceId,
      targetProfileId: targetId,
    });
    expect(preview.ok).toBe(true);
    const sourceRow = db
      .prepare("SELECT hidden, merged_into_profile_id FROM profiles WHERE id = ?")
      .get(sourceId);
    if (!isRetirementCheckRow(sourceRow)) throw new Error("Expected RetirementCheckRow");
    expect(sourceRow.hidden).toBe(0);
    expect(sourceRow.merged_into_profile_id).toBeNull();
  });
});
