import { z } from "zod";

import {
  readOrganizationCalendarSettings,
  readOrganizationProfileEventRsvp,
} from "../calendar/organizationCalendar";
import type { Env } from "../env";
import { queueAutomatedOrganizationCommunication } from "./organizationCommunications";
import { listOrganizationProfiles } from "./profiles";

const administratorMembershipRowSchema = z.object({
  email: z.email().max(320),
  profileId: z.uuid(),
  role: z.enum(["admin", "owner"]),
});

const markdownCharacters = [
  "\\",
  "`",
  "*",
  "_",
  "[",
  "]",
  "{",
  "}",
  "(",
  ")",
  "#",
  "+",
  ".",
  "!",
  "|",
  ">",
  "~",
  "-",
] as const;

interface RsvpDeclineNoticeInput {
  readonly actorUserId: string;
  readonly eventId: string;
  readonly organizationId: string;
  readonly organizationOrigin: string;
  readonly profileId: string;
  readonly requestId: string;
  readonly updatedAt: string;
}

type RsvpDeclineNotificationEnv = Pick<
  Env,
  "CONTROL_DB" | "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET"
>;

function escapeMarkdown(value: string): string {
  let escaped = value;
  for (const character of markdownCharacters) {
    escaped = escaped.replaceAll(character, `\\${character}`);
  }
  return escaped;
}

function formatEventDate(value: string, timezone: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone,
  }).format(date);
}

function noteMarkdown(value: string): string {
  if (!value) return "_No note provided._";
  return value
    .split(/\r?\n/)
    .map((line) => `> ${escapeMarkdown(line)}`)
    .join("\n");
}

async function administratorRecipients(
  env: Pick<Env, "CONTROL_DB">,
  organizationId: string,
  profiles: Awaited<ReturnType<typeof listOrganizationProfiles>>,
): Promise<
  readonly {
    readonly email: string;
    readonly name: string;
    readonly phone: string;
    readonly profileId: string;
  }[]
> {
  const result = await env.CONTROL_DB.prepare(
    `SELECT m.profileId AS profileId, m.role AS role, u.email AS email
       FROM member m
       JOIN user u ON u.id = m.userId
       WHERE m.organizationId = ?
         AND m.profileId IS NOT NULL
         AND m.role IN ('owner', 'admin')`,
  )
    .bind(organizationId)
    .all();
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const recipients = new Map<
    string,
    {
      readonly email: string;
      readonly name: string;
      readonly phone: string;
      readonly profileId: string;
    }
  >();
  for (const row of result.results) {
    const membership = administratorMembershipRowSchema.safeParse(row);
    if (!membership.success) continue;
    const profile = profilesById.get(membership.data.profileId);
    if (!profile) continue;
    if (
      profile.globalStatus !== "Active" ||
      profile.doNotEmail ||
      profile.providerEmailSuppressed ||
      !profile.receiveRsvpDeclineNotices
    ) {
      continue;
    }
    const email = membership.data.email.toLowerCase();
    if (recipients.has(profile.id)) continue;
    recipients.set(profile.id, {
      email,
      name: profile.displayName,
      phone: profile.phone,
      profileId: profile.id,
    });
  }
  return [...recipients.values()];
}

export async function queueRsvpDeclineNotice(
  env: RsvpDeclineNotificationEnv,
  input: RsvpDeclineNoticeInput,
): Promise<void> {
  const [event, profiles, calendarSettings] = await Promise.all([
    readOrganizationProfileEventRsvp(env, input.organizationId, input.eventId, input.profileId),
    listOrganizationProfiles(env, input.organizationId),
    readOrganizationCalendarSettings(env, input.organizationId),
  ]);
  if (event?.rsvp !== "No") return;
  const declinedProfile = profiles.find(({ id }) => id === event.profileId);
  if (!declinedProfile) return;
  const recipients = await administratorRecipients(env, input.organizationId, profiles);
  if (recipients.length === 0) return;

  const eventType = event.type.toLowerCase();
  const subject = `${event.displayName} declined ${eventType}: ${event.title}`.slice(0, 300);
  const contentMarkdown = [
    `## RSVP declined`,
    "",
    `**${escapeMarkdown(event.displayName)}** (${escapeMarkdown(declinedProfile.voicePart || "Voice part not assigned")}) declined a ${eventType} RSVP.`,
    "",
    `- **Event:** ${escapeMarkdown(event.title)}`,
    `- **Date:** ${escapeMarkdown(formatEventDate(event.startsAt, calendarSettings.timezone))}`,
    "",
    "**Note**",
    noteMarkdown(event.rsvpNote),
  ].join("\n");

  await queueAutomatedOrganizationCommunication(
    env,
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      organizationOrigin: input.organizationOrigin,
      requestId: input.requestId,
    },
    {
      contentMarkdown,
      dedupeKey: `rsvp-decline:${input.organizationId}:${input.eventId}:${input.profileId}:${input.updatedAt}`,
      eventId: input.eventId,
      recipients,
      subject,
    },
  );
}
