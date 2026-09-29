import { deliverOrganizationCommunication } from "../../communications/provider";
import { organizationStoreStub } from "../../organization/rpc/client";
import type { DeliveryJob } from "../contracts";
import type { JobConsumerEnv } from "./shared";
import {
  deliveryOrigin,
  readOrganizationBrandingConfig,
  readOrganizationEmailSenderConfig,
} from "./shared";

interface DueComplianceTask {
  readonly id: string;
  readonly lastCompletedDate: string | null;
  readonly nextDueDate: string;
  readonly title: string;
}

async function resolveEligibleComplianceTask(
  env: JobConsumerEnv,
  job: DeliveryJob,
): Promise<DueComplianceTask | null> {
  const parts = job.idempotencyKey.split(":");
  const taskKind = parts[2];
  const cycleDueDate = parts[3];

  const stub = organizationStoreStub(env, job.organizationId);
  const compliance = await stub.readNonprofitCompliance();
  if (!compliance.enabled) {
    return null;
  }

  const task = compliance.tasks.find((candidate) => candidate.kind === taskKind);
  if (!task || !task.applicable || !task.nextDueDate || task.nextDueDate !== cycleDueDate) {
    return null;
  }

  return {
    id: task.id,
    lastCompletedDate: task.lastCompletedDate,
    nextDueDate: task.nextDueDate,
    title: task.title,
  };
}

async function resolveAdministratorRecipients(
  env: JobConsumerEnv,
  organizationId: string,
): Promise<Map<string, string>> {
  if (!env.CONTROL_DB) {
    throw new Error("CONTROL_DB is required for nonprofit compliance notification delivery.");
  }

  const result = await env.CONTROL_DB.prepare(
    `SELECT u.email AS email, u.name AS name
     FROM member m
     JOIN user u ON u.id = m.userId
     WHERE m.organizationId = ?
       AND m.role IN ('owner', 'admin')`,
  )
    .bind(organizationId)
    .all<{ readonly email: string; readonly name: string | null }>();

  const recipients = new Map<string, string>();
  for (const row of result.results) {
    if (typeof row.email === "string" && row.email.trim().length > 0) {
      const email = row.email.trim().toLowerCase();
      const trimmedName = row.name?.trim();
      const name = trimmedName && trimmedName.length > 0 ? trimmedName : "Choir Administrator";
      if (!recipients.has(email)) {
        recipients.set(email, name);
      }
    }
  }
  return recipients;
}

function buildComplianceReminderMarkdown(
  organizationName: string,
  task: DueComplianceTask,
): string {
  return [
    `## Nonprofit compliance filing due`,
    "",
    `**${organizationName}** has a nonprofit compliance filing that still needs to be completed.`,
    "",
    `- **Requirement:** ${task.title}`,
    `- **Due date:** ${task.nextDueDate}`,
    `- **Last completed:** ${task.lastCompletedDate ?? "Not recorded"}`,
    `- **Reminder cadence:** Weekly until marked complete`,
    "",
    `Open Organization Settings → Nonprofit compliance to mark the filing complete or update its due date according to the date stored in Choir Management.`,
  ].join("\n");
}

export async function deliverComplianceReminderJob(
  env: JobConsumerEnv,
  job: DeliveryJob,
): Promise<void> {
  const task = await resolveEligibleComplianceTask(env, job);
  if (!task) {
    return;
  }

  const recipients = await resolveAdministratorRecipients(env, job.organizationId);
  if (recipients.size === 0) {
    console.warn(`No active owners or administrators found for organization ${job.organizationId}`);
    return;
  }

  const [senderConfig, branding] = await Promise.all([
    readOrganizationEmailSenderConfig(env, job.organizationId),
    readOrganizationBrandingConfig(env, job.organizationId),
  ]);
  const origin = await deliveryOrigin(env, job.organizationId, { unsubscribeUrl: null });
  const logoUrl = branding.logoFileId ? `${origin}/api/public/logo` : null;
  const organizationName = branding.organizationName
    ? branding.organizationName
    : "Choir Management";

  const subject = `Action required: ${task.title} is due`;
  const contentMarkdown = buildComplianceReminderMarkdown(organizationName, task);

  for (const [email, name] of recipients.entries()) {
    // Provider routes identify one recipient in one occurrence, including across job retries.
    // Hash the tuple to keep the key bounded and avoid embedding recipient addresses in logs.
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify([job.organizationId, job.idempotencyKey, email])),
    );
    const sourceId = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    await deliverOrganizationCommunication(env, {
      channel: "email",
      contentMarkdown,
      deliveryId: crypto.randomUUID(),
      destination: email,
      fromName: senderConfig.fromName ?? undefined,
      messageId: job.jobId,
      organizationId: job.organizationId,
      organizationLogoUrl: logoUrl,
      organizationName,
      physicalAddress: branding.physicalAddress,
      recipientName: name,
      replyTo: senderConfig.replyTo ?? undefined,
      sendingDomain: senderConfig.sendingDomain ?? undefined,
      sourceId,
      sourceKind: "compliance_reminder",
      subject,
      unsubscribeUrl: null,
    });
  }
}
