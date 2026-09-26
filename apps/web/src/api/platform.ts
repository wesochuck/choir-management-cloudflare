import {
  organizationProviderStatusResponseSchema,
  organizationPaymentSettingsResponseSchema,
  organizationStripeConnectOnboardingResponseSchema,
  organizationStripeConnectStatusResponseSchema,
  organizationProvisionResponseSchema,
  platformContextResponseSchema,
  platformFleetSchemaStatusResponseSchema,
  platformJobDeadLetterActionRequestSchema,
  platformJobDeadLetterActionResponseSchema,
  platformJobDeadLettersResponseSchema,
  platformElevationRevocationResponseSchema,
  platformEmailSuppressionReleaseRequestSchema,
  platformEmailSuppressionReleaseResponseSchema,
  platformEmailFeedbackActionRequestSchema,
  platformEmailFeedbackActionResponseSchema,
  platformEmailFeedbackDeadLettersResponseSchema,
  platformEmailFeedbackViewSchema,
  platformEmailProviderEventsResponseSchema,
  platformLocalEmailSuppressionReleaseRequestSchema,
  platformLocalEmailSuppressionReleaseResponseSchema,
  platformMfaStatusResponseSchema,
  platformOrganizationContextResponseSchema,
  platformOrganizationPublicDomainsResponseSchema,
  platformOrganizationsResponseSchema,
  publicDomainRegistrationRequestSchema,
  publicDomainResponseSchema,
  type OrganizationProviderStatusResponse,
  type OrganizationPaymentSettingsResponse,
  type OrganizationStripeConnectOnboardingResponse,
  type OrganizationStripeConnectStatusResponse,
  type OrganizationProvisionRequest,
  type OrganizationProvisionResponse,
  type PlatformContextResponse,
  type PlatformEmailSuppressionsResponse,
  type PlatformEmailSuppressionReleaseResponse,
  type PlatformEmailFeedbackActionResponse,
  type PlatformEmailFeedbackDeadLettersResponse,
  type PlatformEmailFeedbackView,
  type PlatformEmailProviderEventsResponse,
  type PlatformLocalEmailSuppressionReleaseResponse,
  type PlatformFleetSchemaStatusResponse,
  type PlatformJobDeadLettersResponse,
  type PlatformJobDeadLetterActionResponse,
  type PlatformJobDeadLetterView,
  type PlatformOrganizationContextResponse,
  type PlatformOrganizationPublicDomainsResponse,
  type PublicDomainResponse,
  type PlatformOrganizationsResponse,
  type PlatformMfaStatusResponse,
  platformEmailSuppressionsResponseSchema,
  platformStripeConnectStatusResponseSchema,
  platformStripeConnectResetResponseSchema,
  type PlatformStripeConnectStatusResponse,
  type PlatformStripeConnectResetRequest,
  type PlatformStripeConnectResetResponse,
  platformStripeReconciliationPreviewResponseSchema,
  platformStripeReconciliationApplyResponseSchema,
  type PlatformStripeReconciliationPreviewRequest,
  type PlatformStripeReconciliationPreviewResponse,
  type PlatformStripeReconciliationApplyRequest,
  type PlatformStripeReconciliationApplyResponse,
} from "@choir/contracts";
import { z } from "zod";

import { request } from "./client";

export async function getPlatformMfaStatus(
  signal?: AbortSignal,
): Promise<PlatformMfaStatusResponse> {
  const response = await request("/api/platform/mfa/status", { signal: signal ?? null });
  return platformMfaStatusResponseSchema.parse(await response.json());
}

export async function getOrganizationProviderStatus(
  signal?: AbortSignal,
): Promise<OrganizationProviderStatusResponse> {
  const response = await request("/api/organization/provider-status", {
    signal: signal ?? null,
  });
  return organizationProviderStatusResponseSchema.parse(await response.json());
}

export async function getOrganizationPaymentSettings(
  signal?: AbortSignal,
): Promise<OrganizationPaymentSettingsResponse> {
  const response = await request("/api/organization/payment-settings", {
    signal: signal ?? null,
  });
  return organizationPaymentSettingsResponseSchema.parse(await response.json());
}

export async function updateOrganizationPaymentActivation(
  moduleId: "tickets" | "donations" | "dues",
  enabled: boolean,
): Promise<OrganizationPaymentSettingsResponse["activations"]> {
  const response = await request("/api/organization/payment-settings/activation", {
    body: JSON.stringify({ confirm: true, enabled, moduleId }),
    method: "POST",
  });
  const value: unknown = await response.json();
  return organizationPaymentSettingsResponseSchema.shape.activations.parse(
    typeof value === "object" && value !== null && "activations" in value
      ? value.activations
      : value,
  );
}

export async function getOrganizationStripeConnectStatus(
  signal?: AbortSignal,
): Promise<OrganizationStripeConnectStatusResponse> {
  const response = await request("/api/organization/stripe-connect", {
    signal: signal ?? null,
  });
  return organizationStripeConnectStatusResponseSchema.parse(await response.json());
}

export async function startOrganizationStripeConnectOnboarding(): Promise<OrganizationStripeConnectOnboardingResponse> {
  const response = await request("/api/organization/stripe-connect/onboard", { method: "POST" });
  return organizationStripeConnectOnboardingResponseSchema.parse(await response.json());
}

export async function confirmPlatformMfaEnrollment(): Promise<void> {
  await request("/api/platform/mfa/confirm-enrollment", {
    body: JSON.stringify({}),
    method: "POST",
  });
}

export async function verifyPlatformMfa(
  method: "passkey" | "recovery_code" | "totp",
  code?: string,
): Promise<void> {
  await request("/api/platform/mfa/verify", {
    body: JSON.stringify(method === "passkey" ? { method } : { code, method }),
    method: "POST",
  });
}

export async function getPlatformContext(): Promise<PlatformContextResponse> {
  const response = await request("/api/platform/context");
  return platformContextResponseSchema.parse(await response.json());
}

export async function listPlatformEmailSuppressions(
  options: {
    readonly cursor?: string | null;
    readonly query?: string;
    readonly status?: "active" | "all";
    readonly signal?: AbortSignal;
  } = {},
): Promise<PlatformEmailSuppressionsResponse> {
  const search = new URLSearchParams();
  if (options.cursor) search.set("cursor", options.cursor);
  if (options.query?.trim()) search.set("q", options.query.trim());
  search.set("status", options.status ?? "active");
  const response = await request(`/api/platform/email-suppressions?${search.toString()}`, {
    signal: options.signal ?? null,
  });
  return platformEmailSuppressionsResponseSchema.parse(await response.json());
}

export async function releasePlatformEmailSuppression(
  email: string,
  reason: string,
): Promise<PlatformEmailSuppressionReleaseResponse> {
  const response = await request("/api/platform/email-suppressions/release", {
    body: JSON.stringify(platformEmailSuppressionReleaseRequestSchema.parse({ email, reason })),
    method: "POST",
  });
  return platformEmailSuppressionReleaseResponseSchema.parse(await response.json());
}

export async function releaseLocalPlatformEmailSuppression(input: {
  readonly email: string;
  readonly organizationId: string;
  readonly profileId: string;
  readonly reason: string;
}): Promise<PlatformLocalEmailSuppressionReleaseResponse> {
  const response = await request("/api/platform/email-suppressions/release-local", {
    body: JSON.stringify(platformLocalEmailSuppressionReleaseRequestSchema.parse(input)),
    method: "POST",
  });
  return platformLocalEmailSuppressionReleaseResponseSchema.parse(await response.json());
}

export async function listPlatformEmailProviderEvents(
  cursor: string | null = null,
  signal?: AbortSignal,
  view: PlatformEmailFeedbackView = "open",
): Promise<PlatformEmailProviderEventsResponse> {
  const search = new URLSearchParams({ view: platformEmailFeedbackViewSchema.parse(view) });
  if (cursor) search.set("cursor", cursor);
  const response = await request(`/api/platform/email-feedback/events?${search.toString()}`, {
    signal: signal ?? null,
  });
  return platformEmailProviderEventsResponseSchema.parse(await response.json());
}

export async function retryPlatformEmailProviderEvent(
  eventId: string,
  reason: string,
): Promise<PlatformEmailFeedbackActionResponse> {
  const response = await request(
    `/api/platform/email-feedback/events/${encodeURIComponent(eventId)}/retry`,
    {
      body: JSON.stringify(platformEmailFeedbackActionRequestSchema.parse({ reason })),
      method: "POST",
    },
  );
  return platformEmailFeedbackActionResponseSchema.parse(await response.json());
}

export async function acknowledgePlatformEmailProviderEvent(
  eventId: string,
  reason: string,
): Promise<PlatformEmailFeedbackActionResponse> {
  const response = await request(
    `/api/platform/email-feedback/events/${encodeURIComponent(eventId)}/acknowledge`,
    {
      body: JSON.stringify(platformEmailFeedbackActionRequestSchema.parse({ reason })),
      method: "POST",
    },
  );
  return platformEmailFeedbackActionResponseSchema.parse(await response.json());
}

export async function listPlatformEmailFeedbackDeadLetters(
  cursor: string | null = null,
  signal?: AbortSignal,
  view: PlatformEmailFeedbackView = "open",
): Promise<PlatformEmailFeedbackDeadLettersResponse> {
  const search = new URLSearchParams({ view: platformEmailFeedbackViewSchema.parse(view) });
  if (cursor) search.set("cursor", cursor);
  const response = await request(`/api/platform/email-feedback/dead-letters?${search.toString()}`, {
    signal: signal ?? null,
  });
  return platformEmailFeedbackDeadLettersResponseSchema.parse(await response.json());
}

export async function retryPlatformEmailFeedbackDeadLetter(
  deadLetterId: string,
  reason: string,
): Promise<PlatformEmailFeedbackActionResponse> {
  const response = await request(
    `/api/platform/email-feedback/dead-letters/${encodeURIComponent(deadLetterId)}/retry`,
    {
      body: JSON.stringify(platformEmailFeedbackActionRequestSchema.parse({ reason })),
      method: "POST",
    },
  );
  return platformEmailFeedbackActionResponseSchema.parse(await response.json());
}

export async function acknowledgePlatformEmailFeedbackDeadLetter(
  deadLetterId: string,
  reason: string,
): Promise<PlatformEmailFeedbackActionResponse> {
  const response = await request(
    `/api/platform/email-feedback/dead-letters/${encodeURIComponent(deadLetterId)}/acknowledge`,
    {
      body: JSON.stringify(platformEmailFeedbackActionRequestSchema.parse({ reason })),
      method: "POST",
    },
  );
  return platformEmailFeedbackActionResponseSchema.parse(await response.json());
}

export async function listPlatformOrganizations(
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<PlatformOrganizationsResponse> {
  const search = new URLSearchParams();
  if (cursor) {
    search.set("cursor", cursor);
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  const response = await request(`/api/platform/organizations${suffix}`, {
    signal: signal ?? null,
  });
  return platformOrganizationsResponseSchema.parse(await response.json());
}

export async function listPlatformOrganizationPublicDomains(
  organizationId: string,
  signal?: AbortSignal,
): Promise<PlatformOrganizationPublicDomainsResponse> {
  const response = await request(
    `/api/platform/organizations/${encodeURIComponent(organizationId)}/public-domains`,
    { signal: signal ?? null },
  );
  return platformOrganizationPublicDomainsResponseSchema.parse(await response.json());
}

export async function registerPlatformOrganizationPublicDomain(
  organizationId: string,
  hostname: string,
): Promise<PublicDomainResponse> {
  const response = await request(
    `/api/platform/organizations/${encodeURIComponent(organizationId)}/public-domains`,
    {
      body: JSON.stringify(publicDomainRegistrationRequestSchema.parse({ hostname })),
      method: "POST",
    },
  );
  return publicDomainResponseSchema.parse(await response.json());
}

export async function disablePlatformOrganizationPublicDomain(
  organizationId: string,
  domainId: string,
): Promise<PublicDomainResponse> {
  const response = await request(
    `/api/platform/organizations/${encodeURIComponent(organizationId)}/public-domains/${encodeURIComponent(domainId)}?action=disable`,
    { method: "DELETE" },
  );
  return publicDomainResponseSchema.parse(await response.json());
}

const removePlatformDomainResponseSchema = z.object({
  domainId: z.string(),
  ok: z.boolean(),
});

export async function removePlatformOrganizationPublicDomain(
  organizationId: string,
  domainId: string,
): Promise<{ readonly domainId: string; readonly ok: boolean }> {
  const response = await request(
    `/api/platform/organizations/${encodeURIComponent(organizationId)}/public-domains/${encodeURIComponent(domainId)}?action=remove`,
    { method: "DELETE" },
  );
  return removePlatformDomainResponseSchema.parse(await response.json());
}

export async function listPlatformJobDeadLetters(
  cursor: string | null = null,
  signal?: AbortSignal,
  view: PlatformJobDeadLetterView = "open",
): Promise<PlatformJobDeadLettersResponse> {
  const search = new URLSearchParams();
  if (cursor) {
    search.set("cursor", cursor);
  }
  search.set("view", view);
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  const response = await request(`/api/platform/job-dead-letters${suffix}`, {
    signal: signal ?? null,
  });
  return platformJobDeadLettersResponseSchema.parse(await response.json());
}

export async function retryPlatformJobDeadLetter(
  deadLetterId: string,
  reason: string,
): Promise<PlatformJobDeadLetterActionResponse> {
  const response = await request(
    `/api/platform/job-dead-letters/${encodeURIComponent(deadLetterId)}/retry`,
    {
      body: JSON.stringify(platformJobDeadLetterActionRequestSchema.parse({ reason })),
      method: "POST",
    },
  );
  return platformJobDeadLetterActionResponseSchema.parse(await response.json());
}

export async function dismissPlatformJobDeadLetter(
  deadLetterId: string,
  reason: string,
): Promise<PlatformJobDeadLetterActionResponse> {
  const response = await request(
    `/api/platform/job-dead-letters/${encodeURIComponent(deadLetterId)}/dismiss`,
    {
      body: JSON.stringify(platformJobDeadLetterActionRequestSchema.parse({ reason })),
      method: "POST",
    },
  );
  return platformJobDeadLetterActionResponseSchema.parse(await response.json());
}

export async function getPlatformFleetSchemaStatus(
  signal?: AbortSignal,
): Promise<PlatformFleetSchemaStatusResponse> {
  const response = await request("/api/platform/fleet-schema-preparation", {
    signal: signal ?? null,
  });
  return platformFleetSchemaStatusResponseSchema.parse(await response.json());
}

export async function startPlatformFleetSchemaPreparation(): Promise<PlatformFleetSchemaStatusResponse> {
  const response = await request("/api/platform/fleet-schema-preparation", {
    body: JSON.stringify({}),
    method: "POST",
  });
  return platformFleetSchemaStatusResponseSchema.parse(await response.json());
}

export async function provisionOrganization(
  organization: OrganizationProvisionRequest,
): Promise<OrganizationProvisionResponse> {
  const response = await request("/api/platform/organizations", {
    body: JSON.stringify(organization),
    method: "POST",
  });
  return organizationProvisionResponseSchema.parse(await response.json());
}

export async function getPlatformOrganizationContext(
  signal?: AbortSignal,
): Promise<PlatformOrganizationContextResponse> {
  const response = await request("/api/platform/organization-context", {
    signal: signal ?? null,
  });
  return platformOrganizationContextResponseSchema.parse(await response.json());
}

export async function createPlatformElevation(
  reason: string,
): Promise<PlatformOrganizationContextResponse> {
  const response = await request("/api/platform/elevations", {
    body: JSON.stringify({ reason }),
    method: "POST",
  });
  return platformOrganizationContextResponseSchema.parse(await response.json());
}

export async function revokePlatformElevation(elevationId: string): Promise<void> {
  const response = await request(`/api/platform/elevations/${encodeURIComponent(elevationId)}`, {
    method: "DELETE",
  });
  platformElevationRevocationResponseSchema.parse(await response.json());
}

export async function getPlatformOrganizationStripeConnect(
  organizationId: string,
  signal?: AbortSignal,
): Promise<PlatformStripeConnectStatusResponse> {
  const response = await request(
    `/api/platform/organizations/${encodeURIComponent(organizationId)}/stripe-connect`,
    {
      signal: signal ?? null,
    },
  );
  return platformStripeConnectStatusResponseSchema.parse(await response.json());
}

export async function resetPlatformOrganizationStripeConnect(
  organizationId: string,
  payload: PlatformStripeConnectResetRequest,
): Promise<PlatformStripeConnectResetResponse> {
  const response = await request(
    `/api/platform/organizations/${encodeURIComponent(organizationId)}/stripe-connect/reset`,
    {
      body: JSON.stringify(payload),
      method: "POST",
    },
  );
  return platformStripeConnectResetResponseSchema.parse(await response.json());
}

export async function previewPlatformStripeReconciliation(
  organizationId: string,
  payload?: PlatformStripeReconciliationPreviewRequest,
  signal?: AbortSignal,
): Promise<PlatformStripeReconciliationPreviewResponse> {
  const response = await request(
    `/api/platform/organizations/${encodeURIComponent(organizationId)}/stripe-reconciliation/preview`,
    {
      body: JSON.stringify(payload ?? {}),
      method: "POST",
      signal: signal ?? null,
    },
  );
  return platformStripeReconciliationPreviewResponseSchema.parse(await response.json());
}

export async function applyPlatformStripeReconciliation(
  organizationId: string,
  payload: PlatformStripeReconciliationApplyRequest,
): Promise<PlatformStripeReconciliationApplyResponse> {
  const response = await request(
    `/api/platform/organizations/${encodeURIComponent(organizationId)}/stripe-reconciliation/apply`,
    {
      body: JSON.stringify(payload),
      method: "POST",
    },
  );
  return platformStripeReconciliationApplyResponseSchema.parse(await response.json());
}
