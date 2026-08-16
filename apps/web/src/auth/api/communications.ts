import {
  communicationDeliverySummaryResponseSchema,
  communicationMessageResponseSchema,
  communicationMessagesResponseSchema,
  communicationReachResponseSchema,
  communicationRetryResponseSchema,
  communicationScheduledMessagesResponseSchema,
  communicationDeleteResponseSchema,
  communicationTemplateResponseSchema,
  communicationTemplatesResponseSchema,
  communicationTestEmailResponseSchema,
  communicationUnsubscribeResponseSchema,
  organizationProfileDeliveriesResponseSchema,
  type CommunicationDeliverySummary,
  type CommunicationDraftRequest,
  type CommunicationMessage,
  type CommunicationReach,
  type CommunicationScheduledMessage,
  type CommunicationSendRequest,
  type CommunicationTemplate,
  type CommunicationTemplateRequest,
  type CommunicationTestEmailRequest,
  type OrganizationProfileDeliveriesResponse,
} from "@choir/contracts";

import { request } from "./client";

export async function previewOrganizationCommunicationReach(
  communication: Pick<CommunicationSendRequest, "audience" | "channel">,
  signal?: AbortSignal,
): Promise<CommunicationReach> {
  const response = await request("/api/organization/communications/reach-preview", {
    body: JSON.stringify(communication),
    method: "POST",
    signal: signal ?? null,
  });
  return communicationReachResponseSchema.parse(await response.json());
}

export async function listOrganizationCommunications(
  signal?: AbortSignal,
): Promise<readonly CommunicationMessage[]> {
  const response = await request("/api/organization/communications", {
    signal: signal ?? null,
  });
  return communicationMessagesResponseSchema.parse(await response.json()).messages;
}

export async function listOrganizationScheduledMessages(
  signal?: AbortSignal,
): Promise<readonly CommunicationScheduledMessage[]> {
  const response = await request("/api/organization/communications/scheduled", {
    signal: signal ?? null,
  });
  return communicationScheduledMessagesResponseSchema.parse(await response.json()).messages;
}

export async function saveOrganizationCommunicationDraft(
  communication: CommunicationDraftRequest,
): Promise<CommunicationMessage> {
  const response = await request("/api/organization/communications/drafts", {
    body: JSON.stringify(communication),
    method: "POST",
  });
  return communicationMessageResponseSchema.parse(await response.json());
}

export async function sendOrganizationCommunication(
  communication: CommunicationSendRequest,
  idempotencyKey?: string,
): Promise<CommunicationMessage> {
  const response = await request("/api/organization/communications/send", {
    body: JSON.stringify(communication),
    ...(idempotencyKey ? { headers: { "idempotency-key": idempotencyKey } } : {}),
    method: "POST",
  });
  return communicationMessageResponseSchema.parse(await response.json());
}

export async function cancelOrganizationCommunication(
  messageId: string,
): Promise<CommunicationMessage> {
  const response = await request(
    `/api/organization/communications/${encodeURIComponent(messageId)}/cancel`,
    { method: "POST" },
  );
  return communicationMessageResponseSchema.parse(await response.json());
}

export async function sendOrganizationCommunicationTestEmail(
  message: CommunicationTestEmailRequest,
  idempotencyKey?: string,
): Promise<void> {
  const response = await request("/api/organization/communications/test-email", {
    body: JSON.stringify(message),
    ...(idempotencyKey ? { headers: { "idempotency-key": idempotencyKey } } : {}),
    method: "POST",
  });
  communicationTestEmailResponseSchema.parse(await response.json());
}

export async function getOrganizationCommunicationDeliverySummary(
  messageId: string,
  signal?: AbortSignal,
): Promise<CommunicationDeliverySummary> {
  const response = await request(
    `/api/organization/communications/${encodeURIComponent(messageId)}/delivery-summary`,
    { signal: signal ?? null },
  );
  return communicationDeliverySummaryResponseSchema.parse(await response.json());
}

export async function retryOrganizationCommunicationDeliveries(messageId: string): Promise<number> {
  const response = await request(
    `/api/organization/communications/${encodeURIComponent(messageId)}/retry-failed`,
    { method: "POST" },
  );
  return communicationRetryResponseSchema.parse(await response.json()).retried;
}

export async function deleteOrganizationCommunicationDraft(messageId: string): Promise<void> {
  const response = await request(
    `/api/organization/communications/drafts/${encodeURIComponent(messageId)}`,
    { method: "DELETE" },
  );
  communicationDeleteResponseSchema.parse(await response.json());
}

export async function listOrganizationCommunicationTemplates(
  signal?: AbortSignal,
): Promise<readonly CommunicationTemplate[]> {
  const response = await request("/api/organization/communications/templates", {
    signal: signal ?? null,
  });
  return communicationTemplatesResponseSchema.parse(await response.json()).templates;
}

export async function saveOrganizationCommunicationTemplate(
  template: CommunicationTemplateRequest,
): Promise<CommunicationTemplate> {
  const response = await request("/api/organization/communications/templates", {
    body: JSON.stringify(template),
    method: "POST",
  });
  return communicationTemplateResponseSchema.parse(await response.json());
}

export async function updateOrganizationCommunicationTemplate(
  templateId: string,
  template: CommunicationTemplateRequest,
): Promise<CommunicationTemplate> {
  const response = await request(
    `/api/organization/communications/templates/${encodeURIComponent(templateId)}`,
    { body: JSON.stringify(template), method: "PUT" },
  );
  return communicationTemplateResponseSchema.parse(await response.json());
}

export async function deleteOrganizationCommunicationTemplate(templateId: string): Promise<void> {
  const response = await request(
    `/api/organization/communications/templates/${encodeURIComponent(templateId)}`,
    { method: "DELETE" },
  );
  communicationDeleteResponseSchema.parse(await response.json());
}

export async function unsubscribeOrganizationEmail(token: string): Promise<void> {
  const response = await request("/api/public/unsubscribe", {
    body: JSON.stringify({ token }),
    method: "POST",
  });
  communicationUnsubscribeResponseSchema.parse(await response.json());
}

export async function getOrganizationProfileDeliveries(
  profileId: string,
  signal?: AbortSignal,
): Promise<OrganizationProfileDeliveriesResponse> {
  const response = await request(
    `/api/organization/profiles/${encodeURIComponent(profileId)}/deliveries`,
    { signal: signal ?? null },
  );
  return organizationProfileDeliveriesResponseSchema.parse(await response.json());
}
