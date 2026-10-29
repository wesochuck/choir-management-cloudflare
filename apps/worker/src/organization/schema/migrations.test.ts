import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { createContactTestAdapter, DEFAULT_CONTACT_TEST_ORG_ID } from "../contactTestkit";
import { organizationSchemaMigrations } from "./migrations";

function setupThrough(version: number): ReturnType<typeof createContactTestAdapter> {
  const db = new DatabaseSync(":memory:");
  const adapter = createContactTestAdapter(db);
  // Statements only: seed apply() callbacks populate template content that
  // this migration-shape test does not need.
  adapter.storage.transactionSync(() => {
    for (const migration of organizationSchemaMigrations) {
      if (migration.version > version) break;
      for (const statement of migration.statements) {
        adapter.storage.sql.exec(statement);
      }
    }
  });
  adapter.storage.sql.exec(
    `INSERT INTO organization_metadata
      (organization_id, name, slug, timezone, created_at, updated_at)
     VALUES (?, 'Test Choir', 'test-choir', 'America/New_York', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    DEFAULT_CONTACT_TEST_ORG_ID,
  );
  return adapter;
}

function applyVersion(adapter: ReturnType<typeof createContactTestAdapter>, version: number): void {
  const migration = organizationSchemaMigrations.find((entry) => entry.version === version);
  expect(migration).toBeDefined();
  adapter.storage.transactionSync(() => {
    for (const statement of migration?.statements ?? []) {
      adapter.storage.sql.exec(statement);
    }
  });
}

function readTaskApplicable(
  adapter: ReturnType<typeof createContactTestAdapter>,
  id: string,
): number | null {
  const rows = adapter.storage.sql
    .exec<{ readonly applicable: number }>(
      "SELECT applicable FROM organization_compliance_tasks WHERE id = ?",
      id,
    )
    .toArray();
  return rows[0]?.applicable ?? null;
}

describe("organization schema migrations", () => {
  it("v128 stores canonical event promotion context and enforces one initial per event", () => {
    const adapter = setupThrough(127);
    applyVersion(adapter, 128);
    const columns = adapter.storage.sql
      .exec<{ readonly name: string }>("PRAGMA table_info(communication_messages)")
      .toArray();
    expect(columns.map(({ name }) => name)).toContain("event_promotion_json");
    expect(columns.map(({ name }) => name)).toContain("draft_revision");

    adapter.storage.sql.exec(
      `INSERT INTO events (id, title, type, starts_at, created_at, updated_at)
       VALUES ('event-1', 'Winter Lights', 'Performance', '2027-12-01', '2026-10-29', '2026-10-29')`,
    );
    for (const id of ["message-1", "message-2", "message-3"]) {
      adapter.storage.sql.exec(
        `INSERT INTO communication_messages
          (id, channel, status, audience_json, reach_json, created_by, created_at, updated_at)
         VALUES (?, 'Email', 'Draft', '{}', '{}', 'user-1', '2026-10-29', '2026-10-29')`,
        id,
      );
    }
    adapter.storage.sql.exec(
      `INSERT INTO event_communication_links
        (event_id, message_id, announcement_kind, parent_message_id, created_at)
       VALUES ('event-1', 'message-1', 'initial', NULL, '2026-10-29')`,
    );
    expect(() =>
      adapter.storage.sql.exec(
        `INSERT INTO event_communication_links
          (event_id, message_id, announcement_kind, parent_message_id, created_at)
         VALUES ('event-1', 'message-2', 'initial', NULL, '2026-10-29')`,
      ),
    ).toThrow();
    expect(() =>
      adapter.storage.sql.exec(
        `INSERT INTO event_communication_links
          (event_id, message_id, announcement_kind, parent_message_id, created_at)
         VALUES ('event-1', 'message-3', 'follow_up', 'message-2', '2026-10-29')`,
      ),
    ).not.toThrow();
  });

  it("v123 preserves Organization metadata and defaults the practice target to -18", () => {
    const adapter = setupThrough(122);
    applyVersion(adapter, 123);
    expect(
      adapter.storage.sql
        .exec("SELECT name, practice_loudness_target_lufs FROM organization_metadata")
        .toArray(),
    ).toEqual([{ name: "Test Choir", practice_loudness_target_lufs: -18 }]);
    expect(() =>
      adapter.storage.sql.exec(
        "UPDATE organization_metadata SET practice_loudness_target_lufs = -9",
      ),
    ).toThrow();
    expect(() =>
      adapter.storage.sql.exec(
        "UPDATE organization_metadata SET practice_loudness_target_lufs = -31",
      ),
    ).toThrow();
  });

  it("v127 stores retry-safe roster invite matching and prevents replacement of reused Profiles", () => {
    const adapter = setupThrough(126);
    applyVersion(adapter, 127);
    const columns = adapter.storage.sql
      .exec<{ readonly name: string; readonly dflt_value: string | null }>(
        "PRAGMA table_info(prepared_roster_invite_enrollments)",
      )
      .toArray();
    expect(columns.find((column) => column.name === "profile_mode")?.dflt_value).toBe("'new'");
    expect(columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dflt_value: "'new'", name: "profile_mode" }),
        expect.objectContaining({ name: "verified_email" }),
      ]),
    );
    adapter.storage.sql.exec(
      `INSERT INTO profiles (id, display_name, created_at, updated_at)
       VALUES ('guarded-profile', 'Existing Singer', '2026-01-01', '2026-01-01')`,
    );
    adapter.storage.sql.exec(
      `INSERT INTO roster_invite_profile_link_guards (profile_id, created_at)
       VALUES ('guarded-profile', '2026-01-02')`,
    );
    expect(() =>
      adapter.storage.sql.exec(
        `INSERT OR REPLACE INTO profiles (id, display_name, created_at, updated_at)
         VALUES ('guarded-profile', 'Overwritten Singer', '2026-01-03', '2026-01-03')`,
      ),
    ).toThrow();
    expect(
      adapter.storage.sql
        .exec<{ readonly display_name: string }>(
          "SELECT display_name FROM profiles WHERE id = 'guarded-profile'",
        )
        .toArray()
        .at(0)?.display_name,
    ).toBe("Existing Singer");
  });

  it("v122 defaults existing and new directory contacts to visible without changing directory opt-in", () => {
    const adapter = setupThrough(121);
    adapter.storage.sql.exec(
      "INSERT INTO profiles (id, display_name, show_in_directory, created_at, updated_at) VALUES ('existing', 'Existing', 0, '2026-01-01', '2026-01-01')",
    );
    applyVersion(adapter, 122);
    adapter.storage.sql.exec(
      "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES ('new', 'New', '2026-01-01', '2026-01-01')",
    );
    expect(
      adapter.storage.sql
        .exec(
          "SELECT id, show_in_directory, show_email_in_directory, show_phone_in_directory FROM profiles ORDER BY id",
        )
        .toArray(),
    ).toEqual([
      {
        id: "existing",
        show_in_directory: 0,
        show_email_in_directory: 1,
        show_phone_in_directory: 1,
      },
      { id: "new", show_in_directory: 1, show_email_in_directory: 1, show_phone_in_directory: 1 },
    ]);
    expect(() =>
      adapter.storage.sql.exec("UPDATE profiles SET show_email_in_directory = 2 WHERE id = 'new'"),
    ).toThrow();
  });

  it("v118 marks existing ticket-enabled Performances public without changing other events", () => {
    const adapter = setupThrough(117);
    for (const [id, type, ticketing, published] of [
      ["ticketed", "Performance", 1, 0],
      ["private", "Performance", 0, 0],
      ["public", "Performance", 0, 1],
      ["rehearsal", "Rehearsal", 0, 0],
    ] as const) {
      adapter.storage.sql.exec(
        "INSERT INTO events (id, title, type, starts_at, is_ticketing_enabled, publish_on_website, created_at, updated_at) VALUES (?, ?, ?, '2027-01-01T18:00:00Z', ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        id,
        id,
        type,
        ticketing,
        published,
      );
    }
    applyVersion(adapter, 118);
    expect(
      adapter.storage.sql
        .exec<{ id: string; publish_on_website: number }>(
          "SELECT id, publish_on_website FROM events ORDER BY id",
        )
        .toArray(),
    ).toEqual([
      { id: "private", publish_on_website: 0 },
      { id: "public", publish_on_website: 1 },
      { id: "rehearsal", publish_on_website: 0 },
      { id: "ticketed", publish_on_website: 1 },
    ]);
  });

  it("v117 preserves website content while defaulting custom page labels to empty", () => {
    const adapter = setupThrough(116);
    adapter.storage.sql.exec(
      "UPDATE public_website_settings SET history_text = 'Our original story' WHERE singleton = 1",
    );
    applyVersion(adapter, 117);
    expect(
      adapter.storage.sql
        .exec<{ history_text: string; page_labels_json: string }>(
          "SELECT history_text, page_labels_json FROM public_website_settings WHERE singleton = 1",
        )
        .toArray()
        .at(0),
    ).toEqual({ history_text: "Our original story", page_labels_json: "{}" });
  });
  it("v116 preserves populated website drafts and gives existing heroes a centered focal point", () => {
    const adapter = setupThrough(115);
    adapter.storage.sql.exec(
      "UPDATE public_website_settings SET hero_headline = 'Existing concert' WHERE singleton = 1",
    );
    applyVersion(adapter, 116);
    const row = adapter.storage.sql
      .exec<{ hero_headline: string; hero_position_x: number; hero_position_y: number }>(
        "SELECT hero_headline, hero_position_x, hero_position_y FROM public_website_settings WHERE singleton = 1",
      )
      .toArray()
      .at(0);
    expect(row).toEqual({
      hero_headline: "Existing concert",
      hero_position_x: 50,
      hero_position_y: 50,
    });
  });
  it("v115 adds empty footer defaults while preserving a populated website draft", () => {
    const adapter = setupThrough(114);
    adapter.storage.sql.exec(
      "UPDATE public_website_settings SET hero_headline = 'Existing choir' WHERE singleton = 1",
    );
    applyVersion(adapter, 115);
    const row = adapter.storage.sql
      .exec<{ hero_headline: string; footer_text: string; footer_embeds_json: string }>(
        "SELECT hero_headline, footer_text, footer_embeds_json FROM public_website_settings WHERE singleton = 1",
      )
      .toArray()
      .at(0);
    expect(row).toEqual({
      hero_headline: "Existing choir",
      footer_text: "",
      footer_embeds_json: "[]",
    });
  });
  it("v112 expands existing music rows and cleans saved movement references on reparent and delete", () => {
    const adapter = setupThrough(111);
    for (const [id, parentId] of [
      ["parent", null],
      ["child-a", "parent"],
      ["child-b", "parent"],
    ]) {
      adapter.storage.sql.exec(
        "INSERT INTO music_pieces (id, title, parent_id, created_at, updated_at) VALUES (?, ?, ?, '2026-01-01', '2026-01-01')",
        id,
        id,
        parentId,
      );
    }
    applyVersion(adapter, 112);
    const order = () =>
      adapter.storage.sql
        .exec<{ readonly value: string }>(
          "SELECT movement_order_json AS value FROM music_pieces WHERE id = 'parent'",
        )
        .toArray()
        .at(0)?.value ?? "null";
    expect(JSON.parse(order())).toEqual([]);
    adapter.storage.sql.exec(
      "UPDATE music_pieces SET movement_order_json = ? WHERE id = 'parent'",
      JSON.stringify(["child-b", "child-a"]),
    );
    adapter.storage.sql.exec("UPDATE music_pieces SET parent_id = NULL WHERE id = 'child-a'");
    expect(JSON.parse(order())).toEqual(["child-b"]);
    adapter.storage.sql.exec("DELETE FROM music_pieces WHERE id = 'child-b'");
    expect(JSON.parse(order())).toEqual([]);
  });
  it("v107 carries the Ohio backfill on the migration path", () => {
    const versions = organizationSchemaMigrations.map((entry) => entry.version);
    expect(versions).toEqual([...versions].sort((left, right) => left - right));
    const v107 = organizationSchemaMigrations.find((entry) => entry.version === 107);
    expect(v107?.statements).toEqual([]);
    expect(typeof v107?.apply).toBe("function");
  });

  it("v106 clamps legacy applicable values outside 0/1 instead of failing the DO barrier", () => {
    const adapter = setupThrough(105);
    adapter.storage.sql.exec(
      `INSERT INTO organization_compliance_tasks
        (id, kind, title, applicable, recurrence_months, next_due_date,
         last_completed_date, next_reminder_at, reminder_interval_days,
         created_at, updated_at)
       VALUES
         ('legacy-dirty', 'dirty_kind', 'Dirty', 2, 12, NULL, NULL, NULL, 7,
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
         ('legacy-clean', 'clean_kind', 'Clean', 1, 12, NULL, NULL, NULL, 7,
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    );

    applyVersion(adapter, 106);

    // Readers treat only 1 as applicable, so clamping anything else to 0
    // preserves every existing read while satisfying the new CHECK.
    expect(readTaskApplicable(adapter, "legacy-dirty")).toBe(0);
    expect(readTaskApplicable(adapter, "legacy-clean")).toBe(1);
  });

  it("v106 succeeds when tasks have existing completions under enforced foreign keys", () => {
    const adapter = setupThrough(105);
    adapter.db.exec("PRAGMA foreign_keys = ON");
    adapter.storage.sql.exec(
      `INSERT INTO organization_compliance_tasks
        (id, kind, title, applicable, recurrence_months, next_due_date,
         last_completed_date, next_reminder_at, reminder_interval_days,
         created_at, updated_at)
       VALUES
         ('task-1', 'kind_1', 'Task 1', 1, 12, NULL, NULL, NULL, 7,
           '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    );
    adapter.storage.sql.exec(
      `INSERT INTO organization_compliance_completions
        (id, task_id, cycle_due_date, completed_date, completed_by_user_id, created_at)
       VALUES
         ('comp-1', 'task-1', '2026-01-01', '2026-01-01', 'user-1', '2026-01-01T00:00:00Z')`,
    );

    expect(() => {
      applyVersion(adapter, 106);
    }).not.toThrow();
  });

  it("v111 migration is registered forward-only with apply hook", () => {
    const versions = organizationSchemaMigrations.map((entry) => entry.version);
    expect(versions).toEqual([...versions].sort((left, right) => left - right));
    const v111 = organizationSchemaMigrations.find((entry) => entry.version === 111);
    expect(v111?.statements).toEqual([]);
    expect(typeof v111?.apply).toBe("function");
  });

  it("v124 creates public_website_documents and public_website_document_slugs tables and indexes", () => {
    const adapter = setupThrough(123);
    applyVersion(adapter, 124);

    expect(() => {
      adapter.storage.sql.exec(
        `INSERT INTO private_files (id, storage_key, file_name, content_type, size_bytes, status, uploaded_by, request_id, created_at)
         VALUES ('file-1', 'orgs/test/file-1', 'doc.pdf', 'application/pdf', 1024, 'ready', 'user-1', 'req-1', '2026-01-01T00:00:00Z')`,
      );
      adapter.storage.sql.exec(
        `INSERT INTO public_website_documents (id, slug, title, file_id, file_name, content_type, size_bytes, sort_order, created_at, updated_at)
         VALUES ('doc-1', 'donation-form', 'Donation Form', 'file-1', 'doc.pdf', 'application/pdf', 1024, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      );
      adapter.storage.sql.exec(
        `INSERT INTO public_website_document_slugs (document_id, slug, base, suffix)
         VALUES ('doc-1', 'donation-form', 'donation-form', 1)`,
      );
    }).not.toThrow();

    const docRows = adapter.storage.sql
      .exec("SELECT id, slug, title, content_type FROM public_website_documents WHERE id = 'doc-1'")
      .toArray();
    expect(docRows).toEqual([
      {
        content_type: "application/pdf",
        id: "doc-1",
        slug: "donation-form",
        title: "Donation Form",
      },
    ]);
  });

  it("v125 adds program ad sponsorship columns and artwork file index to donations table", () => {
    const adapter = setupThrough(124);
    applyVersion(adapter, 125);

    expect(() => {
      adapter.storage.sql.exec(
        `INSERT INTO private_files (id, storage_key, file_name, content_type, size_bytes, status, uploaded_by, request_id, created_at)
         VALUES ('file-art-1', 'orgs/test/file-art-1', 'ad.pdf', 'application/pdf', 1024, 'ready', 'user-1', 'req-1', '2026-01-01T00:00:00Z')`,
      );
      adapter.storage.sql.exec(
        `INSERT INTO donations (
          id, checkout_request_id, amount_cents, status, provider_session_id,
          buyer_name, buyer_email, created_at, updated_at,
          selected_level_id, selected_level_name, includes_program_ad, sponsor_name,
          artwork_file_id, artwork_status, artwork_instructions, artwork_uploaded_at
        ) VALUES (
          'don-1', 'req-1', 25000, 'paid', 'cs_test_123',
          'Jane Donor', 'jane@example.test', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
          'lvl-sponsor', 'Gold Sponsor', 1, 'Jane Donor Business',
          'file-art-1', 'received', '300 DPI PDF', '2026-01-01T00:00:00Z'
        )`,
      );
    }).not.toThrow();

    const row = adapter.storage.sql
      .exec<{
        readonly includes_program_ad: number;
        readonly selected_level_name: string;
        readonly sponsor_name: string;
        readonly artwork_status: string;
      }>(
        "SELECT includes_program_ad, selected_level_name, sponsor_name, artwork_status FROM donations WHERE id = 'don-1'",
      )
      .toArray()
      .at(0);

    expect(row).toEqual({
      artwork_status: "received",
      includes_program_ad: 1,
      selected_level_name: "Gold Sponsor",
      sponsor_name: "Jane Donor Business",
    });
  });
});
