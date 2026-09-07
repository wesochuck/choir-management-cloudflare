import type { SqlStorageValue } from "@cloudflare/workers-types";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  organizationEmailDomainDnsRecordSchema,
  type OrganizationEmailDomainDnsRecord,
} from "@choir/contracts";
import { z } from "zod";

import {
  buildCanonicalVerificationPayload,
  computeEmailDomainConfigurationId,
  normalizeEmailDomain,
} from "./emailDomainVerification";
import {
  commitEmailDomainVerificationInStore,
  generateRequiredDnsRecords,
  prepareEmailDomainVerificationInStore,
  type EmailVerificationStorage,
} from "./organizationEmailSettingsStore";
import { organizationSchemaMigrations } from "./schema/migrations";

const ORG_ID = "org-email-verify-test";

function toSupportedValue(value: unknown): null | number | bigint | string | Uint8Array {
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

function isReadQuery(query: string): boolean {
  const normalized = query.trim().toUpperCase();
  return (
    normalized.startsWith("SELECT") ||
    normalized.startsWith("PRAGMA") ||
    normalized.startsWith("EXPLAIN") ||
    normalized.startsWith("WITH")
  );
}

function isRowArray<T>(value: unknown): value is T[] {
  return Array.isArray(value);
}

function createStorage(db: DatabaseSync): EmailVerificationStorage {
  let depth = 0;
  const exec = <T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: readonly unknown[]
  ): { readonly toArray: () => T[] } => {
    const statement = db.prepare(query);
    const params = bindings.map(toSupportedValue);
    if (isReadQuery(query)) {
      const raw: unknown = statement.all(...params);
      const rows: T[] = isRowArray<T>(raw) ? raw : [];
      return { toArray: () => rows };
    }
    statement.run(...params);
    const empty: T[] = [];
    return { toArray: () => empty };
  };
  return {
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
          // Preserve the original error.
        }
        throw error;
      }
    },
  };
}

function runMigrations(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS organization_schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT`);
  for (const migration of organizationSchemaMigrations) {
    for (const statement of migration.statements) {
      db.exec(statement);
    }
    db.prepare(
      "INSERT OR IGNORE INTO organization_schema_migrations (version, applied_at) VALUES (?, ?)",
    ).run(migration.version, new Date().toISOString());
  }
}

function createContext(organizationId = ORG_ID): {
  readonly db: DatabaseSync;
  readonly storage: EmailVerificationStorage;
} {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO organization_metadata (organization_id, name, slug, lifecycle_state, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)`,
  ).run(organizationId, "Email Test Org", "email-test", now, now);
  return { db, storage: createStorage(db) };
}

function seedDomain(db: DatabaseSync, organizationId: string, customDomain: string | null): void {
  const now = new Date().toISOString();
  if (customDomain === null) {
    db.prepare("DELETE FROM organization_email_settings WHERE organization_id = ?").run(
      organizationId,
    );
    return;
  }
  const normalized = customDomain.trim().toLowerCase().replace(/\.+$/, "");
  const recordsJson = JSON.stringify(generateRequiredDnsRecords(normalized));
  db.prepare(
    `INSERT INTO organization_email_settings
      (organization_id, from_name, reply_to_email, custom_domain, custom_domain_status,
       dns_records_json, verified_at, last_checked_at, updated_at)
     VALUES (?, NULL, NULL, ?, 'pending', ?, NULL, NULL, ?)
     ON CONFLICT(organization_id) DO UPDATE SET
       custom_domain = excluded.custom_domain,
       custom_domain_status = 'pending',
       dns_records_json = excluded.dns_records_json,
       verified_at = NULL,
       updated_at = excluded.updated_at`,
  ).run(organizationId, normalized, recordsJson, now);
}

function configureDomain(
  db: DatabaseSync,
  organizationId: string,
  customDomain: string | null,
): void {
  seedDomain(db, organizationId, customDomain);
}

function configureSenderName(db: DatabaseSync, organizationId: string, fromName: string): void {
  db.prepare("UPDATE organization_email_settings SET from_name = ? WHERE organization_id = ?").run(
    fromName,
    organizationId,
  );
}

function withStatuses(
  records: readonly OrganizationEmailDomainDnsRecord[],
  status: OrganizationEmailDomainDnsRecord["status"],
): OrganizationEmailDomainDnsRecord[] {
  return records.map((record) => ({ ...record, status }));
}

function descriptorValue(row: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(row, key)?.value;
}

function isStatusRow(value: unknown): value is {
  readonly lastCheckedAt: string | null;
  readonly recordsJson: string;
  readonly status: string;
  readonly verifiedAt: string | null;
} {
  if (typeof value !== "object" || value === null) return false;
  if (!(
    "status" in value &&
    "verifiedAt" in value &&
    "lastCheckedAt" in value &&
    "recordsJson" in value
  )) {
    return false;
  }
  const status = descriptorValue(value, "status");
  const verifiedAt = descriptorValue(value, "verifiedAt");
  const lastCheckedAt = descriptorValue(value, "lastCheckedAt");
  const recordsJson = descriptorValue(value, "recordsJson");
  return (
    typeof status === "string" &&
    (typeof verifiedAt === "string" || verifiedAt === null) &&
    (typeof lastCheckedAt === "string" || lastCheckedAt === null) &&
    typeof recordsJson === "string"
  );
}

function readStatus(
  db: DatabaseSync,
  organizationId: string,
): {
  readonly lastCheckedAt: string | null;
  readonly records: OrganizationEmailDomainDnsRecord[];
  readonly status: string;
  readonly verifiedAt: string | null;
} {
  const row: unknown = db
    .prepare(
      "SELECT custom_domain_status AS status, verified_at AS verifiedAt, last_checked_at AS lastCheckedAt, dns_records_json AS recordsJson FROM organization_email_settings WHERE organization_id = ?",
    )
    .get(organizationId);
  if (!isStatusRow(row)) throw new Error("Missing email settings row.");
  const parsed: unknown = JSON.parse(row.recordsJson);
  const recordsParsed = z.array(organizationEmailDomainDnsRecordSchema).safeParse(parsed);
  const records = recordsParsed.success ? [...recordsParsed.data] : [];
  return {
    lastCheckedAt: row.lastCheckedAt,
    records,
    status: row.status,
    verifiedAt: row.verifiedAt,
  };
}

function firstRecord(
  records: readonly OrganizationEmailDomainDnsRecord[],
): OrganizationEmailDomainDnsRecord {
  const record = records[0];
  if (record === undefined) throw new Error("Expected at least one DNS record.");
  return record;
}

describe("email-domain verification configuration identity", () => {
  it("normalizes domains and ignores mutable sender fields", async () => {
    const { db, storage } = createContext();
    configureDomain(db, ORG_ID, "Mail.Example.ORG ");
    const prepared = await prepareEmailDomainVerificationInStore(storage, ORG_ID);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.customDomain).toBe("mail.example.org");
    expect(prepared.dnsRecords).toHaveLength(4);

    const recomputed = await computeEmailDomainConfigurationId(
      "mail.example.org",
      prepared.dnsRecords,
    );
    expect(prepared.configurationId).toBe(recomputed);

    configureSenderName(db, ORG_ID, "New Name");
    const reprepared = await prepareEmailDomainVerificationInStore(storage, ORG_ID);
    expect(reprepared.ok).toBe(true);
    if (!reprepared.ok) return;
    expect(reprepared.configurationId).toBe(prepared.configurationId);
  });

  it("produces stable canonical payloads independent of record order and status", async () => {
    const records = [...generateRequiredDnsRecords("mail.example.org")];
    const shuffled = [...records].reverse();
    const withValid = withStatuses(records, "valid");
    expect(buildCanonicalVerificationPayload("mail.example.org", records)).toBe(
      buildCanonicalVerificationPayload("MAIL.EXAMPLE.ORG.", shuffled),
    );
    expect(await computeEmailDomainConfigurationId("mail.example.org", records)).toBe(
      await computeEmailDomainConfigurationId("mail.example.org", withValid),
    );
    expect(normalizeEmailDomain("  Mail.Example.ORG ")).toBe("mail.example.org");
  });

  it("fails prepare when no custom domain is configured", async () => {
    const { storage } = createContext();
    const result = await prepareEmailDomainVerificationInStore(storage, ORG_ID);
    expect(result).toEqual({ code: "no_custom_domain_configured", ok: false, status: 400 });
  });

  it("rejects prepare for a mismatched organization identity", async () => {
    const { db, storage } = createContext();
    configureDomain(db, ORG_ID, "mail.example.org");
    const result = await prepareEmailDomainVerificationInStore(storage, "org-other");
    expect(result).toEqual({ code: "organization_identity_conflict", ok: false, status: 409 });
  });
});

describe("email-domain verification commit semantics", () => {
  it("commits all-valid results as active with checked and verified timestamps", async () => {
    const { db, storage } = createContext();
    configureDomain(db, ORG_ID, "mail.example.org");
    const prepared = await prepareEmailDomainVerificationInStore(storage, ORG_ID);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const checkedAt = new Date().toISOString();
    const committed = await commitEmailDomainVerificationInStore(storage, {
      checkedAt,
      configurationId: prepared.configurationId,
      dnsRecords: withStatuses(prepared.dnsRecords, "valid"),
      organizationId: ORG_ID,
    });
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(committed.status).toBe("active");
    expect(committed.allValid).toBe(true);
    expect(committed.verifiedAt).toBe(checkedAt);
    expect(committed.lastCheckedAt).toBe(checkedAt);
    const stored = readStatus(db, ORG_ID);
    expect(stored.status).toBe("active");
    expect(stored.verifiedAt).toBe(checkedAt);
  });

  it("keeps first inconclusive-configured domain pending", async () => {
    const { db, storage } = createContext();
    configureDomain(db, ORG_ID, "mail.example.org");
    const prepared = await prepareEmailDomainVerificationInStore(storage, ORG_ID);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const mixed = prepared.dnsRecords.map((record, index) =>
      index === 0
        ? { ...record, status: "invalid" as const }
        : { ...record, status: "valid" as const },
    );
    const checkedAt = new Date().toISOString();
    const committed = await commitEmailDomainVerificationInStore(storage, {
      checkedAt,
      configurationId: prepared.configurationId,
      dnsRecords: mixed,
      organizationId: ORG_ID,
    });
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(committed.status).toBe("pending");
    expect(committed.verifiedAt).toBeNull();
    expect(readStatus(db, ORG_ID).status).toBe("pending");
  });

  it("degrades a previously active domain while preserving the last verified timestamp", async () => {
    const { db, storage } = createContext();
    configureDomain(db, ORG_ID, "mail.example.org");
    const prepared = await prepareEmailDomainVerificationInStore(storage, ORG_ID);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const firstCheckedAt = "2026-01-01T00:00:00.000Z";
    const first = await commitEmailDomainVerificationInStore(storage, {
      checkedAt: firstCheckedAt,
      configurationId: prepared.configurationId,
      dnsRecords: withStatuses(prepared.dnsRecords, "valid"),
      organizationId: ORG_ID,
    });
    if (!first.ok) throw new Error("Expected first commit to succeed.");
    expect(first.status).toBe("active");

    const failing = prepared.dnsRecords.map((record) => ({
      ...record,
      status: "pending" as const,
    }));
    const secondCheckedAt = "2026-02-01T00:00:00.000Z";
    const second = await commitEmailDomainVerificationInStore(storage, {
      checkedAt: secondCheckedAt,
      configurationId: prepared.configurationId,
      dnsRecords: failing,
      organizationId: ORG_ID,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.status).toBe("degraded");
    expect(second.verifiedAt).toBe(firstCheckedAt);
    expect(second.lastCheckedAt).toBe(secondCheckedAt);
    const stored = readStatus(db, ORG_ID);
    expect(stored.status).toBe("degraded");
    expect(stored.verifiedAt).toBe(firstCheckedAt);

    const recheckedAt = "2026-03-01T00:00:00.000Z";
    const third = await commitEmailDomainVerificationInStore(storage, {
      checkedAt: recheckedAt,
      configurationId: prepared.configurationId,
      dnsRecords: withStatuses(prepared.dnsRecords, "valid"),
      organizationId: ORG_ID,
    });
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.status).toBe("active");
    expect(third.verifiedAt).toBe(recheckedAt);
  });

  it("rejects stale commits without mutating verification state", async () => {
    const { db, storage } = createContext();
    configureDomain(db, ORG_ID, "mail.example.org");
    const prepared = await prepareEmailDomainVerificationInStore(storage, ORG_ID);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    configureDomain(db, ORG_ID, "other.example.org");
    const before = readStatus(db, ORG_ID);
    const stale = await commitEmailDomainVerificationInStore(storage, {
      checkedAt: new Date().toISOString(),
      configurationId: prepared.configurationId,
      dnsRecords: withStatuses(prepared.dnsRecords, "valid"),
      organizationId: ORG_ID,
    });
    expect(stale).toEqual({
      code: "stale_email_domain_verification",
      ok: false,
      status: 409,
    });
    const after = readStatus(db, ORG_ID);
    expect(after.status).toBe(before.status);
    expect(after.lastCheckedAt).toBe(before.lastCheckedAt);
  });

  it("rejects missing, extra, and altered authoritative fields", async () => {
    const { db, storage } = createContext();
    configureDomain(db, ORG_ID, "mail.example.org");
    const prepared = await prepareEmailDomainVerificationInStore(storage, ORG_ID);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const checkedAt = new Date().toISOString();
    const valid = withStatuses(prepared.dnsRecords, "valid");

    const missing = await commitEmailDomainVerificationInStore(storage, {
      checkedAt,
      configurationId: prepared.configurationId,
      dnsRecords: valid.slice(1),
      organizationId: ORG_ID,
    });
    expect(missing).toMatchObject({ code: "invalid_verification_result", ok: false });

    const extraRecord = firstRecord(prepared.dnsRecords);
    const extra = await commitEmailDomainVerificationInStore(storage, {
      checkedAt,
      configurationId: prepared.configurationId,
      dnsRecords: [...valid, { ...extraRecord, status: "valid" as const }],
      organizationId: ORG_ID,
    });
    expect(extra).toMatchObject({ code: "invalid_verification_result", ok: false });

    const altered = prepared.dnsRecords.map((record) =>
      record.purpose === "spf"
        ? { ...record, status: "valid" as const, value: "v=spf1 altered" }
        : { ...record, status: "valid" as const },
    );
    const alteredResult = await commitEmailDomainVerificationInStore(storage, {
      checkedAt,
      configurationId: prepared.configurationId,
      dnsRecords: altered,
      organizationId: ORG_ID,
    });
    expect(alteredResult).toMatchObject({ code: "invalid_verification_result", ok: false });
  });

  it("rejects organization identity mismatches and stays idempotent", async () => {
    const { db, storage } = createContext();
    configureDomain(db, ORG_ID, "mail.example.org");
    const prepared = await prepareEmailDomainVerificationInStore(storage, ORG_ID);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const checkedAt = new Date().toISOString();
    const valid = withStatuses(prepared.dnsRecords, "valid");

    const mismatched = await commitEmailDomainVerificationInStore(storage, {
      checkedAt,
      configurationId: prepared.configurationId,
      dnsRecords: valid,
      organizationId: "org-other",
    });
    expect(mismatched).toEqual({
      code: "organization_identity_conflict",
      ok: false,
      status: 409,
    });

    const first = await commitEmailDomainVerificationInStore(storage, {
      checkedAt,
      configurationId: prepared.configurationId,
      dnsRecords: valid,
      organizationId: ORG_ID,
    });
    const second = await commitEmailDomainVerificationInStore(storage, {
      checkedAt,
      configurationId: prepared.configurationId,
      dnsRecords: valid,
      organizationId: ORG_ID,
    });
    expect(first).toEqual(second);
  });
});
