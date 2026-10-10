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
  readonly description: string;
  readonly id: string;
  readonly lastCompletedDate: string | null;
  readonly nextDueDate: string;
  readonly referenceUrl: string | null;
  readonly responsibleEmail: string | null;
  readonly responsibleName: string | null;
  readonly responsibleNeedsReassignment: boolean;
  readonly source: string;
  readonly title: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveResponsibleDisplay(
  env: JobConsumerEnv,
  organizationId: string,
  membershipId: string | null,
): Promise<{
  readonly email: string | null;
  readonly name: string | null;
  readonly needsReassignment: boolean;
}> {
  if (!membershipId) return { email: null, name: null, needsReassignment: false };
  if (!env.CONTROL_DB) {
    throw new Error("CONTROL_DB is required for nonprofit compliance notification delivery.");
  }
  const row = await env.CONTROL_DB.prepare(
    `SELECT u.email AS email, u.name AS name, m.role AS role
     FROM member m
     JOIN user u ON u.id = m.userId
     WHERE m.id = ? AND m.organizationId = ? LIMIT 1`,
  )
    .bind(membershipId, organizationId)
    .first<{ readonly email: string; readonly name: string | null; readonly role: string }>();
  if (!row || (row.role !== "owner" && row.role !== "admin")) {
    return { email: null, name: null, needsReassignment: true };
  }
  const name = row.name?.trim();
  const email = row.email.trim();
  if (!name || !email) return { email: null, name: null, needsReassignment: true };
  return { email, name, needsReassignment: false };
}

async function resolveEligibleComplianceTask(
  env: JobConsumerEnv,
  job: DeliveryJob,
): Promise<DueComplianceTask | null> {
  const parts = job.idempotencyKey.split(":");
  // New: nonprofit-compliance:{org}:{taskId}:{due}:{occurrence}
  // Legacy: nonprofit-compliance:{org}:{kind}:{due}:{occurrence}
  const taskIdOrKind = parts[2];
  const cycleDueDate = parts[3];
  if (!taskIdOrKind || !cycleDueDate) return null;

  const stub = organizationStoreStub(env, job.organizationId);
  const compliance = await stub.readNonprofitCompliance();

  const isUuid = UUID_PATTERN.test(taskIdOrKind);
  const task = isUuid
    ? compliance.tasks.find((candidate) => candidate.id === taskIdOrKind)
    : compliance.tasks.find((candidate) => candidate.kind === taskIdOrKind);

  if (!task || !task.applicable || !task.nextDueDate || task.nextDueDate !== cycleDueDate) {
    return null;
  }
  if (task.archived) return null;
  const source = task.source;
  if (source !== "custom" && !compliance.enabled) {
    return null;
  }

  const responsible = await resolveResponsibleDisplay(
    env,
    job.organizationId,
    task.responsibleMembershipId,
  );

  return {
    description: task.description,
    id: task.id,
    lastCompletedDate: task.lastCompletedDate,
    nextDueDate: task.nextDueDate,
    referenceUrl: task.referenceUrl,
    responsibleEmail: responsible.email,
    responsibleName: responsible.name,
    responsibleNeedsReassignment: responsible.needsReassignment,
    source,
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
  const responsibleLine = task.responsibleNeedsReassignment
    ? `Needs reassignment (previously assigned administrator is no longer eligible)`
    : task.responsibleName && task.responsibleEmail
      ? `${task.responsibleName} (${task.responsibleEmail})`
      : `Unassigned`;
  const lines = [
    `## Compliance reminder due`,
    ``,
    `**${organizationName}** has a compliance reminder that still needs to be completed.`,
    ``,
    `- **Requirement:** ${task.title}`,
    `- **Due date:** ${task.nextDueDate}`,
    `- **Last completed:** ${task.lastCompletedDate ?? "Not recorded"}`,
    `- **Responsible:** ${responsibleLine}`,
    `- **Reminder cadence:** Weekly until marked complete`,
  ];
  if (task.responsibleNeedsReassignment) {
    lines.push(
      ``,
      `The designated responsible administrator is no longer an eligible Owner or Administrator. ` +
        `Please assign a current Owner or Administrator. This reminder was still sent to all currently eligible Owners and Administrators.`,
    );
  }
  if (task.description && task.description.trim().length > 0) {
    lines.push(``, `**Notes:** ${task.description.trim()}`);
  }
  if (task.referenceUrl && task.referenceUrl.trim().length > 0) {
    lines.push(``, `**Reference:** ${task.referenceUrl.trim()}`);
  }
  lines.push(
    ``,
    `Open Organization Settings → Compliance & deadlines to mark the filing complete or update its due date according to the date stored in Choir Management. ` +
      `The app tracks Organization-entered deadlines; it does not determine whether a filing is legally required.`,
  );
  return lines.join("\n");
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
