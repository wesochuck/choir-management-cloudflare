import { z } from "zod";

import type { Env } from "../env";
import { issueSignedLink, verifySignedLinkScope } from "../security/signedLinks";

const CALENDAR_FEED_LIFETIME_SECONDS = 10 * 365 * 24 * 60 * 60;

const calendarCredentialResponseSchema = z.object({
  calendarFeedVersion: z.number().int().positive(),
  displayName: z.string().min(1).max(200),
  profileId: z.uuid(),
});

const calendarFeedResponseSchema = z.object({
  calendarFeedVersion: z.number().int().positive(),
  organizationName: z.string().min(1).max(120),
  profileId: z.uuid(),
  profileName: z.string().min(1).max(200),
});

interface MembershipProfileRow {
  readonly profileId: string | null;
}

export interface CalendarFeedUrls {
  readonly expiresAt: string;
  readonly httpsUrl: string;
  readonly webcalUrl: string;
}

export interface CalendarFeedDocument {
  readonly body: string;
  readonly filename: string;
}

function escapeIcsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function safeFilename(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "choir-schedule"
  );
}

async function linkedProfileId(
  database: D1Database,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const membership = await database
    .prepare(
      `SELECT profileId FROM member
       WHERE organizationId = ? AND userId = ? LIMIT 1`,
    )
    .bind(organizationId, userId)
    .first<MembershipProfileRow>();
  return membership?.profileId ?? null;
}

export async function createCalendarFeedUrls(
  env: Env,
  input: {
    readonly action: "read" | "reset";
    readonly actorUserId: string;
    readonly canonicalOrigin: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
  now = new Date(),
): Promise<CalendarFeedUrls | null> {
  const profileId = await linkedProfileId(env.CONTROL_DB, input.organizationId, input.actorUserId);
  if (!profileId) {
    return null;
  }
  const objectId = env.ORGANIZATION_STORE.idFromName(input.organizationId);
  const response = await env.ORGANIZATION_STORE.get(objectId).fetch(
    "https://organization.internal/internal/calendar/credential",
    {
      body: JSON.stringify({
        action: input.action,
        ...(input.action === "reset"
          ? { actorUserId: input.actorUserId, requestId: input.requestId }
          : {}),
        organizationId: input.organizationId,
        profileId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  const credential = calendarCredentialResponseSchema.safeParse(await response.json());
  if (response.status === 404) {
    return null;
  }
  if (!response.ok || !credential.success || credential.data.profileId !== profileId) {
    throw new Error("The Organization store rejected the calendar credential request.");
  }

  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = issuedAt + CALENDAR_FEED_LIFETIME_SECONDS;
  const token = await issueSignedLink(env.SIGNED_LINK_SECRET, {
    algorithm: "HS256",
    expiresAt,
    issuedAt,
    organizationId: input.organizationId,
    purpose: "calendar_feed",
    revocation: String(credential.data.calendarFeedVersion),
    subjectId: profileId,
    version: 1,
  });
  const feedUrl = new URL("/api/calendar/feed", input.canonicalOrigin);
  feedUrl.searchParams.set("token", token);
  return {
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    httpsUrl: feedUrl.toString(),
    webcalUrl: feedUrl.toString().replace(/^https?:/, "webcal:"),
  };
}

export async function readCalendarFeed(
  env: Env,
  organizationId: string,
  token: string,
  now = new Date(),
): Promise<CalendarFeedDocument | null> {
  const envelope = await verifySignedLinkScope(env.SIGNED_LINK_SECRET, token, {
    expectedOrganizationId: organizationId,
    expectedPurpose: "calendar_feed",
    now,
  });
  const profileId = z.uuid().safeParse(envelope?.subjectId);
  const revocationVersion = z.coerce.number().int().positive().safeParse(envelope?.revocation);
  if (!envelope || !profileId.success || !revocationVersion.success || envelope.resourceId) {
    return null;
  }

  const objectId = env.ORGANIZATION_STORE.idFromName(organizationId);
  const response = await env.ORGANIZATION_STORE.get(objectId).fetch(
    "https://organization.internal/internal/calendar/feed",
    {
      body: JSON.stringify({
        organizationId,
        profileId: profileId.data,
        revocationVersion: revocationVersion.data,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  const feed = calendarFeedResponseSchema.safeParse(await response.json());
  if (response.status === 404) {
    return null;
  }
  if (!response.ok || !feed.success || feed.data.profileId !== profileId.data) {
    throw new Error("The Organization store rejected the calendar feed request.");
  }

  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Choir Management Tool//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeIcsText(feed.data.organizationName)}`,
    `X-WR-CALDESC:${escapeIcsText(`Personal schedule for ${feed.data.profileName}`)}`,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  return {
    body,
    filename: `${safeFilename(feed.data.organizationName)}-${profileId.data}.ics`,
  };
}
