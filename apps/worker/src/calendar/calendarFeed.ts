import { z } from "zod";

import type { Env } from "../env";
import { issueSignedLink, verifySignedLinkScope } from "../security/signedLinks";
import { linkedOrganizationProfileId } from "../tenancy/linkedOrganizationProfile";
import { renderCalendarIcs } from "./calendarIcs";
import { mutateOrganizationStore } from "../organization/rpc/repository";

const CALENDAR_FEED_LIFETIME_SECONDS = 10 * 365 * 24 * 60 * 60;

const calendarCredentialResponseSchema = z.object({
  calendarFeedVersion: z.number().int().positive(),
  displayName: z.string().min(1).max(200),
  profileId: z.uuid(),
});

const calendarFeedResponseSchema = z.object({
  calendarFeedVersion: z.number().int().positive(),
  events: z.array(
    z.object({
      callTime: z.string().max(5_000),
      details: z.string().max(100_000),
      durationMinutes: z.number().int().positive().nullable(),
      id: z.string().min(1).max(128),
      location: z.string().max(2_000),
      resolvedRsvp: z.enum(["Pending", "Yes"]),
      setListApproved: z.boolean(),
      setListJson: z.string().max(500_000),
      startsAt: z.iso.datetime(),
      title: z.string().min(1).max(500),
      type: z.enum(["Performance", "Rehearsal"]),
      venueAddress: z.string().max(2_000),
      venueName: z.string().max(500),
    }),
  ),
  organizationName: z.string().min(1).max(120),
  profileId: z.uuid(),
  profileName: z.string().min(1).max(200),
  timezone: z.string().min(1).max(100),
});

export interface CalendarFeedUrls {
  readonly expiresAt: string;
  readonly httpsUrl: string;
  readonly webcalUrl: string;
}

export interface CalendarFeedDocument {
  readonly body: string;
  readonly filename: string;
}

function safeFilename(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "choir-schedule"
  );
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
  const profileId = await linkedOrganizationProfileId(
    env.CONTROL_DB,
    input.organizationId,
    input.actorUserId,
  );
  if (!profileId) {
    return null;
  }
  const response = await mutateOrganizationStore(
    env,
    input.organizationId,
    "/internal/calendar/credential",
    {
      action: input.action,
      ...(input.action === "reset"
        ? { actorUserId: input.actorUserId, requestId: input.requestId }
        : {}),
      organizationId: input.organizationId,
      profileId,
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

  const response = await mutateOrganizationStore(env, organizationId, "/internal/calendar/feed", {
    organizationId,
    profileId: profileId.data,
    readAt: now.toISOString(),
    revocationVersion: revocationVersion.data,
  });
  const feed = calendarFeedResponseSchema.safeParse(await response.json());
  if (response.status === 404) {
    return null;
  }
  if (!response.ok || !feed.success || feed.data.profileId !== profileId.data) {
    throw new Error("The Organization store rejected the calendar feed request.");
  }

  let body: string;
  try {
    body = renderCalendarIcs({
      events: feed.data.events,
      generatedAt: now,
      organizationName: feed.data.organizationName,
      profileName: feed.data.profileName,
      timezone: feed.data.timezone,
    });
  } catch {
    throw new Error("The Organization calendar projection is invalid.");
  }
  return {
    body,
    filename: `${safeFilename(feed.data.organizationName)}-${profileId.data}.ics`,
  };
}
