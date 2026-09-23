import {
  communicationDeliverySummarySchema,
  communicationMessageSchema,
  communicationMessagesResponseSchema,
  communicationRecipientSubjectFromLegacy,
  communicationRecipientSubjectSchema,
  communicationScheduledMessagesResponseSchema,
  communicationTemplateSchema,
  communicationTemplatesResponseSchema,
  type CommunicationAudienceRequest,
  type CommunicationDeliverySummary,
  type CommunicationDraftRequest,
  type CommunicationMessage,
  type CommunicationReach,
  type CommunicationRecipientSubject,
  type CommunicationScheduledMessage,
  type CommunicationSendRequest,
  type CommunicationTemplate,
  type CommunicationTemplateRequest,
} from "@choir/contracts";
import {
  communicationReach,
  dedupeCommunicationCandidates,
  type CommunicationRecipientCandidate,
} from "@choir/domain";
import { z } from "zod";

import type { Env } from "../env";
import { issueSignedLink } from "../security/signedLinks";
import { listOrganizationProfileEmails } from "./profiles";
import {
  mutateOrganizationStore,
  readOrganizationStore,
  storeErrorCode,
  storeErrorStatus,
} from "./rpc/repository";

const candidateResponseSchema = z.object({
  recipients: z.array(
    z.object({
      displayName: z.string().min(1).max(200),
      doNotEmail: z.boolean(),
      email: z.string().max(320).nullable(),
      emailSuppressed: z.boolean(),
      emailUnsubscribed: z.boolean().default(false),
      phone: z.string().max(40).nullable().default(null),
      profileId: z.uuid(),
      providerBounced: z.boolean().default(false),
      smsSuppressed: z.boolean().default(false),
      smsUnsubscribed: z.boolean().default(false),
      subject: communicationRecipientSubjectSchema.optional(),
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
      subject: communicationRecipientSubjectSchema.optional(),
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

async function failure(response: Response): Promise<CommunicationRepositoryError> {
  return new CommunicationRepositoryError(
    await storeErrorCode(response, "communication_repository_error"),
    storeErrorStatus(response),
  );
}

async function post(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const response = await mutateOrganizationStore(env, organizationId, path, body);
  if (!response.ok) throw await failure(response);
  return response;
}

interface Recipient {
  readonly email: string;
  readonly name: string;
  readonly phone: string;
  readonly profileId: string;
  readonly subject: CommunicationRecipientSubject;
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
  // Each audience was built independently in the store. Merge by normalized
  // destination with suppression precedence: an active unsubscribe,
  // suppression, explicit unsubscribed status, or provider bounce from any
  // identity blocks that destination even when another audience selected it.
  // Member emails resolve from D1 identity data; contacts and commerce carry
  // their own delivery email. Precompute the lookup Map once (never .find in
  // a growing loop).
  const domainCandidates: CommunicationRecipientCandidate[] = candidates.map((candidate) => {
    const subject: CommunicationRecipientSubject =
      candidate.subject ?? communicationRecipientSubjectFromLegacy(candidate.profileId);
    const isMember = subject.kind === "profile" && emails.has(subject.profileId);
    return {
      displayName: candidate.displayName,
      doNotEmail: candidate.doNotEmail,
      email: candidate.email ?? (isMember ? (emails.get(subject.profileId) ?? null) : null),
      emailSuppressed: candidate.emailSuppressed,
      emailUnsubscribed: candidate.emailUnsubscribed,
      phone: candidate.phone,
      providerBounced: candidate.providerBounced,
      smsSuppressed: candidate.smsSuppressed,
      smsUnsubscribed: candidate.smsUnsubscribed,
      subjectId: subjectIdOf(subject),
      subjectKind: subject.kind,
    };
  });
  const resolved = dedupeCommunicationCandidates(domainCandidates);
  return Promise.all(
    resolved.map(async (recipient) => {
      const subject = subjectFromKindId(recipient.subjectKind, recipient.subjectId);
      // Phase 7 typed unsubscribe subject: profile and contact recipients
      // carry their kind in `resourceId` with the underlying ID in
      // `subjectId`. Legacy profile tokens omit `resourceId` and still verify
      // as profiles. Phase 9 resolves Ticket Buyer and Donor audiences to
      // contact subjects, so commerce recipients carry contact tokens too;
      // historical `ticket_purchase`/`donation` subjects never verify and are
      // never minted for new sends.
      const isMember = subject.kind === "profile" && emails.has(recipient.subjectId);
      const tokenable =
        recipient.email !== "" &&
        unsubscribeOrigin !== null &&
        (subject.kind === "contact" || (subject.kind === "profile" && isMember));
      const token = tokenable
        ? await issueSignedLink(env.SIGNED_LINK_SECRET, {
            algorithm: "HS256",
            expiresAt: issuedAt + 365 * 24 * 60 * 60,
            issuedAt,
            organizationId,
            purpose: "unsubscribe",
            resourceId: subject.kind,
            revocation: "email-v1",
            subjectId: recipient.subjectId,
            version: 1,
          })
        : null;
      return {
        email: recipient.email,
        name: recipient.displayName,
        phone: recipient.phone,
        profileId: recipient.subjectId,
        subject,
        unsubscribeUrl:
          token && unsubscribeOrigin
            ? `${unsubscribeOrigin}/unsubscribe?token=${encodeURIComponent(token)}`
            : null,
      };
    }),
  );
}

function subjectIdOf(subject: CommunicationRecipientSubject): string {
  switch (subject.kind) {
    case "profile":
      return subject.profileId;
    case "contact":
      return subject.contactId;
    case "ticket_purchase":
      return subject.purchaseId;
    case "donation":
      return subject.donationId;
  }
}

function subjectFromKindId(
  kind: CommunicationRecipientSubject["kind"],
  id: string,
): CommunicationRecipientSubject {
  switch (kind) {
    case "profile":
      return { kind, profileId: id };
    case "contact":
      return { kind, contactId: id };
    case "ticket_purchase":
      return { kind, purchaseId: id };
    case "donation":
      return { kind, donationId: id };
  }
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
  const response = await readOrganizationStore(
    env,
    organizationId,
    "/internal/communications/template",
    {
      templateId,
    },
  );
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
            resourceId: "profile",
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
  const response = await readOrganizationStore(env, organizationId, "/internal/communications");
  if (!response.ok) throw await failure(response);
  return communicationMessagesResponseSchema.omit({ requestId: true }).parse(await response.json())
    .messages;
}

export async function listOrganizationScheduledMessages(
  env: Env,
  organizationId: string,
): Promise<readonly CommunicationScheduledMessage[]> {
  const response = await readOrganizationStore(
    env,
    organizationId,
    "/internal/communications/scheduled",
  );
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
  const response = await readOrganizationStore(
    env,
    organizationId,
    "/internal/communications/summary",
    {
      messageId,
    },
  );
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
  const response = await readOrganizationStore(
    env,
    organizationId,
    "/internal/communications/templates",
  );
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

export async function resetCommunicationTemplateToSystemDefault(
  env: Env,
  context: ActorContext,
  templateId: string,
): Promise<CommunicationTemplate> {
  const response = await post(env, context.organizationId, "/internal/communications/manage", {
    action: "reset-template-to-system-default",
    ...context,
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

export async function unsubscribeOrganizationContact(
  env: Env,
  organizationId: string,
  contactId: string,
  requestId: string,
): Promise<void> {
  await post(env, organizationId, "/internal/communications/contact-unsubscribe", {
    contactId,
    organizationId,
    requestId,
  });
}

/**
 * Phase 7 typed unsubscribe subject.
 *
 * Tokens carry `subjectId` (the underlying profile or contact UUID) plus
 * `resourceId` (`"profile"` | `"contact"`). Tokens minted before Phase 7
 * omit `resourceId` and verify as profiles. Any other `resourceId`,
 * missing revocation, or non-UUID subject is rejected without touching
 * storage. Signature verification (constant-time) and org binding happen in
 * `verifySignedLinkScope`, so a modified ID or cross-org replay fails
 * closed.
 */
export function parseUnsubscribeSubject(envelope: {
  readonly resourceId?: string | undefined;
  readonly subjectId?: string | undefined;
}):
  | { readonly contactId: string; readonly kind: "contact" }
  | { readonly kind: "profile"; readonly profileId: string }
  | null {
  const subjectId = envelope.subjectId;
  if (typeof subjectId !== "string" || subjectId.length === 0) return null;
  const kind = envelope.resourceId;
  if (kind === undefined) return { kind: "profile", profileId: subjectId };
  if (kind === "profile") return { kind: "profile", profileId: subjectId };
  if (kind === "contact") return { contactId: subjectId, kind: "contact" };
  return null;
}

export async function readCommunicationDeliveryJob(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
  jobId: string,
) {
  const response = await readOrganizationStore(
    env,
    organizationId,
    "/internal/communications/job",
    {
      jobId,
    },
  );
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
  const response = await mutateOrganizationStore(
    env,
    input.organizationId,
    "/internal/communications/manage",
    { action: "delivery-result", ...input },
  );
  if (!response.ok) throw new Error("The Organization store rejected communication results.");
}
