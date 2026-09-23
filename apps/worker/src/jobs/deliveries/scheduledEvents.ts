import { renderCommunicationTemplate } from "@choir/domain";
import { listOrganizationProfileEmails } from "../../organization/profiles";
import {
  queueAutomatedOrganizationCommunication,
  readOrganizationCommunicationTemplate,
} from "../../organization/organizationCommunications";
import { mutateOrganizationStore, readOrganizationStore } from "../../organization/rpc/repository";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";
import {
  attendanceReportJobResponseSchema,
  scheduledEventJobResponseSchema,
  scheduledEventTemplateIds,
  scheduledReportMemberSchema,
} from "./shared";
import type { z } from "zod";

function scheduledEventOrigin(env: JobConsumerEnv): string {
  return env.PRODUCT_BASE_DOMAIN === "localhost"
    ? "http://localhost"
    : `https://${env.PRODUCT_BASE_DOMAIN}`;
}

async function readScheduledEventJob(
  env: JobConsumerEnv,
  job: DeliveryJob,
  path: string,
): Promise<z.infer<typeof scheduledEventJobResponseSchema>> {
  const response = await readOrganizationStore(env, job.organizationId, path, {
    jobId: job.jobId,
  });
  const parsed = scheduledEventJobResponseSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || !parsed.success) throw new Error("The scheduled event job is unavailable.");
  return parsed.data;
}

async function automatedRecipients(
  env: JobConsumerEnv,
  organizationId: string,
  candidates: readonly { readonly profileId: string; readonly recipientName: string }[],
): Promise<
  readonly {
    readonly email: string;
    readonly name: string;
    readonly phone: string;
    readonly profileId: string;
  }[]
> {
  if (!env.CONTROL_DB)
    throw new Error("The control database is unavailable for scheduled communication.");
  const emails = await listOrganizationProfileEmails(env.CONTROL_DB, organizationId);
  return candidates.flatMap((candidate) => {
    const email = emails.get(candidate.profileId)?.trim() ?? "";
    return email
      ? [{ email, name: candidate.recipientName, phone: "", profileId: candidate.profileId }]
      : [];
  });
}

export async function deliverScheduledEventCommunication(
  env: JobConsumerEnv,
  job: DeliveryJob,
  kind: "event_reminder" | "rsvp_follow_up",
): Promise<void> {
  const scheduled = await readScheduledEventJob(
    env,
    job,
    kind === "event_reminder"
      ? "/internal/scheduling/event-reminder-job"
      : "/internal/scheduling/rsvp-follow-up-job",
  );
  if (scheduled.recipients.length === 0) return;
  const templateId =
    kind === "rsvp_follow_up"
      ? scheduledEventTemplateIds.eventRsvpFollowUp
      : scheduled.event.type === "Rehearsal"
        ? scheduledEventTemplateIds.rehearsalReminder
        : scheduledEventTemplateIds.performanceReminder;
  const template = await readOrganizationCommunicationTemplate(env, job.organizationId, templateId);
  const recipients = await automatedRecipients(env, job.organizationId, scheduled.recipients);
  if (recipients.length === 0) return;
  await queueAutomatedOrganizationCommunication(
    env,
    {
      actorUserId: "system:scheduler",
      organizationId: job.organizationId,
      organizationOrigin: scheduledEventOrigin(env),
      requestId: job.jobId,
    },
    {
      contentMarkdown: template.contentMarkdown,
      eventId: scheduled.eventId,
      recipients,
      subject: template.subject,
    },
  );
}

async function reportMembers(
  env: JobConsumerEnv,
  organizationId: string,
): Promise<readonly z.infer<typeof scheduledReportMemberSchema>[]> {
  if (!env.CONTROL_DB)
    throw new Error("The control database is unavailable for attendance reports.");
  const result = await env.CONTROL_DB.prepare(
    `SELECT u.email, m.profileId, m.role
       FROM member m JOIN user u ON u.id = m.userId
       WHERE m.organizationId = ? AND m.role IN ('owner', 'admin')`,
  )
    .bind(organizationId)
    .all<z.infer<typeof scheduledReportMemberSchema>>();
  return result.results.flatMap((row) => {
    const parsed = scheduledReportMemberSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

function attendanceReportValues(
  report: z.infer<typeof attendanceReportJobResponseSchema>,
): Readonly<Record<string, string>> {
  const presentCount = report.roster.filter(({ attendance }) => attendance === "Present").length;
  const totalCount = report.roster.length;
  const attendanceRate = totalCount === 0 ? 0 : Math.round((presentCount / totalCount) * 100);
  const absenteesList =
    report.roster
      .filter(({ attendance }) => attendance !== "Present")
      .map(({ displayName, voicePart }) => `- ${displayName}${voicePart ? ` (${voicePart})` : ""}`)
      .join("\n") || "- None recorded";
  const names = new Map(report.reportProfiles.map((profile) => [profile.id, profile.displayName]));
  const performers = new Set(report.performerProfileIds);
  const presentByRehearsal = new Map<string, Set<string>>();
  for (const row of report.linkedRehearsalRows) {
    if (!presentByRehearsal.has(row.eventId)) {
      presentByRehearsal.set(row.eventId, new Set<string>());
    }
    if (row.profileId && row.attendance === "Present") {
      const present = presentByRehearsal.get(row.eventId) ?? new Set<string>();
      present.add(row.profileId);
      presentByRehearsal.set(row.eventId, present);
    }
  }
  const missedCounts = new Map<string, number>();
  for (const present of presentByRehearsal.values()) {
    for (const profileId of performers) {
      if (!present.has(profileId))
        missedCounts.set(profileId, (missedCounts.get(profileId) ?? 0) + 1);
    }
  }
  const warningNames = [...missedCounts.entries()]
    .filter(([, missed]) => missed >= report.warningThreshold)
    .sort(([left], [right]) => (names.get(left) ?? "").localeCompare(names.get(right) ?? ""))
    .map(
      ([profileId, missed]) =>
        `- ${names.get(profileId) ?? "Unknown Profile"} (${String(missed)} missed Rehearsal${missed === 1 ? "" : "s"})`,
    )
    .join("\n");
  const thresholdWarningsSection = warningNames
    ? `### Rehearsal follow-up warnings\nProfiles at or above the warning threshold of ${String(report.warningThreshold)}:\n${warningNames}`
    : "### Rehearsal follow-up warnings\nNo profiles met the warning threshold.";
  return {
    absenteesList,
    attendanceRate: String(attendanceRate),
    presentCount: String(presentCount),
    thresholdWarningsSection,
    totalCount: String(totalCount),
  };
}

export async function deliverAttendanceReportJob(
  env: JobConsumerEnv,
  job: DeliveryJob,
): Promise<void> {
  const response = await mutateOrganizationStore(
    env,
    job.organizationId,
    "/internal/scheduling/attendance-report-prepare",
    { jobId: job.jobId, organizationId: job.organizationId },
  );
  const parsed = attendanceReportJobResponseSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!response.ok || !parsed.success) throw new Error("The attendance report job is unavailable.");
  const members = await reportMembers(env, job.organizationId);
  const profiles = new Map(parsed.data.reportProfiles.map((profile) => [profile.id, profile]));
  const eligible = members.filter((member) => {
    if (!member.profileId) return false;
    const profile = profiles.get(member.profileId);
    return (
      profile?.globalStatus === "Active" &&
      profile.receiveAttendanceReports === 1 &&
      profile.doNotEmail === 0 &&
      profile.emailSuppressed === 0
    );
  });
  const fallback = members.filter((member) => {
    if (member.role !== "owner" || !member.profileId) return false;
    const profile = profiles.get(member.profileId);
    return profile?.doNotEmail === 0 && profile.emailSuppressed === 0;
  });
  const recipients = await automatedRecipients(
    env,
    job.organizationId,
    [...(eligible.length > 0 ? eligible : fallback)].flatMap((member) =>
      member.profileId
        ? [
            {
              profileId: member.profileId,
              recipientName:
                profiles.get(member.profileId)?.displayName ?? "Organization Administrator",
            },
          ]
        : [],
    ),
  );
  if (recipients.length === 0) {
    throw new Error(
      "No reachable attendance-report recipient is configured; owner attention is required.",
    );
  }
  const template = await readOrganizationCommunicationTemplate(
    env,
    job.organizationId,
    scheduledEventTemplateIds.attendanceReport,
  );
  const values = attendanceReportValues(parsed.data);
  await queueAutomatedOrganizationCommunication(
    env,
    {
      actorUserId: "system:scheduler",
      organizationId: job.organizationId,
      organizationOrigin: scheduledEventOrigin(env),
      requestId: job.jobId,
    },
    {
      contentMarkdown: renderCommunicationTemplate(template.contentMarkdown, "{recipientName}", {
        ...values,
        eventTitle: parsed.data.event.title,
        eventType: parsed.data.event.type,
        eventDate: new Intl.DateTimeFormat("en-US", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: parsed.data.event.timezone,
        }).format(new Date(parsed.data.event.startsAt)),
        eventLocation: parsed.data.event.location || parsed.data.event.venueName,
      }),
      eventId: parsed.data.eventId,
      recipients,
      subject: renderCommunicationTemplate(template.subject, "{recipientName}", {
        eventTitle: parsed.data.event.title,
        eventDate: new Intl.DateTimeFormat("en-US", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: parsed.data.event.timezone,
        }).format(new Date(parsed.data.event.startsAt)),
      }),
    },
  );
}
