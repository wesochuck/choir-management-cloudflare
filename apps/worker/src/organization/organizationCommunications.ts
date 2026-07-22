import {
  communicationDeliverySummarySchema,
  communicationMessageSchema,
  communicationMessagesResponseSchema,
  communicationReachSchema,
  communicationTemplateSchema,
  communicationTemplatesResponseSchema,
  type CommunicationAudienceRequest,
  type CommunicationDeliverySummary,
  type CommunicationDraftRequest,
  type CommunicationMessage,
  type CommunicationReach,
  type CommunicationSendRequest,
  type CommunicationTemplate,
  type CommunicationTemplateRequest,
} from "@choir/contracts";
import { communicationReach } from "@choir/domain";
import { z } from "zod";

import type { Env } from "../env";
import { listOrganizationProfileEmails } from "./profiles";

const candidateResponseSchema = z.object({
  recipients: z.array(
    z.object({
      displayName: z.string().min(1).max(200),
      doNotEmail: z.boolean(),
      phone: z.string().max(40),
      profileId: z.uuid(),
      voicePart: z.string().max(100),
    }),
  ),
});
const deliveryJobResponseSchema = z.object({
  contentMarkdown: z.string().max(100_000),
  deliveries: z.array(
    z.object({
      channel: z.enum(["email", "sms"]),
      destination: z.string().min(1).max(320),
      id: z.uuid(),
      recipientName: z.string().min(1).max(200),
    }),
  ),
  messageId: z.uuid(),
  subject: z.string().max(300),
});
const retryResponseSchema = z.object({
  messageId: z.uuid(),
  retried: z.number().int().nonnegative(),
});

export class CommunicationRepositoryError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409 | 500 | 503,
  ) {
    super(code);
    this.name = "CommunicationRepositoryError";
  }
}

function stub(env: Env, organizationId: string): DurableObjectStub {
  return env.ORGANIZATION_STORE.get(env.ORGANIZATION_STORE.idFromName(organizationId));
}

async function failure(response: Response): Promise<CommunicationRepositoryError> {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  const code =
    typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
      ? body.code
      : "communication_repository_error";
  const status =
    response.status === 400 ||
    response.status === 404 ||
    response.status === 409 ||
    response.status === 500
      ? response.status
      : 503;
  return new CommunicationRepositoryError(code, status);
}

async function post(
  env: Env,
  organizationId: string,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const response = await stub(env, organizationId).fetch(`https://organization.internal${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw await failure(response);
  return response;
}

interface Recipient {
  readonly email: string;
  readonly name: string;
  readonly phone: string;
  readonly profileId: string;
}

async function resolveRecipients(
  env: Env,
  database: D1Database,
  organizationId: string,
  audience: CommunicationAudienceRequest,
): Promise<readonly Recipient[]> {
  const [response, emails] = await Promise.all([
    post(env, organizationId, "/internal/communications/audience", {
      audience,
      organizationId,
    }),
    listOrganizationProfileEmails(database, organizationId),
  ]);
  const candidates = candidateResponseSchema.parse(await response.json()).recipients;
  return candidates.map((candidate) => ({
    email: candidate.doNotEmail ? "" : (emails.get(candidate.profileId) ?? ""),
    name: candidate.displayName,
    phone: candidate.phone,
    profileId: candidate.profileId,
  }));
}

export async function previewCommunicationReach(
  env: Env,
  database: D1Database,
  organizationId: string,
  request: Pick<CommunicationSendRequest, "audience" | "channel">,
): Promise<CommunicationReach> {
  return communicationReach(
    await resolveRecipients(env, database, organizationId, request.audience),
    request.channel,
  );
}

interface ActorContext {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

export async function saveCommunicationDraft(
  env: Env,
  database: D1Database,
  context: ActorContext,
  message: CommunicationDraftRequest,
): Promise<CommunicationMessage> {
  const reach = communicationReach(
    await resolveRecipients(env, database, context.organizationId, message.audience),
    message.channel,
  );
  const response = await post(env, context.organizationId, "/internal/communications/manage", {
    action: "save-draft",
    ...context,
    message,
    messageId: crypto.randomUUID(),
    reach,
  });
  return communicationMessageSchema.parse(await response.json());
}

export async function sendOrganizationCommunication(
  env: Env,
  database: D1Database,
  context: ActorContext,
  message: CommunicationSendRequest,
): Promise<CommunicationMessage> {
  const recipients = await resolveRecipients(
    env,
    database,
    context.organizationId,
    message.audience,
  );
  const response = await post(env, context.organizationId, "/internal/communications/manage", {
    action: "send",
    ...context,
    jobId: crypto.randomUUID(),
    message,
    messageId: crypto.randomUUID(),
    recipients,
  });
  return communicationMessageSchema.parse(await response.json());
}

export async function listOrganizationCommunications(
  env: Env,
  organizationId: string,
): Promise<readonly CommunicationMessage[]> {
  const url = new URL("https://organization.internal/internal/communications");
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) throw await failure(response);
  return communicationMessagesResponseSchema.omit({ requestId: true }).parse(await response.json())
    .messages;
}

export async function readCommunicationDeliverySummary(
  env: Env,
  organizationId: string,
  messageId: string,
): Promise<CommunicationDeliverySummary> {
  const url = new URL("https://organization.internal/internal/communications/summary");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("messageId", messageId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) throw await failure(response);
  return communicationDeliverySummarySchema.parse(await response.json());
}

export async function retryCommunicationDeliveries(
  env: Env,
  context: ActorContext,
  messageId: string,
): Promise<number> {
  const response = await post(env, context.organizationId, "/internal/communications/manage", {
    action: "retry",
    ...context,
    jobId: crypto.randomUUID(),
    messageId,
  });
  return retryResponseSchema.parse(await response.json()).retried;
}

export async function deleteCommunicationDraft(
  env: Env,
  context: ActorContext,
  messageId: string,
): Promise<void> {
  await post(env, context.organizationId, "/internal/communications/manage", {
    action: "delete-draft",
    ...context,
    messageId,
  });
}

export async function listCommunicationTemplates(
  env: Env,
  organizationId: string,
): Promise<readonly CommunicationTemplate[]> {
  const url = new URL("https://organization.internal/internal/communications/templates");
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) throw await failure(response);
  return communicationTemplatesResponseSchema.omit({ requestId: true }).parse(await response.json())
    .templates;
}

export async function saveCommunicationTemplate(
  env: Env,
  context: ActorContext,
  template: CommunicationTemplateRequest,
): Promise<CommunicationTemplate> {
  const response = await post(env, context.organizationId, "/internal/communications/manage", {
    action: "save-template",
    ...context,
    template,
    templateId: crypto.randomUUID(),
  });
  return communicationTemplateSchema.parse(await response.json());
}

export async function deleteCommunicationTemplate(
  env: Env,
  context: ActorContext,
  templateId: string,
): Promise<void> {
  await post(env, context.organizationId, "/internal/communications/manage", {
    action: "delete-template",
    ...context,
    templateId,
  });
}

export async function readCommunicationDeliveryJob(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
  jobId: string,
) {
  const url = new URL("https://organization.internal/internal/communications/job");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("jobId", jobId);
  const response = await env.ORGANIZATION_STORE.get(
    env.ORGANIZATION_STORE.idFromName(organizationId),
  ).fetch(url);
  if (!response.ok) throw new Error("The Organization store rejected the communication job.");
  return deliveryJobResponseSchema.parse(await response.json());
}

export async function recordCommunicationDeliveryResults(
  env: Pick<Env, "ORGANIZATION_STORE">,
  input: {
    readonly jobId: string;
    readonly organizationId: string;
    readonly results: readonly {
      readonly deliveryId: string;
      readonly failureDetail: string;
      readonly providerMessageId: string | null;
      readonly status: "failed" | "sent" | "suppressed";
    }[];
  },
): Promise<void> {
  const response = await env.ORGANIZATION_STORE.get(
    env.ORGANIZATION_STORE.idFromName(input.organizationId),
  ).fetch("https://organization.internal/internal/communications/manage", {
    body: JSON.stringify({ action: "delivery-result", ...input }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error("The Organization store rejected communication results.");
}

export function parseCommunicationReach(value: unknown): CommunicationReach {
  return communicationReachSchema.parse(value);
}
