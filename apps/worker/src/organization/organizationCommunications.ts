import {
  communicationDeliverySummarySchema,
  communicationMessageSchema,
  communicationMessagesResponseSchema,
  communicationReachSchema,
  communicationScheduledMessagesResponseSchema,
  communicationTemplateSchema,
  communicationTemplatesResponseSchema,
  type CommunicationAudienceRequest,
  type CommunicationDeliverySummary,
  type CommunicationDraftRequest,
  type CommunicationMessage,
  type CommunicationReach,
  type CommunicationScheduledMessage,
  type CommunicationSendRequest,
  type CommunicationTemplate,
  type CommunicationTemplateRequest,
} from "@choir/contracts";
import { communicationReach } from "@choir/domain";
import { z } from "zod";

import type { Env } from "../env";
import { issueSignedLink } from "../security/signedLinks";
import { listOrganizationProfileEmails } from "./profiles";
import { invokeOrganizationRpc, organizationStoreStub } from "./rpc/client";

const candidateResponseSchema = z.object({
  recipients: z.array(
    z.object({
      displayName: z.string().min(1).max(200),
      doNotEmail: z.boolean(),
      email: z.string().max(320).nullable(),
      emailSuppressed: z.boolean(),
      phone: z.string().max(40),
      profileId: z.uuid(),
      voicePart: z.string().max(100),
    }),
  ),
});
const deliveryJobResponseSchema = z.object({
  contentMarkdown: z.string().max(100_000),
  context: z
    .object({
      eventId: z.uuid(),
      eventCallTime: z.string(),
      eventDate: z.string(),
      eventDetails: z.string(),
      eventLocation: z.string(),
      eventTitle: z.string(),
      eventType: z.string(),
      setlist: z.string(),
    })
    .nullable(),
  deliveries: z.array(
    z.object({
      channel: z.enum(["email", "sms"]),
      destination: z.string().min(1).max(320),
      id: z.uuid(),
      profileId: z.uuid(),
      recipientName: z.string().min(1).max(200),
      unsubscribeUrl: z.url().max(4_096).nullable(),
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

function stub(env: Pick<Env, "ORGANIZATION_STORE">, organizationId: string) {
  return organizationStoreStub(env, organizationId);
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
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const response = await invokeOrganizationRpc(
    stub(env, organizationId),
    `https://organization.internal${path}`,
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) throw await failure(response);
  return response;
}

interface Recipient {
  readonly email: string;
  readonly name: string;
  readonly phone: string;
  readonly profileId: string;
  readonly unsubscribeUrl: string | null;
}

export interface AutomatedCommunicationRecipient {
  readonly email: string;
  readonly name: string;
  readonly phone: string;
  readonly profileId: string;
}

type AutomatedCommunicationEnv = Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">;

async function resolveRecipients(
  env: Env,
  database: D1Database,
  organizationId: string,
  audience: CommunicationAudienceRequest,
  unsubscribeOrigin: string | null,
): Promise<readonly Recipient[]> {
  const [response, emails] = await Promise.all([
    post(env, organizationId, "/internal/communications/audience", {
      audience,
      organizationId,
    }),
    listOrganizationProfileEmails(database, organizationId),
  ]);
  const candidates = candidateResponseSchema.parse(await response.json()).recipients;
  const issuedAt = Math.floor(Date.now() / 1_000);
  const merged = new Map<string, (typeof candidates)[number]>();
  candidates.forEach((candidate) => {
    const email = candidate.email ?? emails.get(candidate.profileId) ?? "";
    const key = email.trim().toLowerCase();
    if (!key) return;
    const isMember = emails.has(candidate.profileId);
    const previous = merged.get(key);
    if (!previous || isMember) merged.set(key, candidate);
  });
  return Promise.all(
    [...merged.values()].map(async (candidate) => {
      const isMember = emails.has(candidate.profileId);
      const email =
        candidate.doNotEmail || candidate.emailSuppressed
          ? ""
          : (candidate.email ?? emails.get(candidate.profileId) ?? "");
      const token =
        email && unsubscribeOrigin && isMember
          ? await issueSignedLink(env.SIGNED_LINK_SECRET, {
              algorithm: "HS256",
              expiresAt: issuedAt + 365 * 24 * 60 * 60,
              issuedAt,
              organizationId,
              purpose: "unsubscribe",
              revocation: "email-v1",
              subjectId: candidate.profileId,
              version: 1,
            })
          : null;
      return {
        email,
        name: candidate.displayName,
        phone: candidate.phone,
        profileId: candidate.profileId,
        unsubscribeUrl:
          token && unsubscribeOrigin
            ? `${unsubscribeOrigin}/unsubscribe?token=${encodeURIComponent(token)}`
            : null,
      };
    }),
  );
}

export async function previewCommunicationReach(
  env: Env,
  database: D1Database,
  organizationId: string,
  request: Pick<CommunicationSendRequest, "audience" | "channel">,
): Promise<CommunicationReach> {
  return communicationReach(
    await resolveRecipients(env, database, organizationId, request.audience, null),
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
    await resolveRecipients(env, database, context.organizationId, message.audience, null),
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
  context: ActorContext & { readonly organizationOrigin: string },
  message: CommunicationSendRequest,
  idempotencyKey?: string,
): Promise<CommunicationMessage> {
  const recipients = await resolveRecipients(
    env,
    database,
    context.organizationId,
    message.audience,
    context.organizationOrigin,
  );
  const response = await post(env, context.organizationId, "/internal/communications/manage", {
    action: "send",
    ...context,
    dedupeKey: idempotencyKey,
    jobId: crypto.randomUUID(),
    message,
    messageId: crypto.randomUUID(),
    recipients,
  });
  return communicationMessageSchema.parse(await response.json());
}

export async function cancelOrganizationCommunication(
  env: Env,
  context: ActorContext,
  messageId: string,
): Promise<CommunicationMessage> {
  const response = await post(env, context.organizationId, "/internal/communications/manage", {
    action: "cancel",
    ...context,
    messageId,
  });
  return communicationMessageSchema.parse(await response.json());
}

export async function readOrganizationCommunicationTemplate(
  env: AutomatedCommunicationEnv,
  organizationId: string,
  templateId: string,
): Promise<CommunicationTemplate> {
  const url = new URL("https://organization.internal/internal/communications/template");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("templateId", templateId);
  const response = await invokeOrganizationRpc(stub(env, organizationId), url);
  if (!response.ok) throw await failure(response);
  return communicationTemplateSchema.parse(await response.json());
}

export async function queueAutomatedOrganizationCommunication(
  env: AutomatedCommunicationEnv,
  context: ActorContext & { readonly organizationOrigin: string },
  input: {
    readonly contentMarkdown: string;
    readonly dedupeKey?: string;
    readonly eventId: string | null;
    readonly recipients: readonly AutomatedCommunicationRecipient[];
    readonly subject: string;
  },
): Promise<CommunicationMessage> {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const recipients = await Promise.all(
    input.recipients.map(async (recipient) => {
      const unsubscribeToken = recipient.email
        ? await issueSignedLink(env.SIGNED_LINK_SECRET, {
            algorithm: "HS256",
            expiresAt: issuedAt + 365 * 24 * 60 * 60,
            issuedAt,
            organizationId: context.organizationId,
            purpose: "unsubscribe",
            revocation: "email-v1",
            subjectId: recipient.profileId,
            version: 1,
          })
        : null;
      return {
        ...recipient,
        unsubscribeUrl:
          unsubscribeToken && recipient.email
            ? `${context.organizationOrigin}/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`
            : null,
      };
    }),
  );
  const response = await post(env, context.organizationId, "/internal/communications/manage", {
    action: "send",
    actorType: "organization_system",
    ...context,
    dedupeKey: input.dedupeKey,
    jobId: crypto.randomUUID(),
    message: {
      audience: {
        eventId: input.eventId,
        globalStatuses: ["Active"],
        profileIds: recipients.map(({ profileId }) => profileId),
        rsvp: "All",
        targetAudiences: ["Members"],
        voiceParts: [],
      },
      channel: "Email",
      contentMarkdown: input.contentMarkdown,
      subject: input.subject,
    },
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
  const response = await invokeOrganizationRpc(stub(env, organizationId), url);
  if (!response.ok) throw await failure(response);
  return communicationMessagesResponseSchema.omit({ requestId: true }).parse(await response.json())
    .messages;
}

export async function listOrganizationScheduledMessages(
  env: Env,
  organizationId: string,
): Promise<readonly CommunicationScheduledMessage[]> {
  const url = new URL("https://organization.internal/internal/communications/scheduled");
  url.searchParams.set("organizationId", organizationId);
  const response = await invokeOrganizationRpc(stub(env, organizationId), url);
  if (!response.ok) throw await failure(response);
  return communicationScheduledMessagesResponseSchema
    .omit({ requestId: true })
    .parse(await response.json()).messages;
}

export async function readCommunicationDeliverySummary(
  env: Env,
  organizationId: string,
  messageId: string,
): Promise<CommunicationDeliverySummary> {
  const url = new URL("https://organization.internal/internal/communications/summary");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("messageId", messageId);
  const response = await invokeOrganizationRpc(stub(env, organizationId), url);
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
  const response = await invokeOrganizationRpc(stub(env, organizationId), url);
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

export async function updateCommunicationTemplate(
  env: Env,
  context: ActorContext,
  templateId: string,
  template: CommunicationTemplateRequest,
): Promise<CommunicationTemplate> {
  const response = await post(env, context.organizationId, "/internal/communications/manage", {
    action: "update-template",
    ...context,
    template,
    templateId,
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

export async function unsubscribeOrganizationProfile(
  env: Env,
  organizationId: string,
  profileId: string,
  requestId: string,
): Promise<void> {
  await post(env, organizationId, "/internal/communications/unsubscribe", {
    organizationId,
    profileId,
    requestId,
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
  const response = await invokeOrganizationRpc(organizationStoreStub(env, organizationId), url);
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
  const response = await invokeOrganizationRpc(
    organizationStoreStub(env, input.organizationId),
    "https://organization.internal/internal/communications/manage",
    {
      body: JSON.stringify({ action: "delivery-result", ...input }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) throw new Error("The Organization store rejected communication results.");
}

export function parseCommunicationReach(value: unknown): CommunicationReach {
  return communicationReachSchema.parse(value);
}
