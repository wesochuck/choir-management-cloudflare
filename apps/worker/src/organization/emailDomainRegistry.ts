// Worker-side control-plane mirror for `organization_email_domains`.

export interface EmailDomainRegistryDatabase {
  readonly prepare: (query: string) => {
    readonly bind: (...params: readonly unknown[]) => {
      readonly first: () => Promise<unknown>;
      readonly run: () => Promise<{ readonly meta: { readonly changes: number } }>;
    };
  };
}
// The Organization Durable Object remains authoritative; this helper only
// reconciles the derived D1 index after a successful DO mutation or commit.
//
// Current repository inspection (2026-09-07): no production code reads
// `organization_email_domains` besides this mirror and tests. The table is a
// disposable derived cache with a globally unique `domain` column, so the
// helper still fails closed on cross-Organization ownership rather than
// silently reassigning a row. The PUT route restores prior DO settings when a
// concurrent claim wins the D1 race.

export type EmailDomainRegistryStatus = "active" | "degraded" | "pending";

export interface SyncEmailDomainRegistryInput {
  readonly customDomain: string | null;
  readonly organizationId: string;
  readonly status: EmailDomainRegistryStatus;
  readonly verifiedAt: string | null;
}

export type SyncEmailDomainRegistryResult =
  | { readonly ok: true }
  | {
      readonly code: "domain_in_use";
      readonly message: string;
      readonly ok: false;
    }
  | {
      readonly code: "sync_failed";
      readonly message: string;
      readonly ok: false;
    };

export function normalizeRegistryDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.+$/, "");
}

export function convertRegistryVerifiedAt(verifiedAt: string | null): number | null {
  if (!verifiedAt) return null;
  const parsed = Date.parse(verifiedAt);
  return Number.isNaN(parsed) ? null : parsed;
}

function domainViolationMessage(error: unknown): string {
  if (typeof error !== "object" || error === null || !("message" in error)) return "";
  const raw = (error as { readonly message: unknown }).message;
  return typeof raw === "string" ? raw : "";
}

function isUniqueDomainViolation(error: unknown): boolean {
  const message = domainViolationMessage(error);
  return (
    message.includes("UNIQUE constraint failed") && message.includes("organization_email_domains")
  );
}

interface DomainOwnerRow {
  readonly organization_id: string;
}

function isDomainOwnerRow(value: unknown): value is DomainOwnerRow {
  if (typeof value !== "object" || value === null) return false;
  if (!("organization_id" in value)) return false;
  return typeof Object.getOwnPropertyDescriptor(value, "organization_id")?.value === "string";
}

async function readDomainOwner(
  db: EmailDomainRegistryDatabase,
  domain: string,
): Promise<{ readonly ok: true; readonly owner: string | null } | { readonly ok: false }> {
  try {
    const raw: unknown = await db
      .prepare("SELECT organization_id FROM organization_email_domains WHERE domain = ? LIMIT 1")
      .bind(domain)
      .first();
    if (raw === null) return { ok: true, owner: null };
    if (!isDomainOwnerRow(raw)) return { ok: false };
    return { ok: true, owner: raw.organization_id };
  } catch {
    return { ok: false };
  }
}

function domainInUseResult(): SyncEmailDomainRegistryResult {
  return {
    code: "domain_in_use",
    message: "This email domain is already assigned to another organization.",
    ok: false,
  };
}

function syncFailedResult(message: string): SyncEmailDomainRegistryResult {
  return { code: "sync_failed", message, ok: false };
}

async function deleteRegistryRowsForOrganization(
  db: EmailDomainRegistryDatabase,
  organizationId: string,
): Promise<boolean> {
  try {
    await db
      .prepare("DELETE FROM organization_email_domains WHERE organization_id = ?")
      .bind(organizationId)
      .run();
    return true;
  } catch {
    return false;
  }
}

async function deleteStaleRegistryRows(
  db: EmailDomainRegistryDatabase,
  organizationId: string,
  domain: string,
): Promise<boolean> {
  try {
    await db
      .prepare("DELETE FROM organization_email_domains WHERE organization_id = ? AND domain != ?")
      .bind(organizationId, domain)
      .run();
    return true;
  } catch {
    return false;
  }
}

async function updateExistingRegistryRow(
  db: EmailDomainRegistryDatabase,
  domain: string,
  organizationId: string,
  status: EmailDomainRegistryStatus,
  verifiedAtMs: number | null,
): Promise<{ readonly ok: true; readonly updated: boolean } | { readonly ok: false }> {
  try {
    const updated = await db
      .prepare(
        "UPDATE organization_email_domains SET status = ?, verified_at = ? WHERE domain = ? AND organization_id = ?",
      )
      .bind(status, verifiedAtMs, domain, organizationId)
      .run();
    return { ok: true, updated: updated.meta.changes > 0 };
  } catch {
    return { ok: false };
  }
}

async function insertRegistryRow(
  db: EmailDomainRegistryDatabase,
  domain: string,
  organizationId: string,
  status: EmailDomainRegistryStatus,
  verifiedAtMs: number | null,
): Promise<SyncEmailDomainRegistryResult> {
  try {
    await db
      .prepare(
        `INSERT INTO organization_email_domains
          (id, organization_id, domain, status, created_at, verified_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), organizationId, domain, status, Date.now(), verifiedAtMs)
      .run();
    return { ok: true };
  } catch (error: unknown) {
    if (isUniqueDomainViolation(error)) return domainInUseResult();
    return syncFailedResult("Email domain registry update failed.");
  }
}

async function upsertRegistryRow(
  db: EmailDomainRegistryDatabase,
  domain: string,
  organizationId: string,
  status: EmailDomainRegistryStatus,
  verifiedAtMs: number | null,
): Promise<SyncEmailDomainRegistryResult> {
  const updated = await updateExistingRegistryRow(db, domain, organizationId, status, verifiedAtMs);
  if (!updated.ok) return syncFailedResult("Email domain registry update failed.");
  if (updated.updated) return { ok: true };
  return insertRegistryRow(db, domain, organizationId, status, verifiedAtMs);
}

export async function syncOrganizationEmailDomainRegistry(
  db: EmailDomainRegistryDatabase,
  input: SyncEmailDomainRegistryInput,
): Promise<SyncEmailDomainRegistryResult> {
  const { organizationId } = input;
  const rawDomain = input.customDomain?.trim() ?? "";
  if (!rawDomain) {
    const deleted = await deleteRegistryRowsForOrganization(db, organizationId);
    return deleted ? { ok: true } : syncFailedResult("Email domain registry cleanup failed.");
  }

  const domain = normalizeRegistryDomain(rawDomain);
  const verifiedAtMs = convertRegistryVerifiedAt(input.verifiedAt);

  const preflight = await readDomainOwner(db, domain);
  if (!preflight.ok) {
    return syncFailedResult("Email domain registry ownership check failed.");
  }
  if (preflight.owner !== null && preflight.owner !== organizationId) {
    return domainInUseResult();
  }

  const staleCleaned = await deleteStaleRegistryRows(db, organizationId, domain);
  if (!staleCleaned) {
    return syncFailedResult("Email domain registry cleanup failed.");
  }

  return upsertRegistryRow(db, domain, organizationId, input.status, verifiedAtMs);
}
