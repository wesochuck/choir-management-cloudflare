import { z } from "zod";

import {
  escapeMarkdown,
  financialAlertRecipients,
  formatEventDate,
} from "../../organization/ticketSaleAlerts";
import { listOrganizationProfiles } from "../../organization/profiles";
import { queueAutomatedOrganizationCommunication } from "../../organization/organizationCommunications";
import { readOrganizationStore } from "../../organization/rpc/repository";
import type { DeliveryJob } from "../contracts";
import { deliveryOrigin, type JobConsumerEnv } from "./shared";

const ticketWillCallNoticeJobResponseSchema = z.object({
  eventId: z.uuid(),
  eventLocation: z.string().max(500),
  eventStartsAt: z.iso.datetime(),
  eventTitle: z.string().min(1).max(500),
  timezone: z.string().min(1).max(100),
});

export async function deliverTicketWillCallJob(
  env: JobConsumerEnv,
  job: DeliveryJob,
): Promise<void> {
  const response = await readOrganizationStore(
    env,
    job.organizationId,
    "/internal/scheduling/ticket-will-call-job",
    { jobId: job.jobId },
  );
  if (response.status === 404) return;
  const parsed = ticketWillCallNoticeJobResponseSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!response.ok || !parsed.success) {
    throw new Error("The ticket will-call notice job is unavailable.");
  }
  if (!env.CONTROL_DB) {
    throw new Error("The control database is unavailable for ticket will-call delivery.");
  }

  const profiles = await listOrganizationProfiles(env, job.organizationId);
  const recipients = await financialAlertRecipients(env.CONTROL_DB, job.organizationId, profiles);
  if (recipients.length === 0) {
    console.warn(
      JSON.stringify({
        event: "ticket_will_call_skipped_no_recipients",
        eventId: parsed.data.eventId,
        jobId: job.jobId,
        organizationId: job.organizationId,
      }),
    );
    return;
  }

  const origin = await deliveryOrigin(env, job.organizationId, { unsubscribeUrl: null });
  const downloadUrl = `${origin}/api/organization/tickets/will-call?eventId=${encodeURIComponent(parsed.data.eventId)}`;
  const eventDate = formatEventDate(parsed.data.eventStartsAt, parsed.data.timezone);
  const eventTitle = parsed.data.eventTitle.replace(/\s+/g, " ").trim() || "Performance";
  const eventLocation = parsed.data.eventLocation.replace(/\s+/g, " ").trim();
  const contentMarkdown = [
    "Hi {recipientName},",
    "",
    `## Will-call list: ${escapeMarkdown(eventTitle)}`,
    "",
    `- **Date and time:** ${eventDate}`,
    ...(eventLocation ? [`- **Location:** ${escapeMarkdown(eventLocation)}`] : []),
    "",
    "Ticket sales are still going on, so the attached CSV is a snapshot and the list may change.",
    "",
    `[Download the current will-call list](${downloadUrl})`,
  ].join("\n");

  await queueAutomatedOrganizationCommunication(
    env,
    {
      actorUserId: "system:scheduler",
      organizationId: job.organizationId,
      organizationOrigin: origin,
      requestId: job.jobId,
    },
    {
      automation: {
        eventId: parsed.data.eventId,
        eventType: "Performance",
        kind: "ticket_will_call",
      },
      contentMarkdown,
      dedupeKey: `ticket-will-call-notice:${job.organizationId}:${parsed.data.eventId}:${parsed.data.eventStartsAt}`,
      eventId: parsed.data.eventId,
      recipients,
      subject: `Will-call list: ${eventTitle} (sales still open)`.slice(0, 300),
    },
  );
}
