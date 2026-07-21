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
] as const;

export const currentOrganizationSchemaVersion = organizationSchemaMigrations.at(-1)?.version ?? 0;
