import { organizationSchemaMigrations, type OrganizationSchemaMigration } from "./schema";

export function applyOrganizationMigration(
  storage: DurableObjectStorage,
  migration: OrganizationSchemaMigration,
  appliedAt = new Date().toISOString(),
): void {
  storage.transactionSync(() => {
    const sql = storage.sql;
    migration.apply?.(sql);
    for (const statement of migration.statements) {
      sql.exec(statement);
    }
    sql.exec(
      "INSERT INTO organization_schema_migrations (version, applied_at) VALUES (?, ?)",
      migration.version,
      appliedAt,
    );
  });
}

export function migrateOrganization(storage: DurableObjectStorage): void {
  storage.transactionSync(() => {
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS organization_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT`);
  });

  const appliedRows = [
    ...storage.sql.exec<{ version: number }>("SELECT version FROM organization_schema_migrations"),
  ];
  const appliedVersions = new Set(appliedRows.map((row) => row.version));

  for (const migration of organizationSchemaMigrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }
    applyOrganizationMigration(storage, migration);
  }
}
