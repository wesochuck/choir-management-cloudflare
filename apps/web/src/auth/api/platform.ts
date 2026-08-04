import {
  organizationProviderStatusResponseSchema,
  organizationPaymentSettingsResponseSchema,
  organizationStripeConnectOnboardingResponseSchema,
  organizationStripeConnectStatusResponseSchema,
  organizationProvisionResponseSchema,
  platformContextResponseSchema,
  platformFleetSchemaStatusResponseSchema,
  platformJobDeadLettersResponseSchema,
  platformElevationRevocationResponseSchema,
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
  type PlatformFleetSchemaStatusResponse,
  type PlatformJobDeadLettersResponse,
  type PlatformOrganizationContextResponse,
  type PlatformOrganizationPublicDomainsResponse,
  type PublicDomainResponse,
  type PlatformOrganizationsResponse,
  type PlatformMfaStatusResponse,
} from "@choir/contracts";

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
  method: "recovery_code" | "totp",
  code: string,
): Promise<void> {
  await request("/api/platform/mfa/verify", {
    body: JSON.stringify({ code, method }),
    method: "POST",
  });
}

export async function getPlatformContext(): Promise<PlatformContextResponse> {
  const response = await request("/api/platform/context");
  return platformContextResponseSchema.parse(await response.json());
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
    `/api/platform/organizations/${encodeURIComponent(organizationId)}/public-domains/${encodeURIComponent(domainId)}`,
    { method: "DELETE" },
  );
  return publicDomainResponseSchema.parse(await response.json());
}

export async function listPlatformJobDeadLetters(
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<PlatformJobDeadLettersResponse> {
  const search = new URLSearchParams();
  if (cursor) {
    search.set("cursor", cursor);
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  const response = await request(`/api/platform/job-dead-letters${suffix}`, {
    signal: signal ?? null,
  });
  return platformJobDeadLettersResponseSchema.parse(await response.json());
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
