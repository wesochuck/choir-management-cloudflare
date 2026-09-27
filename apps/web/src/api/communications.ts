import {
  communicationDeliveryRecipientsPageResponseSchema,
  communicationDeliverySummaryResponseSchema,
  communicationHistoryPageResponseSchema,
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
  organizationEmailDomainVerifyResponseSchema,
  organizationEmailSettingsResponseSchema,
  organizationProfileDeliveriesResponseSchema,
  type CommunicationDeliveryRecipientsPageResponse,
  type CommunicationDeliverySummary,
  type CommunicationDraftRequest,
  type CommunicationHistoryPageResponse,
  type CommunicationMessage,
  type CommunicationReach,
  type CommunicationScheduledMessage,
  type CommunicationSendRequest,
  type CommunicationTemplate,
  type CommunicationTemplateRequest,
  type CommunicationTestEmailRequest,
  type OrganizationEmailDomainVerifyResponse,
  type OrganizationEmailSettings,
  type OrganizationEmailSettingsUpdateRequest,
  type OrganizationProfileDeliveriesResponse,
} from "@choir/contracts";

import { request } from "./client";

export async function getOrganizationCommunicationHistory(
  options?: {
    cursor?: string | null;
    limit?: number;
    origin?: string | null;
    status?: string | null;
  },
  signal?: AbortSignal,
): Promise<CommunicationHistoryPageResponse> {
  const params = new URLSearchParams();
  if (options?.cursor) params.set("cursor", options.cursor);
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.origin && options.origin !== "all") params.set("origin", options.origin);
  if (options?.status && options.status !== "all") params.set("status", options.status);
  const path = `/api/organization/communications/history${params.toString() ? `?${params.toString()}` : ""}`;
  const response = await request(path, { signal: signal ?? null });
  return communicationHistoryPageResponseSchema.parse(await response.json());
}

export async function getOrganizationCommunicationRecipients(
  messageId: string,
  options?: {
    cursor?: string | null;
    limit?: number;
  },
  signal?: AbortSignal,
): Promise<CommunicationDeliveryRecipientsPageResponse> {
  const params = new URLSearchParams();
  if (options?.cursor) params.set("cursor", options.cursor);
  if (options?.limit) params.set("limit", String(options.limit));
  const path = `/api/organization/communications/${encodeURIComponent(messageId)}/recipients${params.toString() ? `?${params.toString()}` : ""}`;
  const response = await request(path, { signal: signal ?? null });
  return communicationDeliveryRecipientsPageResponseSchema.parse(await response.json());
}

export async function getOrganizationCommunicationTemplatesPage(
  options?: {
    cursor?: string | null;
    limit?: number;
  },
  signal?: AbortSignal,
): Promise<{
  readonly nextCursor: string | null;
  readonly templates: readonly CommunicationTemplate[];
}> {
  const params = new URLSearchParams();
  if (options?.cursor) params.set("cursor", options.cursor);
  if (options?.limit) params.set("limit", String(options.limit));
  const path = `/api/organization/communications/templates${params.toString() ? `?${params.toString()}` : ""}`;
  const response = await request(path, { signal: signal ?? null });
  const parsed = communicationTemplatesResponseSchema.parse(await response.json());
  return { nextCursor: parsed.nextCursor ?? null, templates: parsed.templates };
}

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

export async function resetOrganizationCommunicationTemplateToSystemDefault(
  templateId: string,
): Promise<CommunicationTemplate> {
  const response = await request(
    `/api/organization/communications/templates/${encodeURIComponent(templateId)}/reset-system-default`,
    { method: "POST" },
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

export async function getOrganizationEmailSettings(
  signal?: AbortSignal,
): Promise<OrganizationEmailSettings> {
  const response = await request("/api/organization/email-settings", {
    signal: signal ?? null,
  });
  return organizationEmailSettingsResponseSchema.parse(await response.json()).settings;
}

export async function updateOrganizationEmailSettings(
  update: OrganizationEmailSettingsUpdateRequest,
): Promise<OrganizationEmailSettings> {
  const response = await request("/api/organization/email-settings", {
    body: JSON.stringify(update),
    method: "PUT",
  });
  return organizationEmailSettingsResponseSchema.parse(await response.json()).settings;
}

export async function verifyOrganizationEmailDomain(): Promise<OrganizationEmailDomainVerifyResponse> {
  const response = await request("/api/organization/email-settings/verify", {
    method: "POST",
  });
  return organizationEmailDomainVerifyResponseSchema.parse(await response.json());
}
