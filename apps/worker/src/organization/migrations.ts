import { organizationSchemaMigrations } from "./schema";

export function migrateOrganization(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS organization_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT`);

  const appliedRows = [
    ...sql.exec<{ version: number }>("SELECT version FROM organization_schema_migrations"),
  ];
  const appliedVersions = new Set(appliedRows.map((row) => row.version));

  for (const migration of organizationSchemaMigrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    for (const statement of migration.statements) {
      sql.exec(statement);
    }
    sql.exec(
      "INSERT INTO organization_schema_migrations (version, applied_at) VALUES (?, ?)",
      migration.version,
      new Date().toISOString(),
    );
  }
}
