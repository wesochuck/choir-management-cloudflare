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
] as const;

export const currentOrganizationSchemaVersion = organizationSchemaMigrations.at(-1)?.version ?? 0;
