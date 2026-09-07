import { describe, expect, it } from "vitest";

import {
  convertRegistryVerifiedAt,
  normalizeRegistryDomain,
  syncOrganizationEmailDomainRegistry,
  type EmailDomainRegistryDatabase,
} from "./emailDomainRegistry";

interface RegistryRow {
  readonly created_at: number;
  readonly domain: string;
  readonly id: string;
  readonly organization_id: string;
  readonly status: string;
  readonly verified_at: number | null;
}

interface MockStatement {
  readonly bind: (...params: readonly unknown[]) => {
    readonly first: () => Promise<{ readonly organization_id: string } | null>;
    readonly run: () => Promise<{ readonly meta: { readonly changes: number } }>;
  };
}

function toRowDomain(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toRowOrganization(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function createMockDb(initial: readonly RegistryRow[] = []): {
  readonly db: EmailDomainRegistryDatabase;
  readonly rows: () => readonly RegistryRow[];
} {
  const rows = new Map<string, RegistryRow>();
  for (const row of initial) rows.set(row.domain, { ...row });

  function firstOwner(domain: string): { readonly organization_id: string } | null {
    const row = rows.get(domain);
    return row ? { organization_id: row.organization_id } : null;
  }

  function deleteStale(organizationId: string, domain: string): number {
    let changes = 0;
    for (const [key, row] of [...rows]) {
      if (row.organization_id === organizationId && row.domain !== domain) {
        rows.delete(key);
        changes += 1;
      }
    }
    return changes;
  }

  function deleteForOrganization(organizationId: string): number {
    let changes = 0;
    for (const [key, row] of [...rows]) {
      if (row.organization_id === organizationId) {
        rows.delete(key);
        changes += 1;
      }
    }
    return changes;
  }

  function updateRow(
    status: string,
    verifiedAt: number | null,
    domain: string,
    organizationId: string,
  ): number {
    const row = rows.get(domain);
    if (row?.organization_id === organizationId) {
      rows.set(domain, { ...row, status, verified_at: verifiedAt });
      return 1;
    }
    return 0;
  }

  function insertRow(params: readonly unknown[]): number {
    const id = typeof params[0] === "string" ? params[0] : "";
    const organizationId = toRowOrganization(params[1]);
    const domain = toRowDomain(params[2]);
    const status = typeof params[3] === "string" ? params[3] : "";
    const createdAt = typeof params[4] === "number" ? params[4] : Date.now();
    const verifiedAt = typeof params[5] === "number" ? params[5] : null;
    if (rows.has(domain)) {
      throw new Error("UNIQUE constraint failed: organization_email_domains.domain");
    }
    rows.set(domain, {
      created_at: createdAt,
      domain,
      id,
      organization_id: organizationId,
      status,
      verified_at: verifiedAt,
    });
    return 1;
  }

  function runQuery(query: string, params: readonly unknown[]): number {
    if (
      query.startsWith(
        "DELETE FROM organization_email_domains WHERE organization_id = ? AND domain !=",
      )
    ) {
      return deleteStale(toRowOrganization(params[0]), toRowDomain(params[1]));
    }
    if (query.startsWith("DELETE FROM organization_email_domains WHERE organization_id")) {
      return deleteForOrganization(toRowOrganization(params[0]));
    }
    if (query.startsWith("UPDATE organization_email_domains SET status")) {
      const status = typeof params[0] === "string" ? params[0] : "";
      const verifiedAt = typeof params[1] === "number" ? params[1] : null;
      return updateRow(status, verifiedAt, toRowDomain(params[2]), toRowOrganization(params[3]));
    }
    if (query.includes("INSERT INTO organization_email_domains")) {
      return insertRow(params);
    }
    return 0;
  }

  const db = {
    prepare(query: string): MockStatement {
      return {
        bind: (...params: readonly unknown[]) => ({
          first: () => {
            if (
              query.includes("SELECT organization_id FROM organization_email_domains WHERE domain")
            ) {
              return Promise.resolve(firstOwner(toRowDomain(params[0])));
            }
            return Promise.resolve(null);
          },
          run: () => Promise.resolve({ meta: { changes: runQuery(query, params) } }),
        }),
      };
    },
  };

  return {
    db,
    rows: () => [...rows.values()],
  };
}

describe("emailDomainRegistry", () => {
  it("normalizes domains and converts verified timestamps", () => {
    expect(normalizeRegistryDomain("  Mail.Example.ORG ")).toBe("mail.example.org");
    expect(convertRegistryVerifiedAt("2026-01-01T00:00:00.000Z")).toBe(
      Date.parse("2026-01-01T00:00:00.000Z"),
    );
    expect(convertRegistryVerifiedAt(null)).toBeNull();
    expect(convertRegistryVerifiedAt("not-a-date")).toBeNull();
  });

  it("inserts pending rows and updates them to active", async () => {
    const { db, rows } = createMockDb();
    const inserted = await syncOrganizationEmailDomainRegistry(db, {
      customDomain: "Mail.Example.org",
      organizationId: "org-a",
      status: "pending",
      verifiedAt: null,
    });
    expect(inserted).toEqual({ ok: true });
    expect(rows()).toHaveLength(1);

    const updated = await syncOrganizationEmailDomainRegistry(db, {
      customDomain: "mail.example.org",
      organizationId: "org-a",
      status: "active",
      verifiedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(updated).toEqual({ ok: true });
    const current = rows()[0];
    expect(current?.status).toBe("active");
    expect(current?.verified_at).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });

  it("removes stale rows when the domain changes or is cleared", async () => {
    const { db, rows } = createMockDb([
      {
        created_at: 1,
        domain: "old.example.org",
        id: "id-1",
        organization_id: "org-a",
        status: "active",
        verified_at: 1,
      },
    ]);
    const changed = await syncOrganizationEmailDomainRegistry(db, {
      customDomain: "new.example.org",
      organizationId: "org-a",
      status: "pending",
      verifiedAt: null,
    });
    expect(changed).toEqual({ ok: true });
    expect(rows().map((row) => row.domain)).toEqual(["new.example.org"]);

    const cleared = await syncOrganizationEmailDomainRegistry(db, {
      customDomain: null,
      organizationId: "org-a",
      status: "pending",
      verifiedAt: null,
    });
    expect(cleared).toEqual({ ok: true });
    expect(rows()).toHaveLength(0);
  });

  it("refuses to reassign a domain owned by another organization", async () => {
    const { db } = createMockDb([
      {
        created_at: 1,
        domain: "shared.example.org",
        id: "id-1",
        organization_id: "org-other",
        status: "active",
        verified_at: 1,
      },
    ]);
    const result = await syncOrganizationEmailDomainRegistry(db, {
      customDomain: "shared.example.org",
      organizationId: "org-a",
      status: "pending",
      verifiedAt: null,
    });
    expect(result).toEqual({
      code: "domain_in_use",
      message: "This email domain is already assigned to another organization.",
      ok: false,
    });
  });

  it("preserves degraded status and the last successful verification time", async () => {
    const { db, rows } = createMockDb();
    await syncOrganizationEmailDomainRegistry(db, {
      customDomain: "mail.example.org",
      organizationId: "org-a",
      status: "active",
      verifiedAt: "2026-01-01T00:00:00.000Z",
    });
    const degraded = await syncOrganizationEmailDomainRegistry(db, {
      customDomain: "mail.example.org",
      organizationId: "org-a",
      status: "degraded",
      verifiedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(degraded).toEqual({ ok: true });
    const current = rows()[0];
    expect(current?.status).toBe("degraded");
    expect(current?.verified_at).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });
});
