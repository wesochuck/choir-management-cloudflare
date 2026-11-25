import { formatCommunicationEventDate, renderCommunicationTemplate } from "@choir/domain";
import { z } from "zod";

import {
  financialAlertRecipients,
  formatMoney,
  escapeMarkdown,
} from "../../organization/ticketSaleAlerts";
import { listOrganizationProfiles } from "../../organization/profiles";
import {
  queueAutomatedOrganizationCommunication,
  readOrganizationCommunicationTemplate,
} from "../../organization/organizationCommunications";
import { readOrganizationStore } from "../../organization/rpc/repository";
import type { DeliveryJob } from "../contracts";
import { deliveryOrigin, scheduledEventTemplateIds, type JobConsumerEnv } from "./shared";

const ticketCloseoutJobResponseSchema = z.object({
  admissions: z.object({
    complimentaryAdmissions: z.number().int().nonnegative(),
    singleEventAdmissions: z.number().int().nonnegative(),
    seasonPassAdmissions: z.number().int().nonnegative(),
    totalAdmissions: z.number().int().nonnegative(),
  }),
  event: z.object({
    eventId: z.uuid(),
    eventTitle: z.string().min(1).max(500),
    eventStartsAt: z.iso.datetime(),
    eventLocation: z.string().max(500),
    venueName: z.string().max(200),
    timezone: z.string().min(1).max(100),
  }),
  financials: z.object({
    netProceedsCents: z.number().int(),
    refundsCents: z.number().int().nonnegative(),
    seasonPassProceedsCents: z.number().int().nonnegative(),
    singleEventPaymentsCents: z.number().int().nonnegative(),
  }),
  scans: z.object({
    complimentaryAdmissions: z.number().int().nonnegative(),
    recordsAvailable: z.boolean(),
    seasonPassAdmissions: z.number().int().nonnegative(),
    singleEventAdmissions: z.number().int().nonnegative(),
    totalAdmissions: z.number().int().nonnegative(),
  }),
});

function checkInsSection(report: z.infer<typeof ticketCloseoutJobResponseSchema>): string {
  if (!report.scans.recordsAvailable) {
    return "No ticket scan records are available for this event. Admissions issued or covered do not indicate attendance.";
  }
  const breakdown = [
    `- Single-event ticket admissions: ${String(report.scans.singleEventAdmissions)}`,
    `- Season-pass admissions: ${String(report.scans.seasonPassAdmissions)}`,
    `- Complimentary admissions: ${String(report.scans.complimentaryAdmissions)}`,
    `- **Total successful check-ins:** ${String(report.scans.totalAdmissions)}`,
  ];
  if (report.scans.totalAdmissions === 0) {
    return ["No successful ticket check-ins were recorded.", ...breakdown].join("\n");
  }
  return breakdown.join("\n");
}

export async function deliverTicketCloseoutJob(
  env: JobConsumerEnv,
  job: DeliveryJob,
): Promise<void> {
  const response = await readOrganizationStore(
    env,
    job.organizationId,
    "/internal/scheduling/ticket-closeout-job",
    { jobId: job.jobId },
  );
  if (response.status === 404) return;
  const parsed = ticketCloseoutJobResponseSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || !parsed.success) {
    throw new Error("The ticket closeout job is unavailable.");
  }
  if (!env.CONTROL_DB) {
    throw new Error("The control database is unavailable for ticket closeout delivery.");
  }

  const profiles = await listOrganizationProfiles(env, job.organizationId);
  const recipients = await financialAlertRecipients(env.CONTROL_DB, job.organizationId, profiles);

  if (recipients.length === 0) {
    console.warn(
      JSON.stringify({
        event: "ticket_closeout_skipped_no_recipients",
        eventId: parsed.data.event.eventId,
        jobId: job.jobId,
        organizationId: job.organizationId,
      }),
    );
    return;
  }

  const origin = await deliveryOrigin(env, job.organizationId, { unsubscribeUrl: null });
  const template = await readOrganizationCommunicationTemplate(
    env,
    job.organizationId,
    scheduledEventTemplateIds.ticketCloseout,
  );
  const eventDate = formatCommunicationEventDate(
    parsed.data.event.eventStartsAt,
    parsed.data.event.timezone,
  );
  const values: Readonly<Record<string, string>> = {
    checkInsSection: checkInsSection(parsed.data),
    complimentaryAdmissions: String(parsed.data.admissions.complimentaryAdmissions),
    eventDate,
    eventLocation: escapeMarkdown(parsed.data.event.eventLocation || parsed.data.event.venueName),
    eventTitle: escapeMarkdown(parsed.data.event.eventTitle),
    netProceeds: formatMoney(parsed.data.financials.netProceedsCents, "USD"),
    refunds: formatMoney(parsed.data.financials.refundsCents, "USD"),
    seasonPassAdmissions: String(parsed.data.admissions.seasonPassAdmissions),
    seasonPassProceeds: formatMoney(parsed.data.financials.seasonPassProceedsCents, "USD"),
    singleEventAdmissions: String(parsed.data.admissions.singleEventAdmissions),
    singleTicketPayments: formatMoney(parsed.data.financials.singleEventPaymentsCents, "USD"),
    ticketOrdersUrl: `${origin}/admin/tickets`,
    totalAdmissions: String(parsed.data.admissions.totalAdmissions),
  };
  const contentMarkdown = renderCommunicationTemplate(
    template.contentMarkdown,
    "{recipientName}",
    values,
  );
  const subject = renderCommunicationTemplate(template.subject, "{recipientName}", {
    eventTitle: parsed.data.event.eventTitle,
  });

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
        eventId: parsed.data.event.eventId,
        eventType: "Performance",
        kind: "ticket_closeout",
      },
      contentMarkdown,
      dedupeKey: `ticket-closeout:${job.organizationId}:${parsed.data.event.eventId}`,
      eventId: parsed.data.event.eventId,
      recipients,
      subject,
    },
  );
}
