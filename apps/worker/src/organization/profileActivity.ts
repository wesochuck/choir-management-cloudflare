import { z } from "zod";
import {
  organizationProfileActivityResponseSchema,
  type OrganizationProfileActivityActor,
  type OrganizationProfileActivityEvent,
  type OrganizationProfileActivityResponse,
  type OrganizationProfilePortalActivity,
} from "@choir/contracts";
import type { Env } from "../env";
import type { ProfileActivityStoreData } from "./profileActivityStore";
import { organizationStoreStub } from "./rpc/client";

type PortalRole = "administrator" | "member" | "owner";

const linkedMemberRowSchema = z.object({
  createdAt: z.union([z.number(), z.string()]),
  emailVerified: z.number(),
  lastActiveAt: z.number().nullable(),
  role: z.string(),
  twoFactorEnabled: z.number().nullable(),
  userId: z.string(),
});

const accountProviderRowSchema = z.object({
  hasPassword: z.number(),
  providerId: z.string(),
});

const pendingInvitationRowSchema = z.object({
  createdAt: z.union([z.number(), z.string()]),
  expiresAt: z.union([z.number(), z.string()]),
  role: z.string().nullable(),
});

const countRowSchema = z.object({ count: z.number() });
const enrolledRowSchema = z.object({ enrolled: z.number() });

function normalizePortalRole(role: string | null | undefined): PortalRole | null {
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

function normalizeControlTimestamp(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date =
    typeof value === "number"
      ? new Date(value < 1_000_000_000_000 ? value * 1_000 : value)
      : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export interface PortalActivityDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all(): Promise<{ readonly results: readonly unknown[] }>;
      first(): Promise<unknown>;
    };
  };
}

export async function readOrganizationProfilePortalActivity(
  database: PortalActivityDatabase,
  input: {
    readonly contactEmail: string;
    readonly now?: Date;
    readonly organizationId: string;
    readonly profileId: string;
  },
): Promise<{
  readonly linkedUserId: string | null;
  readonly portal: OrganizationProfilePortalActivity;
}> {
  const rawMemberRow = await database
    .prepare(
      `SELECT m.userId, m.role, m.createdAt, m.lastActiveAt,
        u.emailVerified, u.twoFactorEnabled
       FROM member m
       INNER JOIN user u ON u.id = m.userId
       WHERE m.organizationId = ? AND m.profileId = ?
       LIMIT 1`,
    )
    .bind(input.organizationId, input.profileId)
    .first();

  const parsedMember = rawMemberRow ? linkedMemberRowSchema.safeParse(rawMemberRow) : null;
  if (parsedMember?.success) {
    const memberRow = parsedMember.data;
    const [accountsResult, rawPasskeyRow, rawInviteEnrollmentRow] = await Promise.all([
      database
        .prepare(
          `SELECT providerId,
            CASE WHEN password IS NOT NULL AND password != '' THEN 1 ELSE 0 END AS hasPassword
           FROM account
           WHERE userId = ?
           LIMIT 20`,
        )
        .bind(memberRow.userId)
        .all(),
      database
        .prepare("SELECT COUNT(*) AS count FROM passkey WHERE userId = ?")
        .bind(memberRow.userId)
        .first(),
      database
        .prepare(
          `SELECT 1 AS enrolled
           FROM organization_roster_invite_enrollments
           WHERE organization_id = ? AND user_id = ? AND state = 'completed'
           LIMIT 1`,
        )
        .bind(input.organizationId, memberRow.userId)
        .first(),
    ]);

    const accounts = accountsResult.results.flatMap((row) => {
      const parsed = accountProviderRowSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
    const hasPassword = accounts.some(
      (account) => account.providerId === "credential" && account.hasPassword === 1,
    );
    const hasGoogleAccount = accounts.some((account) => account.providerId === "google");
    const parsedPasskey = countRowSchema.safeParse(rawPasskeyRow);
    const passkeyCount = Math.min(
      100,
      Math.max(0, parsedPasskey.success ? parsedPasskey.data.count : 0),
    );
    const parsedEnrolled = enrolledRowSchema.safeParse(rawInviteEnrollmentRow);

    return {
      linkedUserId: memberRow.userId,
      portal: {
        emailVerified: memberRow.emailVerified === 1,
        hasGoogleAccount,
        hasPassword,
        joinedAt: normalizeControlTimestamp(memberRow.createdAt),
        joinedViaInviteLink: parsedEnrolled.success && parsedEnrolled.data.enrolled === 1,
        lastActiveAt: normalizeControlTimestamp(memberRow.lastActiveAt),
        linked: true,
        passkeyCount,
        pendingInvitation: null,
        role: normalizePortalRole(memberRow.role),
        twoFactorEnabled: memberRow.twoFactorEnabled === 1,
      },
    };
  }

  let pendingInvitation: OrganizationProfilePortalActivity["pendingInvitation"] = null;
  const normalizedEmail = input.contactEmail.trim().toLowerCase();
  if (normalizedEmail) {
    const nowMs = (input.now ?? new Date()).getTime();
    const rawInvitationRow = await database
      .prepare(
        `SELECT createdAt, expiresAt, role
         FROM invitation
         WHERE organizationId = ?
           AND lower(email) = ?
           AND status = 'pending'
           AND CASE WHEN typeof(expiresAt) IN ('integer', 'real')
             THEN expiresAt > ?
             ELSE julianday(expiresAt) > julianday(?)
           END
         ORDER BY createdAt DESC, id DESC
         LIMIT 1`,
      )
      .bind(input.organizationId, normalizedEmail, nowMs, new Date(nowMs).toISOString())
      .first();

    const parsedInvitation = rawInvitationRow
      ? pendingInvitationRowSchema.safeParse(rawInvitationRow)
      : null;
    if (parsedInvitation?.success) {
      const createdAt = normalizeControlTimestamp(parsedInvitation.data.createdAt);
      const expiresAt = normalizeControlTimestamp(parsedInvitation.data.expiresAt);
      const role = normalizePortalRole(parsedInvitation.data.role) ?? "member";
      if (createdAt && expiresAt) {
        pendingInvitation = { createdAt, expiresAt, role };
      }
    }
  }

  return {
    linkedUserId: null,
    portal: {
      emailVerified: null,
      hasGoogleAccount: null,
      hasPassword: null,
      joinedAt: null,
      joinedViaInviteLink: false,
      lastActiveAt: null,
      linked: false,
      passkeyCount: null,
      pendingInvitation,
      role: null,
      twoFactorEnabled: null,
    },
  };
}

function resolveTimelineActor(
  entry: ProfileActivityStoreData["timeline"][number],
  linkedUserId: string | null,
): OrganizationProfileActivityActor | null {
  if (entry.automatic || entry.actorType === "system") return "system";
  if (
    entry.actorType === "member" ||
    entry.actorType === "public_rsvp" ||
    (linkedUserId !== null && entry.actorId !== "" && entry.actorId === linkedUserId)
  ) {
    return "member";
  }
  if (entry.actorType === "administrator" || entry.actorType === "organization_member") {
    return "administrator";
  }
  return null;
}

export function composeOrganizationProfileActivity(input: {
  readonly linkedUserId: string | null;
  readonly portal: OrganizationProfilePortalActivity;
  readonly requestId: string;
  readonly storeData: ProfileActivityStoreData;
}): OrganizationProfileActivityResponse {
  const events: OrganizationProfileActivityEvent[] = input.storeData.timeline.map((entry) => ({
    actorType: resolveTimelineActor(entry, input.linkedUserId),
    detail: entry.detail,
    id: entry.id,
    kind: entry.kind,
    occurredAt: entry.occurredAt,
    title: entry.title,
  }));

  if (input.portal.linked && input.portal.joinedAt) {
    events.push({
      actorType: "member",
      detail: input.portal.joinedViaInviteLink
        ? "Joined via roster invite link"
        : "Linked Organization portal account",
      id: "portal_joined",
      kind: "portal_joined",
      occurredAt: input.portal.joinedAt,
      title: "Joined Organization portal",
    });
  }

  events.push({
    actorType: null,
    detail: "",
    id: "profile_created",
    kind: "profile_created",
    occurredAt: input.storeData.profileCreatedAt,
    title: "Profile created",
  });

  events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));

  return organizationProfileActivityResponseSchema.parse({
    attendance: input.storeData.attendance,
    emailHealth: input.storeData.emailHealth,
    lastPollResponseAt: input.storeData.lastPollResponseAt,
    lastRsvpResponseAt: input.storeData.lastRsvpResponseAt,
    portal: input.portal,
    profileCreatedAt: input.storeData.profileCreatedAt,
    profileId: input.storeData.profileId,
    profileUpdatedAt: input.storeData.profileUpdatedAt,
    requestId: input.requestId,
    timeline: events.slice(0, 50),
  });
}

export async function readOrganizationProfileActivity(
  env: Pick<Env, "CONTROL_DB" | "ORGANIZATION_STORE">,
  input: {
    readonly now?: Date;
    readonly organizationId: string;
    readonly profileId: string;
    readonly requestId: string;
  },
): Promise<OrganizationProfileActivityResponse | null> {
  const now = input.now ?? new Date();
  const stub = organizationStoreStub(env, input.organizationId);
  const storeResult = await stub.readProfileActivity({
    nowIso: now.toISOString(),
    organizationId: input.organizationId,
    profileId: input.profileId,
  });
  if (!storeResult.ok) return null;

  const { linkedUserId, portal } = await readOrganizationProfilePortalActivity(env.CONTROL_DB, {
    contactEmail: storeResult.data.primaryContactEmail,
    now,
    organizationId: input.organizationId,
    profileId: input.profileId,
  });

  return composeOrganizationProfileActivity({
    linkedUserId,
    portal,
    requestId: input.requestId,
    storeData: storeResult.data,
  });
}
