import { defaultRosterConfiguration, defaultSeatingConfiguration } from "@choir/domain";

export interface OrganizationSchemaMigration {
  readonly statements: readonly string[];
  readonly version: number;
}

export const organizationSchemaMigrations: readonly OrganizationSchemaMigration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS organization_metadata (
        organization_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL DEFAULT 'provisioning',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        change_summary TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS job_ledger (
        idempotency_key TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('claimed', 'completed', 'failed')),
        attempt INTEGER NOT NULL,
        claimed_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS scheduler_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        next_due_at TEXT,
        updated_at TEXT NOT NULL
      ) STRICT`,
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
    ],
  },
  {
    version: 3,
    statements: ["ALTER TABLE job_ledger ADD COLUMN failed_at TEXT"],
  },
  {
    version: 4,
    statements: [
      `CREATE TABLE IF NOT EXISTS private_files (
        id TEXT PRIMARY KEY,
        storage_key TEXT NOT NULL UNIQUE,
        file_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'ready')),
        uploaded_by TEXT NOT NULL,
        request_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        ready_at TEXT
      ) STRICT`,
    ],
  },
  {
    version: 5,
    statements: [
      `CREATE TABLE IF NOT EXISTS scheduled_job_outbox (
        job_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        due_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        enqueued_at TEXT
      ) STRICT`,
      `CREATE INDEX IF NOT EXISTS idx_scheduled_job_outbox_pending
       ON scheduled_job_outbox(enqueued_at, due_at)`,
    ],
  },
  {
    version: 6,
    statements: [
      "ALTER TABLE profiles ADD COLUMN calendar_feed_version INTEGER NOT NULL DEFAULT 1",
    ],
  },
  {
    version: 7,
    statements: [
      "ALTER TABLE organization_metadata ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'",
      `CREATE TABLE IF NOT EXISTS venues (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('Performance', 'Rehearsal')),
        starts_at TEXT NOT NULL,
        duration_minutes INTEGER,
        call_time TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        venue_id TEXT,
        parent_performance_id TEXT,
        details TEXT NOT NULL DEFAULT '',
        set_list_json TEXT NOT NULL DEFAULT '[]',
        set_list_approved INTEGER NOT NULL DEFAULT 0 CHECK (set_list_approved IN (0, 1)),
        is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX IF NOT EXISTS idx_events_calendar
       ON events(is_archived, starts_at)`,
      `CREATE TABLE IF NOT EXISTS event_rosters (
        event_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        rsvp TEXT NOT NULL DEFAULT 'Pending' CHECK (rsvp IN ('Yes', 'No', 'Pending')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (event_id, profile_id)
      ) STRICT`,
      `CREATE INDEX IF NOT EXISTS idx_event_rosters_profile
       ON event_rosters(profile_id, event_id)`,
    ],
  },
  {
    version: 8,
    statements: [
      `ALTER TABLE event_rosters ADD COLUMN attendance TEXT NOT NULL DEFAULT 'Pending'
       CHECK (attendance IN ('Present', 'Absent', 'Pending'))`,
    ],
  },
  {
    version: 9,
    statements: [
      "ALTER TABLE profiles ADD COLUMN phone TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE profiles ADD COLUMN voice_part TEXT NOT NULL DEFAULT ''",
      `ALTER TABLE profiles ADD COLUMN global_status TEXT NOT NULL DEFAULT 'Active'
       CHECK (global_status IN ('Active', 'Idle', 'Inactive'))`,
      "ALTER TABLE profiles ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE profiles ADD COLUMN show_in_directory INTEGER NOT NULL DEFAULT 1 CHECK (show_in_directory IN (0, 1))",
      "ALTER TABLE profiles ADD COLUMN do_not_email INTEGER NOT NULL DEFAULT 0 CHECK (do_not_email IN (0, 1))",
      "ALTER TABLE profiles ADD COLUMN receive_attendance_reports INTEGER NOT NULL DEFAULT 1 CHECK (receive_attendance_reports IN (0, 1))",
      "ALTER TABLE profiles ADD COLUMN receive_rsvp_decline_notices INTEGER NOT NULL DEFAULT 0 CHECK (receive_rsvp_decline_notices IN (0, 1))",
      "ALTER TABLE profiles ADD COLUMN receive_admin_notifications INTEGER NOT NULL DEFAULT 1 CHECK (receive_admin_notifications IN (0, 1))",
      "ALTER TABLE profiles ADD COLUMN receive_financial_alerts INTEGER NOT NULL DEFAULT 0 CHECK (receive_financial_alerts IN (0, 1))",
      "ALTER TABLE profiles ADD COLUMN is_section_leader INTEGER NOT NULL DEFAULT 0 CHECK (is_section_leader IN (0, 1))",
    ],
  },
  {
    version: 10,
    statements: [
      "ALTER TABLE event_rosters ADD COLUMN folder_number TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE event_rosters ADD COLUMN folder_returned INTEGER NOT NULL DEFAULT 0 CHECK (folder_returned IN (0, 1))",
    ],
  },
  {
    version: 11,
    statements: ["ALTER TABLE event_rosters ADD COLUMN rsvp_note TEXT NOT NULL DEFAULT ''"],
  },
  {
    version: 12,
    statements: [
      `ALTER TABLE organization_metadata ADD COLUMN roster_configuration_json TEXT NOT NULL
       DEFAULT '${JSON.stringify(defaultRosterConfiguration)}'`,
    ],
  },
  {
    version: 13,
    statements: [
      `ALTER TABLE organization_metadata ADD COLUMN seating_configuration_json TEXT NOT NULL
       DEFAULT '${JSON.stringify(defaultSeatingConfiguration)}'`,
      `CREATE TABLE seating_charts (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        venue_id TEXT,
        name TEXT NOT NULL,
        formation_id TEXT NOT NULL,
        row_counts_json TEXT NOT NULL,
        section_suggestions_json TEXT NOT NULL DEFAULT '{}',
        assignments_json TEXT NOT NULL DEFAULT '{}',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX idx_seating_charts_event_order
       ON seating_charts(event_id, sort_order, name, id)`,
    ],
  },
  {
    version: 14,
    statements: [
      `CREATE TABLE music_pieces (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        composer TEXT NOT NULL DEFAULT '',
        arranger TEXT NOT NULL DEFAULT '',
        purchase_date TEXT,
        copies INTEGER CHECK (copies IS NULL OR copies >= 0),
        catalog_id TEXT NOT NULL DEFAULT '',
        duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
        notes TEXT NOT NULL DEFAULT '',
        section_buckets_json TEXT NOT NULL DEFAULT '[]',
        genres_json TEXT NOT NULL DEFAULT '[]',
        parent_id TEXT,
        track_file_ids_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX idx_music_pieces_title
       ON music_pieces(title COLLATE NOCASE, id)`,
      `CREATE INDEX idx_music_pieces_parent
       ON music_pieces(parent_id, created_at, id)`,
    ],
  },
  {
    version: 15,
    statements: [
      `CREATE TABLE organization_resources (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        file_id TEXT,
        url TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((file_id IS NULL) <> (url IS NULL))
      ) STRICT`,
      `CREATE INDEX idx_organization_resources_order
       ON organization_resources(sort_order, title COLLATE NOCASE, id)`,
    ],
  },
  {
    version: 16,
    statements: ["ALTER TABLE profiles ADD COLUMN photo_file_id TEXT"],
  },
] as const;

export const currentOrganizationSchemaVersion = organizationSchemaMigrations.at(-1)?.version ?? 0;
