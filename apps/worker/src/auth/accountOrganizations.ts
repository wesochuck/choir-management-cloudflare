import type { AccountOrganization } from "@choir/contracts";

interface AccountOrganizationRow {
  readonly canonicalHostname: string;
  readonly canonicalStatus: "active" | "disabled" | "pending";
  readonly lifecycleState: "active" | "provisioning" | "suspended";
  readonly name: string;
  readonly organizationId: string;
  readonly profileId: string | null;
  readonly role: string;
  readonly slug: string;
}

function normalizeRole(role: string): AccountOrganization["role"] | null {
  switch (role) {
    case "admin":
      return "administrator";
    case "member":
    case "owner":
      return role;
    default:
      return null;
  }
}

export async function listAccountOrganizations(
  database: D1Database,
  userId: string,
): Promise<readonly AccountOrganization[]> {
  const rows = await database
    .prepare(
      `SELECT o.id AS organizationId, o.name, o.slug,
        o.lifecycle_state AS lifecycleState, m.role, m.profileId,
        d.hostname AS canonicalHostname, d.status AS canonicalStatus
       FROM member m
       JOIN organizations o ON o.id = m.organizationId
       JOIN organization_domains d
         ON d.organization_id = o.id
         AND d.kind = 'canonical'
         AND d.id = (
           SELECT canonical.id
           FROM organization_domains canonical
           WHERE canonical.organization_id = o.id AND canonical.kind = 'canonical'
           ORDER BY canonical.created_at, canonical.id
           LIMIT 1
         )
       WHERE m.userId = ?
       ORDER BY o.name, o.id`,
    )
    .bind(userId)
    .all<AccountOrganizationRow>();

  return rows.results.flatMap((row) => {
    const role = normalizeRole(row.role);
    return role ? [{ ...row, role }] : [];
  });
}
