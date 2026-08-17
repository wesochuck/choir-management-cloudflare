import { z } from "zod";
import type { Env } from "../../env";
import { issuePlayerToken } from "../../organization/organizationPlayerLinks";
import { issueRsvpToken } from "../../organization/organizationRsvpLinks";
import { invokeOrganizationRpc, organizationStoreStub } from "../../organization/rpc/client";
import { issueSignedLink } from "../../security/signedLinks";
import type { DeliveryJob } from "../contracts";
export type JobConsumerEnv = Pick<
  Env,
  | "BREVO_API_KEY"
  | "BREVO_SMS_ALLOWED_RECIPIENTS"
  | "BREVO_SMS_SENDER"
  | "EXTERNAL_EFFECTS_MODE"
  | "ORGANIZATION_FILES"
  | "ORGANIZATION_STORE"
  | "PRODUCT_BASE_DOMAIN"
  | "SIGNED_LINK_SECRET"
> &
  Partial<
    Pick<
      Env,
      | "CONTROL_DB"
      | "PLATFORM_EMAIL"
      | "PLATFORM_EMAIL_ALLOWED_RECIPIENTS"
      | "PLATFORM_EMAIL_FROM"
      | "PLATFORM_EMAIL_MODE"
    >
  >;
export type DeadLetterConsumerEnv = Pick<Env, "CONTROL_DB"> &
  Partial<Pick<Env, "ORGANIZATION_STORE">>;

export const claimResponseSchema = z.object({
  claimed: z.boolean(),
  status: z.string(),
});
export const completionResponseSchema = z.object({ completed: z.boolean() });
export const deliveryAttemptSchema = z.number().int().min(1).max(10);
export const failureResponseSchema = z.object({ failed: z.boolean() });
export const terminalResponseSchema = z.object({ terminal: z.boolean() });
export const eventReminderResultResponseSchema = z.object({ recorded: z.boolean() });
const providerNotificationFields = {
  providerEventAt: z.string().max(100).nullable(),
  providerMessageId: z.string().max(512).nullable(),
  providerReason: z.string().max(500),
  providerStatus: z
    .enum(["accepted", "delivered", "deferred", "bounced", "failed", "rejected", "complained"])
    .nullable(),
};
export const ticketNotificationJobSchema = z.object({
  buyerName: z.string().min(1).max(200),
  contentMarkdown: z.string().max(100_000),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  destination: z.email(),
  discountAmountCents: z.number().int().nonnegative().default(0),
  discountCode: z.string().max(64).nullable().default(null),
  discountedSubtotalCents: z.number().int().nonnegative().default(0),
  eventStartsAt: z.iso.datetime(),
  eventTitle: z.string().min(1).max(500),
  feeCents: z.number().int().nonnegative().default(0),
  id: z.uuid(),
  amountPaidCents: z.number().int().nonnegative(),
  bundleTitle: z.string().nullable(),
  kind: z.enum(["confirmation", "reminder"]),
  purchaseId: z.uuid(),
  quantity: z.number().int().positive(),
  originalSubtotalCents: z.number().int().nonnegative().default(0),
  status: z.enum(["queued", "processing"]),
  subject: z.string().max(300),
  timezone: z.string().min(1).max(100),
  ...providerNotificationFields,
});
export const paymentNotificationJobSchema = z.object({
  contentMarkdown: z.string().max(100_000),
  destination: z.email(),
  id: z.uuid(),
  paymentType: z.enum(["donation", "dues"]),
  recipientName: z.string().min(1).max(200),
  resourceId: z.uuid(),
  status: z.enum(["queued", "processing"]),
  subject: z.string().max(300),
  ...providerNotificationFields,
});
export const auditionNotificationJobSchema = z.object({
  auditionId: z.string().min(1).max(200),
  contentMarkdown: z.string().max(100_000),
  destination: z.email(),
  id: z.uuid(),
  kind: z.enum([
    "inquiry_confirmation",
    "scheduled_confirmation",
    "audition_reminder",
    "admin_alert",
  ]),
  recipientName: z.string().min(1).max(200),
  status: z.enum(["queued", "processing"]),
  subject: z.string().max(300),
  ...providerNotificationFields,
});
export const organizationExportJobSchema = z.object({
  actorType: z.enum(["organization_member", "platform_administrator"]),
  actorUserId: z.string().min(1).max(128),
  archiveKey: z.string().nullable(),
  byteCount: z.number().int().nonnegative().nullable(),
  checksumSha256: z.string().nullable(),
  errorCode: z.string().nullable(),
  exportId: z.uuid(),
  format: z.literal("json"),
  requestId: z.uuid(),
  status: z.enum(["queued", "processing", "completed", "failed"]),
});
export const organizationExportSnapshotSchema = z.object({
  files: z.array(
    z.object({
      checksums: z.record(z.string(), z.string()),
      contentType: z.string(),
      fileName: z.string(),
      id: z.string(),
      sizeBytes: z.number().int().nonnegative(),
      storageKey: z.string(),
      uploadedAt: z.string().nullable(),
    }),
  ),
  metadata: z.record(z.string(), z.unknown()),
  records: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  safety: z.object({
    fileCount: z.number().int().nonnegative(),
    maxRowsPerTable: z.number().int().positive(),
    tableCounts: z.record(z.string(), z.number().int().nonnegative()),
    tooLarge: z.boolean(),
  }),
});
export const deadLetterInsertSql = `INSERT INTO job_dead_letters
  (id, queue_name, message_id, message_valid, observed_attempt,
   organization_id, job_id, job_kind, idempotency_key,
   first_seen_at, last_seen_at, observation_count)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
 ON CONFLICT(id) DO UPDATE SET
   last_seen_at = excluded.last_seen_at,
   observed_attempt = excluded.observed_attempt,
   observation_count = job_dead_letters.observation_count + 1`;

export function retryDelaySeconds(attempt: number): number {
  const exponentialDelay = Math.min(300, 2 ** attempt);
  const deterministicJitter = (attempt * 17) % 11;
  return exponentialDelay + deterministicJitter;
}

export async function recordJobFailure(env: JobConsumerEnv, job: DeliveryJob): Promise<void> {
  try {
    const failureResponse = await invokeOrganizationRpc(
      organizationStoreStub(env, job.organizationId),
      "https://organization.internal/internal/jobs/fail",
      {
        body: JSON.stringify({
          attempt: job.attempt,
          failedAt: new Date().toISOString(),
          idempotencyKey: job.idempotencyKey,
          jobId: job.jobId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    const failure = failureResponseSchema.safeParse(await failureResponse.json());
    if (!failureResponse.ok || !failure.success || !failure.data.failed) {
      console.error(
        JSON.stringify({
          event: "queue_job_failure_record_rejected",
          jobId: job.jobId,
          kind: job.kind,
          organizationId: job.organizationId,
        }),
      );
    }
    if (job.kind === "event_reminder" && env.CONTROL_DB) {
      try {
        await recordEventReminderResult(env, job, "failed");
      } catch (error: unknown) {
        console.error(
          JSON.stringify({
            errorType: error instanceof Error ? error.name : "UnknownError",
            event: "event_reminder_failure_result_failed",
            jobId: job.jobId,
            organizationId: job.organizationId,
          }),
        );
      }
    }
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        errorType: error instanceof Error ? error.name : "UnknownError",
        event: "queue_job_failure_record_failed",
        jobId: job.jobId,
        kind: job.kind,
        organizationId: job.organizationId,
      }),
    );
  }
}

export async function recordEventReminderResult(
  env: Pick<JobConsumerEnv, "ORGANIZATION_STORE">,
  job: DeliveryJob,
  status: "failed" | "sent" | "terminal",
): Promise<void> {
  const response = await invokeOrganizationRpc(
    organizationStoreStub(env, job.organizationId),
    "https://organization.internal/internal/scheduling/event-reminder-result",
    {
      body: JSON.stringify({
        attempt: job.attempt,
        idempotencyKey: job.idempotencyKey,
        jobId: job.jobId,
        organizationId: job.organizationId,
        status,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  const result = eventReminderResultResponseSchema.safeParse(await response.json());
  if (!response.ok || !result.success || !result.data.recorded) {
    throw new Error("The event reminder result was rejected.");
  }
}

const pollPlaceholderPattern = /\{\{POLL_LINK:([0-9a-f-]{36})\}\}/gi;
const rsvpPlaceholderPattern = /\{\{RSVP_LINKS\}\}|\{rsvpLinks\}/i;
const rsvpPlaceholderReplacementPattern = /\{\{RSVP_LINKS\}\}|\{rsvpLinks\}/gi;
const playerPlaceholderPattern = /\{\{PLAYER_LINK\}\}|\{playerLink\}/i;
const playerPlaceholderReplacementPattern = /\{\{PLAYER_LINK\}\}|\{playerLink\}/gi;
const ticketLinkPlaceholderPattern = /\{\{TICKET_LINK\}\}|\{ticketLink\}/i;
const ticketLinkPlaceholderReplacementPattern = /\{\{TICKET_LINK\}\}|\{ticketLink\}/gi;
const auditionLinkPlaceholderPattern = /\{\{AUDITION_LINK\}\}|\{auditionLink\}/i;
const auditionLinkPlaceholderReplacementPattern = /\{\{AUDITION_LINK\}\}|\{auditionLink\}/gi;

export const scheduledEventTemplateIds = {
  attendanceReport: "5f0ca4a5-7e4c-4e1a-9a1c-000000000016",
  eventRsvpFollowUp: "5f0ca4a5-7e4c-4e1a-9a1c-000000000015",
  performanceReminder: "5f0ca4a5-7e4c-4e1a-9a1c-000000000006",
  rehearsalReminder: "5f0ca4a5-7e4c-4e1a-9a1c-000000000005",
} as const;

export async function renderAuditionLink(
  env: Pick<JobConsumerEnv, "PRODUCT_BASE_DOMAIN" | "SIGNED_LINK_SECRET"> &
    Partial<Pick<JobConsumerEnv, "CONTROL_DB">>,
  organizationId: string,
  content: string,
  auditionId: string,
  kind: z.infer<typeof auditionNotificationJobSchema>["kind"],
): Promise<string> {
  const hasPlaceholder = auditionLinkPlaceholderPattern.test(content);
  // Scheduling always sends a link, including for Organizations whose older copy of the system
  // template predates the placeholder. This keeps customized templates useful without allowing
  // the scheduling workflow to silently omit the applicant's update link.
  if (!hasPlaceholder && kind !== "scheduled_confirmation" && kind !== "audition_reminder") {
    return content;
  }
  const issuedAt = Math.floor(Date.now() / 1_000);
  const token = await issueSignedLink(env.SIGNED_LINK_SECRET, {
    algorithm: "HS256",
    expiresAt: issuedAt + 90 * 24 * 60 * 60,
    issuedAt,
    nonce: crypto.randomUUID(),
    organizationId,
    purpose: "audition",
    resourceId: auditionId,
    subjectId: auditionId,
    version: 1,
  });
  const link = `${await deliveryOrigin(env, organizationId, { unsubscribeUrl: null })}/auditions?token=${encodeURIComponent(token)}`;
  const replacement = `[Review or update your audition](${link})\n\n(No login required.)`;
  if (hasPlaceholder) {
    return content.replace(auditionLinkPlaceholderReplacementPattern, () => replacement);
  }
  return `${content.trimEnd()}\n\n${replacement}`;
}

export const scheduledEventJobResponseSchema = z.object({
  event: z.object({
    callTime: z.string(),
    details: z.string(),
    durationMinutes: z.number().int().nullable(),
    id: z.uuid(),
    location: z.string(),
    parentPerformanceId: z.uuid().nullable(),
    startsAt: z.iso.datetime(),
    title: z.string(),
    type: z.string(),
    timezone: z.string().min(1).max(100),
    venueAddress: z.string(),
    venueName: z.string(),
  }),
  eventId: z.uuid(),
  recipients: z.array(
    z.object({
      phone: z.string(),
      profileId: z.uuid(),
      recipientName: z.string(),
    }),
  ),
});

export const attendanceReportJobResponseSchema = scheduledEventJobResponseSchema.extend({
  linkedRehearsalRows: z.array(
    z.object({
      attendance: z.string().nullable(),
      displayName: z.string().nullable(),
      eventId: z.uuid(),
      eventStartsAt: z.iso.datetime(),
      eventTitle: z.string(),
      profileId: z.uuid().nullable(),
      rsvp: z.string().nullable(),
    }),
  ),
  performerProfileIds: z.array(z.uuid()),
  reportProfiles: z.array(
    z.object({
      displayName: z.string(),
      doNotEmail: z.number().int(),
      emailSuppressed: z.number().int(),
      globalStatus: z.string(),
      id: z.uuid(),
      receiveAttendanceReports: z.number().int(),
    }),
  ),
  roster: z.array(
    z.object({
      attendance: z.string(),
      displayName: z.string(),
      profileId: z.uuid(),
      rsvp: z.string(),
      voicePart: z.string(),
    }),
  ),
  warningThreshold: z.number().int().min(1).max(10),
});

export const scheduledReportMemberSchema = z.object({
  email: z.string().max(320),
  profileId: z.uuid().nullable(),
  role: z.enum(["admin", "owner"]),
});

export async function deliveryOrigin(
  env: Pick<JobConsumerEnv, "PRODUCT_BASE_DOMAIN"> & Partial<Pick<JobConsumerEnv, "CONTROL_DB">>,
  organizationId: string,
  delivery: { readonly unsubscribeUrl: string | null },
): Promise<string> {
  if (env.CONTROL_DB) {
    const row = await env.CONTROL_DB.prepare(
      `SELECT hostname
       FROM organization_domains
       WHERE organization_id = ? AND kind = 'canonical' AND status = 'active'
       ORDER BY created_at, id
       LIMIT 1`,
    )
      .bind(organizationId)
      .first<{ readonly hostname: string }>();
    if (row?.hostname) return `https://${row.hostname}`;
  }
  if (delivery.unsubscribeUrl) return new URL(delivery.unsubscribeUrl).origin;
  return env.PRODUCT_BASE_DOMAIN === "localhost"
    ? "http://localhost"
    : `https://${env.PRODUCT_BASE_DOMAIN}`;
}

export async function renderRsvpLinks(
  env: Pick<JobConsumerEnv, "PRODUCT_BASE_DOMAIN" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  content: string,
  eventId: string | null,
  delivery: {
    readonly profileId: string;
    readonly unsubscribeUrl: string | null;
  },
): Promise<string> {
  if (!rsvpPlaceholderPattern.test(content)) return content;
  if (!eventId) {
    return content.replace(
      rsvpPlaceholderReplacementPattern,
      () => "RSVP link unavailable; select an event before sending this message.",
    );
  }
  const token = await issueRsvpToken(env, organizationId, eventId, delivery.profileId);
  const rsvpLink = `${await deliveryOrigin(env, organizationId, delivery)}/rsvp?token=${encodeURIComponent(token)}`;
  const replacement = `[Open RSVP page](${rsvpLink})\n\n(No login required.)`;
  return content.replace(rsvpPlaceholderReplacementPattern, () => replacement);
}

export async function renderPlayerLinks(
  env: Pick<JobConsumerEnv, "PRODUCT_BASE_DOMAIN" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  content: string,
  eventId: string | null,
  delivery: {
    readonly profileId: string;
    readonly unsubscribeUrl: string | null;
  },
): Promise<string> {
  if (!playerPlaceholderPattern.test(content)) return content;
  if (!eventId) {
    return content.replace(
      playerPlaceholderReplacementPattern,
      () => "Practice player unavailable; select an event before sending this message.",
    );
  }
  const token = await issuePlayerToken(env, organizationId, eventId, delivery.profileId);
  const playerLink = `${await deliveryOrigin(env, organizationId, delivery)}/player?token=${encodeURIComponent(token)}`;
  const replacement = `[Open practice player](${playerLink})\n\n(No login required.)`;
  return content.replace(playerPlaceholderReplacementPattern, () => replacement);
}

export async function renderTicketLinks(
  env: Pick<JobConsumerEnv, "PRODUCT_BASE_DOMAIN" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  content: string,
  purchaseId: string,
  eventStartsAt: string,
): Promise<string> {
  if (!ticketLinkPlaceholderPattern.test(content)) return content;
  const issuedAt = Math.floor(Date.now() / 1_000);
  const eventEndsAt = Math.floor(new Date(eventStartsAt).getTime() / 1_000) + 86_400;
  const token = await issueSignedLink(env.SIGNED_LINK_SECRET, {
    algorithm: "HS256",
    expiresAt: Math.max(issuedAt + 7 * 24 * 60 * 60, eventEndsAt),
    issuedAt,
    nonce: crypto.randomUUID(),
    organizationId,
    purpose: "ticket_receipt",
    resourceId: purchaseId,
    version: 1,
  });
  const link = `${await deliveryOrigin(env, organizationId, { unsubscribeUrl: null })}/tickets/order/success?token=${encodeURIComponent(token)}`;
  return content.replace(
    ticketLinkPlaceholderReplacementPattern,
    () => `[View ticket order](${link})`,
  );
}

export async function renderPollLinks(
  env: Pick<JobConsumerEnv, "PRODUCT_BASE_DOMAIN" | "SIGNED_LINK_SECRET"> &
    Partial<Pick<JobConsumerEnv, "CONTROL_DB">>,
  organizationId: string,
  content: string,
  delivery: {
    readonly profileId: string;
    readonly unsubscribeUrl: string | null;
  },
): Promise<string> {
  const pollIds = [
    ...new Set([...content.matchAll(pollPlaceholderPattern)].map((match) => match[1])),
  ];
  if (pollIds.length === 0) return content;

  const origin = await deliveryOrigin(env, organizationId, delivery);
  const issuedAt = Math.floor(Date.now() / 1_000);
  const tokens = new Map(
    await Promise.all(
      pollIds.map(
        async (pollId) =>
          [
            pollId,
            await issueSignedLink(env.SIGNED_LINK_SECRET, {
              algorithm: "HS256",
              expiresAt: issuedAt + 30 * 24 * 60 * 60,
              issuedAt,
              nonce: crypto.randomUUID(),
              organizationId,
              purpose: "poll",
              resourceId: pollId,
              subjectId: delivery.profileId,
              version: 1,
            }),
          ] as const,
      ),
    ),
  );
  return content.replace(pollPlaceholderPattern, (_match, pollId: string) => {
    const token = tokens.get(pollId);
    return token
      ? `[Respond Here (No login required)](${origin}/poll?token=${encodeURIComponent(token)})`
      : "Poll link unavailable; please contact your organization.";
  });
}
