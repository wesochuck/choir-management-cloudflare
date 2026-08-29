import {
  organizationAuthStatusResponseSchema,
  organizationInvitationDetailsSchema,
  organizationInvitationActionResponseSchema,
  organizationInvitationResponseSchema,
  organizationInvitationsResponseSchema,
  organizationRosterConfigurationResponseSchema,
  organizationRosterAutomationPreviewResponseSchema,
  organizationSeatingChartSchema,
  organizationSeatingChartsResponseSchema,
  organizationSeatingChartOrderResponseSchema,
  seatingConfigurationResponseSchema,
  organizationMfaPolicyResponseSchema,
  organizationMfaVerificationResponseSchema,
  organizationBrandingSchema,
  transactionFeeSettingsResponseSchema,
  organizationExportStartResponseSchema,
  organizationExportStatusResponseSchema,
  type OrganizationBranding,
  type OrganizationBrandingRequest,
  type TransactionFeeSettings,
  type OrganizationAuthStatusResponse,
  type OrganizationInvitationDetails,
  type OrganizationInvitationActionResponse,
  type OrganizationInvitationRequest,
  type OrganizationInvitationResponse,
  type OrganizationInvitationsResponse,
  type OrganizationRosterConfiguration,
  type OrganizationRosterAutomationPreviewResponse,
  type OrganizationSeatingChart,
  type OrganizationSeatingChartRequest,
  type SeatingConfiguration,
  type OrganizationMfaPolicyResponse,
  type OrganizationMfaVerificationResponse,
  type OrganizationExportStartResponse,
  type OrganizationExportStatusResponse,
} from "@choir/contracts";

import { request } from "./client";

export async function getOrganizationTransactionFeeSettings(
  signal?: AbortSignal,
): Promise<TransactionFeeSettings> {
  const response = await request("/api/organization/transaction-fee-settings", {
    signal: signal ?? null,
  });
  return transactionFeeSettingsResponseSchema.parse(await response.json());
}

export async function updateOrganizationTransactionFeeSettings(
  settings: TransactionFeeSettings,
): Promise<TransactionFeeSettings> {
  const response = await request("/api/organization/transaction-fee-settings", {
    body: JSON.stringify(settings),
    method: "PUT",
  });
  return transactionFeeSettingsResponseSchema.parse(await response.json());
}

export async function getOrganizationRosterConfiguration(
  signal?: AbortSignal,
): Promise<OrganizationRosterConfiguration> {
  const response = await request("/api/organization/roster-configuration", {
    signal: signal ?? null,
  });
  const parsed = organizationRosterConfigurationResponseSchema.parse(await response.json());
  return {
    onBreakTimeoutDays: parsed.onBreakTimeoutDays,
    onBreakTimeoutEnabled: parsed.onBreakTimeoutEnabled,
    performerLabel: parsed.performerLabel,
    rsvpFollowUpEnabled: parsed.rsvpFollowUpEnabled,
    rsvpFollowUpLeadHours: parsed.rsvpFollowUpLeadHours,
    rsvpExpiryEnabled: parsed.rsvpExpiryEnabled,
    sections: parsed.sections,
    statusAutomationEnabled: parsed.statusAutomationEnabled,
    statusAutomationMissThreshold: parsed.statusAutomationMissThreshold,
    statusAutomationRecoveryEnabled: parsed.statusAutomationRecoveryEnabled,
    attendanceReportWarningThreshold: parsed.attendanceReportWarningThreshold,
    voiceParts: parsed.voiceParts,
  };
}

export async function updateOrganizationRosterConfiguration(
  configuration: OrganizationRosterConfiguration,
): Promise<OrganizationRosterConfiguration> {
  const response = await request("/api/organization/roster-configuration", {
    body: JSON.stringify(configuration),
    method: "PUT",
  });
  const parsed = organizationRosterConfigurationResponseSchema.parse(await response.json());
  return {
    onBreakTimeoutDays: parsed.onBreakTimeoutDays,
    onBreakTimeoutEnabled: parsed.onBreakTimeoutEnabled,
    performerLabel: parsed.performerLabel,
    rsvpFollowUpEnabled: parsed.rsvpFollowUpEnabled,
    rsvpFollowUpLeadHours: parsed.rsvpFollowUpLeadHours,
    rsvpExpiryEnabled: parsed.rsvpExpiryEnabled,
    sections: parsed.sections,
    statusAutomationEnabled: parsed.statusAutomationEnabled,
    statusAutomationMissThreshold: parsed.statusAutomationMissThreshold,
    statusAutomationRecoveryEnabled: parsed.statusAutomationRecoveryEnabled,
    attendanceReportWarningThreshold: parsed.attendanceReportWarningThreshold,
    voiceParts: parsed.voiceParts,
  };
}

export async function previewOrganizationRosterAutomation(
  configuration: OrganizationRosterConfiguration,
  profileId: string | null,
): Promise<OrganizationRosterAutomationPreviewResponse> {
  const response = await request("/api/organization/roster-configuration/preview", {
    body: JSON.stringify({ configuration, profileId }),
    method: "POST",
  });
  return organizationRosterAutomationPreviewResponseSchema.parse(await response.json());
}

export async function getOrganizationSeatingConfiguration(
  signal?: AbortSignal,
): Promise<SeatingConfiguration> {
  const response = await request("/api/organization/seating-configuration", {
    signal: signal ?? null,
  });
  return seatingConfigurationResponseSchema.parse(await response.json()).configuration;
}

export async function updateOrganizationSeatingConfiguration(
  configuration: SeatingConfiguration,
): Promise<SeatingConfiguration> {
  const response = await request("/api/organization/seating-configuration", {
    body: JSON.stringify(configuration),
    method: "PUT",
  });
  return seatingConfigurationResponseSchema.parse(await response.json()).configuration;
}

export async function listOrganizationSeatingCharts(
  eventId: string,
  signal?: AbortSignal,
): Promise<readonly OrganizationSeatingChart[]> {
  const response = await request(
    `/api/organization/events/${encodeURIComponent(eventId)}/seating-charts`,
    { signal: signal ?? null },
  );
  return organizationSeatingChartsResponseSchema.parse(await response.json()).charts;
}

export async function createOrganizationSeatingChart(
  eventId: string,
  chart: OrganizationSeatingChartRequest,
): Promise<OrganizationSeatingChart> {
  const response = await request(
    `/api/organization/events/${encodeURIComponent(eventId)}/seating-charts`,
    { body: JSON.stringify(chart), method: "POST" },
  );
  return organizationSeatingChartSchema.parse(await response.json());
}

export async function updateOrganizationSeatingChart(
  eventId: string,
  chartId: string,
  chart: OrganizationSeatingChartRequest,
): Promise<OrganizationSeatingChart> {
  const response = await request(
    `/api/organization/events/${encodeURIComponent(eventId)}/seating-charts/${encodeURIComponent(chartId)}`,
    { body: JSON.stringify(chart), method: "PUT" },
  );
  return organizationSeatingChartSchema.parse(await response.json());
}

export async function deleteOrganizationSeatingChart(
  eventId: string,
  chartId: string,
): Promise<void> {
  await request(
    `/api/organization/events/${encodeURIComponent(eventId)}/seating-charts/${encodeURIComponent(chartId)}`,
    { method: "DELETE" },
  );
}

export async function reorderOrganizationSeatingCharts(
  eventId: string,
  chartIds: readonly string[],
): Promise<readonly OrganizationSeatingChart[]> {
  const response = await request(
    `/api/organization/events/${encodeURIComponent(eventId)}/seating-charts/order`,
    { body: JSON.stringify({ chartIds }), method: "PUT" },
  );
  return organizationSeatingChartOrderResponseSchema.parse(await response.json()).charts;
}

export async function getOrganizationAuthStatus(
  signal?: AbortSignal,
): Promise<OrganizationAuthStatusResponse> {
  const response = await request("/api/organization/auth-status", { signal: signal ?? null });
  return organizationAuthStatusResponseSchema.parse(await response.json());
}

export async function setOrganizationMfaPolicy(
  mfaRequired: boolean,
): Promise<OrganizationMfaPolicyResponse> {
  const response = await request("/api/organization/auth-policy", {
    body: JSON.stringify({ mfaRequired }),
    method: "PATCH",
  });
  return organizationMfaPolicyResponseSchema.parse(await response.json());
}

export async function verifyOrganizationMfa(
  method: "recovery_code" | "totp",
  code: string,
): Promise<OrganizationMfaVerificationResponse> {
  const response = await request("/api/organization/mfa/verify", {
    body: JSON.stringify({ code, method }),
    method: "POST",
  });
  return organizationMfaVerificationResponseSchema.parse(await response.json());
}

export async function createOrganizationInvitation(
  invitation: OrganizationInvitationRequest,
): Promise<OrganizationInvitationResponse> {
  const response = await request("/api/organization/invitations", {
    body: JSON.stringify(invitation),
    method: "POST",
  });
  return organizationInvitationResponseSchema.parse(await response.json());
}

export async function getOrganizationInvitation(
  invitationId: string,
  signal?: AbortSignal,
): Promise<OrganizationInvitationDetails> {
  const response = await request(
    `/api/organization/invitations/${encodeURIComponent(invitationId)}`,
    { signal: signal ?? null },
  );
  return organizationInvitationDetailsSchema.parse(await response.json());
}

export async function acceptOrganizationInvitation(invitationId: string): Promise<void> {
  const response = await request(
    `/api/organization/invitations/${encodeURIComponent(invitationId)}/accept`,
    {
      method: "POST",
    },
  );
  organizationInvitationActionResponseSchema.parse(await response.json());
}

export async function rejectOrganizationInvitation(invitationId: string): Promise<void> {
  const response = await request(
    `/api/organization/invitations/${encodeURIComponent(invitationId)}/reject`,
    {
      method: "POST",
    },
  );
  organizationInvitationActionResponseSchema.parse(await response.json());
}

export async function listOrganizationInvitations(
  signal?: AbortSignal,
): Promise<OrganizationInvitationsResponse> {
  const response = await request("/api/organization/invitations", { signal: signal ?? null });
  return organizationInvitationsResponseSchema.parse(await response.json());
}

export async function cancelOrganizationInvitation(
  invitationId: string,
): Promise<OrganizationInvitationActionResponse> {
  const response = await request(
    `/api/organization/invitations/${encodeURIComponent(invitationId)}`,
    {
      method: "DELETE",
    },
  );
  return organizationInvitationActionResponseSchema.parse(await response.json());
}

export async function startOrganizationExport(): Promise<OrganizationExportStartResponse> {
  const response = await request("/api/organization/export", {
    body: JSON.stringify({ format: "json" }),
    method: "POST",
  });
  return organizationExportStartResponseSchema.parse(await response.json());
}

export async function getOrganizationExportStatus(
  exportId: string,
  signal?: AbortSignal,
): Promise<OrganizationExportStatusResponse> {
  const response = await request(`/api/organization/export/${encodeURIComponent(exportId)}`, {
    signal: signal ?? null,
  });
  return organizationExportStatusResponseSchema.parse(await response.json());
}

export async function getOrganizationBranding(signal?: AbortSignal): Promise<OrganizationBranding> {
  const response = await request("/api/organization/branding", {
    signal: signal ?? null,
  });
  return organizationBrandingSchema.parse(await response.json());
}

export async function updateOrganizationBranding(
  branding: OrganizationBrandingRequest,
): Promise<OrganizationBranding> {
  const response = await request("/api/organization/branding", {
    body: JSON.stringify(branding),
    method: "PUT",
  });
  return organizationBrandingSchema.parse(await response.json());
}
