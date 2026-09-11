import type { OrganizationInvitationSummary } from "@choir/contracts";

import type { createAuth } from "../../auth/config";

export interface InvitationControlRow {
  readonly createdAt: number | string;
  readonly email: string;
  readonly expiresAt: number | string;
  readonly id: string;
  readonly inviterId: string;
  readonly organizationId: string;
  readonly role: string | null;
  readonly status: string;
}

export interface AccountSessionRow {
  readonly activeOrganizationId: string | null;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly id: string;
  readonly ipAddress: string | null;
  readonly token: string;
  readonly updatedAt: number;
  readonly userAgent: string | null;
  readonly userId: string;
}

export function normalizeInvitationRole(
  role: string | null,
): OrganizationInvitationSummary["role"] | null {
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

export function invitationDate(value: number | string): string {
  return new Date(value).toISOString();
}

export async function findInvitationForOrganization(
  database: D1Database,
  invitationId: string,
  organizationId: string,
): Promise<InvitationControlRow | null> {
  return database
    .prepare(
      `SELECT id, organizationId, email, role, status, expiresAt, createdAt, inviterId
       FROM invitation
       WHERE id = ? AND organizationId = ?
       LIMIT 1`,
    )
    .bind(invitationId, organizationId)
    .first<InvitationControlRow>();
}

export async function recordInvitationAudit(
  database: D1Database,
  input: {
    readonly action: string;
    readonly actorUserId: string;
    readonly changeSummary: Readonly<Record<string, string>>;
    readonly invitationId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO platform_audit_events
        (id, actor_user_id, organization_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, ?, ?, ?, 'organization_invitation', ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.actorUserId,
      input.organizationId,
      input.action,
      input.invitationId,
      input.requestId,
      JSON.stringify(input.changeSummary),
      new Date().toISOString(),
    )
    .run();
}

export async function ensurePendingIdentity(database: D1Database, email: string): Promise<string> {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await database
    .prepare("SELECT id FROM user WHERE LOWER(email) = ? LIMIT 1")
    .bind(normalizedEmail)
    .first<{ id: string }>();
  if (existing) {
    return existing.id;
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const defaultName = email.split("@", 1)[0] ?? "Invited member";
  await database
    .prepare(
      `INSERT OR IGNORE INTO user
        (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
       VALUES (?, ?, ?, 0, ?, ?, 0)`,
    )
    .bind(id, defaultName, normalizedEmail, now, now)
    .run();
  const inserted = await database
    .prepare("SELECT id FROM user WHERE LOWER(email) = ? LIMIT 1")
    .bind(normalizedEmail)
    .first<{ id: string }>();
  return inserted?.id ?? id;
}

export async function ensurePendingInvitationIdentity(
  database: D1Database,
  auth: ReturnType<typeof createAuth>,
  headers: Headers,
  invitationId: string,
  email: string,
): Promise<void> {
  try {
    await ensurePendingIdentity(database, email);
  } catch {
    await auth.api.cancelInvitation({ body: { invitationId }, headers }).catch(() => undefined);
    throw new Error("Pending invitation identity creation failed.");
  }
}
