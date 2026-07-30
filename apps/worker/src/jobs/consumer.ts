import { z } from "zod";
import { renderCommunicationTemplate } from "@choir/domain";

import type { Env } from "../env";
import { deliverOrganizationCommunication } from "../communications/provider";
import {
  readCommunicationDeliveryJob,
  recordCommunicationDeliveryResults,
} from "../organization/organizationCommunications";
import { buildOrganizationExportArchive } from "../organization/organizationExport";
import { issuePlayerToken } from "../organization/organizationPlayerLinks";
import { issueRsvpToken } from "../organization/organizationRsvpLinks";
import { deliveryJobSchema, type DeliveryJob } from "./contracts";
import { issueSignedLink } from "../security/signedLinks";
import { organizationExportKey } from "../organization/exportStore";

type JobConsumerEnv = Pick<
  Env,
  | "BREVO_API_KEY"
  | "BREVO_EMAIL_FROM"
  | "BREVO_EMAIL_FROM_NAME"
  | "BREVO_SMS_ALLOWED_RECIPIENTS"
  | "BREVO_SMS_SENDER"
  | "EXTERNAL_EFFECTS_MODE"
  | "ORGANIZATION_FILES"
  | "ORGANIZATION_STORE"
  | "PRODUCT_BASE_DOMAIN"
  | "SIGNED_LINK_SECRET"
>;
type DeadLetterConsumerEnv = Pick<Env, "CONTROL_DB">;

const claimResponseSchema = z.object({
  claimed: z.boolean(),
  status: z.string(),
});
const completionResponseSchema = z.object({ completed: z.boolean() });
const deliveryAttemptSchema = z.number().int().min(1).max(10);
const failureResponseSchema = z.object({ failed: z.boolean() });
const ticketNotificationJobSchema = z.object({
  buyerName: z.string().min(1).max(200),
  contentMarkdown: z.string().max(100_000),
  destination: z.email(),
  eventStartsAt: z.iso.datetime(),
  id: z.uuid(),
  purchaseId: z.uuid(),
  status: z.enum(["queued", "processing"]),
  subject: z.string().max(300),
});
const auditionNotificationJobSchema = z.object({
  contentMarkdown: z.string().max(100_000),
  destination: z.email(),
  id: z.uuid(),
  recipientName: z.string().min(1).max(200),
  status: z.enum(["queued", "processing"]),
  subject: z.string().max(300),
});
const organizationExportJobSchema = z.object({
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
const organizationExportSnapshotSchema = z.object({
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
});
const deadLetterInsertSql = `INSERT INTO job_dead_letters
  (id, queue_name, message_id, message_valid, observed_attempt,
   organization_id, job_id, job_kind, idempotency_key,
   first_seen_at, last_seen_at, observation_count)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
 ON CONFLICT(id) DO UPDATE SET
   last_seen_at = excluded.last_seen_at,
   observed_attempt = excluded.observed_attempt,
   observation_count = job_dead_letters.observation_count + 1`;

function retryDelaySeconds(attempt: number): number {
  const exponentialDelay = Math.min(300, 2 ** attempt);
  const deterministicJitter = (attempt * 17) % 11;
  return exponentialDelay + deterministicJitter;
}

async function recordJobFailure(env: JobConsumerEnv, job: DeliveryJob): Promise<void> {
  try {
    const objectId = env.ORGANIZATION_STORE.idFromName(job.organizationId);
    const failureResponse = await env.ORGANIZATION_STORE.get(objectId).fetch(
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

async function deliverCommunicationJob(env: JobConsumerEnv, job: DeliveryJob): Promise<void> {
  const deliveryJob = await readCommunicationDeliveryJob(env, job.organizationId, job.jobId);
  const results = [];
  for (const delivery of deliveryJob.deliveries) {
    const templatedContent = renderCommunicationTemplate(
      deliveryJob.contentMarkdown,
      delivery.recipientName,
      deliveryJob.context ?? undefined,
    );
    const contentWithRsvpLinks = await renderRsvpLinks(
      env,
      job.organizationId,
      templatedContent,
      deliveryJob.context?.eventId ?? null,
      delivery,
    );
    const contentWithPlayerLinks = await renderPlayerLinks(
      env,
      job.organizationId,
      contentWithRsvpLinks,
      deliveryJob.context?.eventId ?? null,
      delivery,
    );
    const renderedContent = await renderPollLinks(
      env,
      job.organizationId,
      contentWithPlayerLinks,
      delivery,
    );
    const result = await deliverOrganizationCommunication(env, {
      channel: delivery.channel,
      contentMarkdown: renderedContent,
      deliveryId: delivery.id,
      destination: delivery.destination,
      messageId: deliveryJob.messageId,
      recipientName: delivery.recipientName,
      subject: renderCommunicationTemplate(
        deliveryJob.subject,
        delivery.recipientName,
        deliveryJob.context ?? undefined,
      ),
      unsubscribeUrl: delivery.unsubscribeUrl,
    });
    results.push({ deliveryId: delivery.id, ...result });
  }
  await recordCommunicationDeliveryResults(env, {
    jobId: job.jobId,
    organizationId: job.organizationId,
    results,
  });
}

const pollPlaceholderPattern = /\{\{POLL_LINK:([0-9a-f-]{36})\}\}/gi;
const rsvpPlaceholderPattern = /\{\{RSVP_LINKS\}\}|\{rsvpLinks\}/i;
const rsvpPlaceholderReplacementPattern = /\{\{RSVP_LINKS\}\}|\{rsvpLinks\}/gi;
const playerPlaceholderPattern = /\{\{PLAYER_LINK\}\}|\{playerLink\}/i;
const playerPlaceholderReplacementPattern = /\{\{PLAYER_LINK\}\}|\{playerLink\}/gi;

function deliveryOrigin(
  env: Pick<JobConsumerEnv, "PRODUCT_BASE_DOMAIN">,
  delivery: { readonly unsubscribeUrl: string | null },
): string {
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
  const rsvpLink = `${deliveryOrigin(env, delivery)}/rsvp?token=${encodeURIComponent(token)}`;
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
  const playerLink = `${deliveryOrigin(env, delivery)}/player?token=${encodeURIComponent(token)}`;
  const replacement = `[Open practice player](${playerLink})\n\n(No login required.)`;
  return content.replace(playerPlaceholderReplacementPattern, () => replacement);
}

async function renderPollLinks(
  env: JobConsumerEnv,
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

  const origin = deliveryOrigin(env, delivery);
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
      ? `${origin}/poll?token=${encodeURIComponent(token)}`
      : "Poll link unavailable; please contact your organization.";
  });
}

async function deliverTicketNotificationJob(env: JobConsumerEnv, job: DeliveryJob): Promise<void> {
  const objectId = env.ORGANIZATION_STORE.idFromName(job.organizationId);
  const objectStub = env.ORGANIZATION_STORE.get(objectId);
  const url = new URL("https://organization.internal/internal/ticketing/notification-job");
  url.searchParams.set("organizationId", job.organizationId);
  url.searchParams.set("jobId", job.jobId);
  const response = await objectStub.fetch(url);
  const notification = ticketNotificationJobSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!response.ok || !notification.success) {
    throw new Error("The ticket notification job is unavailable.");
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const eventEndsAt =
    Math.floor(new Date(notification.data.eventStartsAt).getTime() / 1000) + 86_400;
  const scanToken = await issueSignedLink(env.SIGNED_LINK_SECRET, {
    algorithm: "HS256",
    expiresAt: Math.max(issuedAt + 3_600, eventEndsAt),
    issuedAt,
    nonce: crypto.randomUUID(),
    organizationId: job.organizationId,
    purpose: "ticket_scan",
    resourceId: notification.data.purchaseId,
    version: 1,
  });
  const result = await deliverOrganizationCommunication(env, {
    channel: "email",
    contentMarkdown: `${notification.data.contentMarkdown}\n\nTicket credential: ${scanToken}`,
    deliveryId: notification.data.id,
    destination: notification.data.destination,
    messageId: notification.data.id,
    recipientName: notification.data.buyerName,
    subject: notification.data.subject,
    unsubscribeUrl: null,
  });
  const recordResponse = await objectStub.fetch(
    "https://organization.internal/internal/ticketing/manage",
    {
      body: JSON.stringify({
        action: "record_ticket_notification_result",
        failureDetail: result.failureDetail,
        jobId: job.jobId,
        organizationId: job.organizationId,
        providerMessageId: result.providerMessageId,
        status: result.status,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!recordResponse.ok) throw new Error("The ticket notification result was rejected.");
}

async function deliverAuditionNotificationJob(
  env: JobConsumerEnv,
  job: DeliveryJob,
): Promise<void> {
  const objectStub = env.ORGANIZATION_STORE.get(
    env.ORGANIZATION_STORE.idFromName(job.organizationId),
  );
  const url = new URL("https://organization.internal/internal/audition/notification-job");
  url.searchParams.set("organizationId", job.organizationId);
  url.searchParams.set("jobId", job.jobId);
  const response = await objectStub.fetch(url);
  const notification = auditionNotificationJobSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!response.ok || !notification.success) {
    throw new Error("The audition notification job is unavailable.");
  }
  const result = await deliverOrganizationCommunication(env, {
    channel: "email",
    contentMarkdown: notification.data.contentMarkdown,
    deliveryId: notification.data.id,
    destination: notification.data.destination,
    messageId: notification.data.id,
    recipientName: notification.data.recipientName,
    subject: notification.data.subject,
    unsubscribeUrl: null,
  });
  const recordResponse = await objectStub.fetch(
    "https://organization.internal/internal/audition/notification-result",
    {
      body: JSON.stringify({
        failureDetail: result.failureDetail,
        jobId: job.jobId,
        organizationId: job.organizationId,
        providerMessageId: result.providerMessageId,
        status: result.status,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!recordResponse.ok) throw new Error("The audition notification result was rejected.");
}

async function deliverOrganizationExportJob(env: JobConsumerEnv, job: DeliveryJob): Promise<void> {
  const objectStub = env.ORGANIZATION_STORE.get(
    env.ORGANIZATION_STORE.idFromName(job.organizationId),
  );
  const jobUrl = new URL("https://organization.internal/internal/export/job");
  jobUrl.searchParams.set("organizationId", job.organizationId);
  jobUrl.searchParams.set("exportId", job.jobId);
  const jobResponse = await objectStub.fetch(jobUrl);
  const exportJob = organizationExportJobSchema.safeParse(
    await jobResponse.json().catch(() => null),
  );
  if (!jobResponse.ok || !exportJob.success) {
    throw new Error("The Organization export job is unavailable.");
  }
  if (exportJob.data.status === "completed") return;

  try {
    const snapshotUrl = new URL("https://organization.internal/internal/export/snapshot");
    snapshotUrl.searchParams.set("organizationId", job.organizationId);
    const snapshotResponse = await objectStub.fetch(snapshotUrl);
    const snapshot = organizationExportSnapshotSchema.safeParse(
      await snapshotResponse.json().catch(() => null),
    );
    if (!snapshotResponse.ok || !snapshot.success) {
      throw new Error("The Organization export snapshot is unavailable.");
    }
    const prefix = `organizations/${job.organizationId}/private/`;
    const fileObjects = await env.ORGANIZATION_FILES.list({ limit: 500, prefix });
    if (fileObjects.truncated) throw new Error("export_too_large");
    const fileChecksums = new Map(
      fileObjects.objects.map((object) => [
        object.key,
        Object.fromEntries(Object.entries(object.checksums.toJSON())),
      ]),
    );
    const files = snapshot.data.files.map((file) => ({
      ...file,
      checksums: fileChecksums.get(file.storageKey) ?? file.checksums,
    }));
    const archive = await buildOrganizationExportArchive({
      files,
      organizationId: job.organizationId,
      snapshot: snapshot.data,
    });
    const archiveKey = organizationExportKey(job.organizationId, job.jobId);
    await env.ORGANIZATION_FILES.put(archiveKey, archive.archive, {
      customMetadata: {
        exportId: job.jobId,
        organizationId: job.organizationId,
      },
      httpMetadata: { contentType: "application/json" },
    });
    const completeResponse = await objectStub.fetch(
      "https://organization.internal/internal/export/complete",
      {
        body: JSON.stringify({
          actorType: exportJob.data.actorType,
          actorUserId: exportJob.data.actorUserId,
          archiveKey,
          byteCount: archive.byteCount,
          checksumSha256: archive.checksumSha256,
          exportId: job.jobId,
          organizationId: job.organizationId,
          requestId: exportJob.data.requestId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    if (!completeResponse.ok) throw new Error("The Organization export completion was rejected.");
  } catch (error: unknown) {
    await objectStub.fetch("https://organization.internal/internal/export/fail", {
      body: JSON.stringify({
        actorType: exportJob.data.actorType,
        actorUserId: exportJob.data.actorUserId,
        errorCode:
          error instanceof Error && error.message === "export_too_large"
            ? "export_too_large"
            : "export_generation_failed",
        exportId: job.jobId,
        organizationId: job.organizationId,
        requestId: exportJob.data.requestId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    throw error;
  }
}

async function dispatchDeliveryJob(env: JobConsumerEnv, job: DeliveryJob): Promise<void> {
  if (job.kind === "communication_delivery") {
    await deliverCommunicationJob(env, job);
    return;
  }
  if (job.kind === "ticket_notification") {
    await deliverTicketNotificationJob(env, job);
    return;
  }
  if (job.kind === "audition_notification") {
    await deliverAuditionNotificationJob(env, job);
    return;
  }
  if (job.kind === "organization_export") {
    await deliverOrganizationExportJob(env, job);
    return;
  }
  if (job.kind === "event_reminder" || job.kind === "attendance_report") {
    // In fake or disabled mode, these scheduled background tasks complete idempotently.
    if (env.EXTERNAL_EFFECTS_MODE === "fake" || env.EXTERNAL_EFFECTS_MODE === "disabled") {
      return;
    }
  }
  if (env.EXTERNAL_EFFECTS_MODE !== "fake" && env.EXTERNAL_EFFECTS_MODE !== "disabled") {
    throw new Error("No sandbox provider adapter is configured for this job kind");
  }
}

async function processDeliveryMessage(message: Message, env: JobConsumerEnv): Promise<void> {
  const parsed = deliveryJobSchema.safeParse(message.body);
  if (!parsed.success) {
    console.error(JSON.stringify({ event: "invalid_queue_message", messageId: message.id }));
    message.ack();
    return;
  }
  const deliveryAttempt = deliveryAttemptSchema.safeParse(message.attempts);
  if (!deliveryAttempt.success) {
    console.error(JSON.stringify({ event: "invalid_queue_attempt", messageId: message.id }));
    message.ack();
    return;
  }

  const job: DeliveryJob = { ...parsed.data, attempt: deliveryAttempt.data };
  let claimed = false;
  try {
    const objectId = env.ORGANIZATION_STORE.idFromName(job.organizationId);
    const objectStub = env.ORGANIZATION_STORE.get(objectId);
    const claimResponse = await objectStub.fetch(
      "https://organization.internal/internal/jobs/claim",
      {
        body: JSON.stringify(job),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    const claim = claimResponseSchema.safeParse(await claimResponse.json());
    if (!claimResponse.ok || !claim.success) {
      throw new Error("Organization store rejected queue claim");
    }
    if (!claim.data.claimed) {
      message.ack();
      return;
    }
    claimed = true;

    await dispatchDeliveryJob(env, job);

    const completeResponse = await objectStub.fetch(
      "https://organization.internal/internal/jobs/complete",
      {
        body: JSON.stringify({
          attempt: job.attempt,
          completedAt: new Date().toISOString(),
          idempotencyKey: job.idempotencyKey,
          jobId: job.jobId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    const completion = completionResponseSchema.safeParse(await completeResponse.json());
    if (!completeResponse.ok || !completion.success || !completion.data.completed) {
      throw new Error("Organization store rejected queue completion");
    }

    message.ack();
    console.info(
      JSON.stringify({
        event: "queue_job_completed",
        jobId: job.jobId,
        kind: job.kind,
        organizationId: job.organizationId,
      }),
    );
  } catch (error: unknown) {
    if (claimed) {
      await recordJobFailure(env, job);
    }
    console.error(
      JSON.stringify({
        errorType: error instanceof Error ? error.name : "UnknownError",
        event: "queue_job_failed",
        jobId: job.jobId,
        kind: job.kind,
        organizationId: job.organizationId,
      }),
    );
    message.retry({ delaySeconds: retryDelaySeconds(deliveryAttempt.data) });
  }
}

export async function processDeliveryBatch(
  batch: MessageBatch,
  env: JobConsumerEnv,
): Promise<void> {
  for (const message of batch.messages) {
    await processDeliveryMessage(message, env);
  }
}

export async function processDeadLetterBatch(
  batch: MessageBatch,
  env: DeadLetterConsumerEnv,
): Promise<void> {
  const records = batch.messages.map((message) => {
    const parsed = deliveryJobSchema.safeParse(message.body);
    const observedAt = new Date().toISOString();
    const recordId = `${batch.queue}:${message.id}`;
    const job = parsed.success ? parsed.data : null;
    return {
      job,
      message,
      statement: env.CONTROL_DB.prepare(deadLetterInsertSql).bind(
        recordId,
        batch.queue,
        message.id,
        job ? 1 : 0,
        message.attempts,
        job?.organizationId ?? null,
        job?.jobId ?? null,
        job?.kind ?? null,
        job?.idempotencyKey ?? null,
        observedAt,
        observedAt,
      ),
    };
  });
  if (records.length > 0) {
    await env.CONTROL_DB.batch(records.map(({ statement }) => statement));
  }
  for (const { job, message } of records) {
    message.ack();
    console.error(
      JSON.stringify({
        event: "queue_job_dead_lettered",
        jobId: job?.jobId ?? null,
        kind: job?.kind ?? null,
        messageId: message.id,
        organizationId: job?.organizationId ?? null,
        queue: batch.queue,
      }),
    );
  }
}
