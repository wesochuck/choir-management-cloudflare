import {
  memberProfileResponseSchema,
  organizationMusicPieceDeleteResponseSchema,
  organizationMusicImportResponseSchema,
  organizationMusicPieceResponseSchema,
  organizationMusicPiecesResponseSchema,
  organizationDirectoryResponseSchema,
  organizationAttendanceResponseSchema,
  accountOrganizationsResponseSchema,
  calendarFeedUrlsResponseSchema,
  accountSecurityResponseSchema,
  authSessionListSchema,
  currentAuthSessionSchema,
  organizationAuthStatusResponseSchema,
  organizationInvitationDetailsSchema,
  organizationInvitationActionResponseSchema,
  organizationInvitationResponseSchema,
  organizationInvitationsResponseSchema,
  organizationEventSchema,
  organizationEventArchiveResponseSchema,
  organizationEventsResponseSchema,
  organizationCalendarSettingsResponseSchema,
  organizationRosterConfigurationResponseSchema,
  organizationSeatingChartSchema,
  organizationSeatingChartsResponseSchema,
  seatingConfigurationResponseSchema,
  singerSeatingResponseSchema,
  organizationMfaPolicyResponseSchema,
  organizationMfaVerificationResponseSchema,
  organizationProfileResponseSchema,
  organizationProfilesResponseSchema,
  organizationRsvpSchema,
  organizationVenueSchema,
  organizationVenueDeleteResponseSchema,
  organizationVenuesResponseSchema,
  singerEventsResponseSchema,
  organizationProvisionResponseSchema,
  platformContextResponseSchema,
  platformFleetSchemaStatusResponseSchema,
  platformJobDeadLettersResponseSchema,
  platformElevationRevocationResponseSchema,
  platformMfaEnrollmentResponseSchema,
  platformMfaStatusResponseSchema,
  platformOrganizationContextResponseSchema,
  platformOrganizationsResponseSchema,
  privateFileResponseSchema,
  platformRecoveryCodesResponseSchema,
  problemDetailsSchema,
  type AccountOrganization,
  type AccountPasswordRequest,
  type AccountSecurityResponse,
  type AuthSession,
  type CalendarFeedUrlsResponse,
  type CurrentAuthSession,
  type MemberProfile,
  type MemberProfileUpdateRequest,
  type OrganizationMusicPiece,
  type OrganizationMusicPieceRequest,
  type OrganizationDirectoryProfile,
  type OrganizationAuthStatusResponse,
  type OrganizationAttendanceRow,
  type OrganizationAttendanceUpdate,
  type OrganizationInvitationDetails,
  type OrganizationInvitationActionResponse,
  type OrganizationInvitationRequest,
  type OrganizationInvitationResponse,
  type OrganizationInvitationsResponse,
  type OrganizationEvent,
  type OrganizationEventRequest,
  type OrganizationCalendarSettings,
  type OrganizationRosterConfiguration,
  type OrganizationSeatingChart,
  type OrganizationSeatingChartRequest,
  type SeatingConfiguration,
  type SingerSeatingResponse,
  type OrganizationMfaPolicyResponse,
  type OrganizationMfaVerificationResponse,
  type OrganizationProfile,
  type OrganizationProfileRequest,
  type OrganizationRsvp,
  type OrganizationVenue,
  type SingerEventsResponse,
  type OrganizationProvisionRequest,
  type OrganizationProvisionResponse,
  type PlatformContextResponse,
  type PlatformFleetSchemaStatusResponse,
  type PlatformJobDeadLettersResponse,
  type PlatformOrganizationContextResponse,
  type PrivateFileResponse,
  type PlatformOrganizationsResponse,
  type PlatformMfaEnrollmentResponse,
  type PlatformMfaStatusResponse,
} from "@choir/contracts";

export class AuthApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
  }
}

async function responseError(response: Response): Promise<AuthApiError> {
  const body: unknown = await response.json().catch(() => null);
  const problem = problemDetailsSchema.safeParse(body);
  return new AuthApiError(
    problem.success ? problem.data.message : "The account service could not complete the request.",
    response.status,
  );
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
  });
  if (!response.ok) {
    throw await responseError(response);
  }
  return response;
}

export async function getCurrentSession(signal?: AbortSignal): Promise<CurrentAuthSession> {
  const response = await request("/api/auth/get-session", { signal: signal ?? null });
  return currentAuthSessionSchema.parse(await response.json());
}

export async function requestSignInCode(email: string): Promise<void> {
  await request("/api/auth/email-otp/send-verification-otp", {
    body: JSON.stringify({ email, type: "sign-in" }),
    method: "POST",
  });
}

export async function signInWithCode(email: string, otp: string): Promise<void> {
  await request("/api/auth/sign-in/email-otp", {
    body: JSON.stringify({ email, otp }),
    method: "POST",
  });
}

export type PasswordSignInResult = "signed_in" | "two_factor_required";

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<PasswordSignInResult> {
  const response = await request("/api/auth/sign-in/email", {
    body: JSON.stringify({ email, password }),
    method: "POST",
  });
  const body: unknown = await response.json();
  return typeof body === "object" &&
    body !== null &&
    "twoFactorRedirect" in body &&
    body.twoFactorRedirect === true
    ? "two_factor_required"
    : "signed_in";
}

export async function verifyPasswordSignInSecondFactor(
  method: "recovery_code" | "totp",
  code: string,
): Promise<void> {
  const path =
    method === "totp"
      ? "/api/auth/two-factor/verify-totp"
      : "/api/auth/two-factor/verify-backup-code";
  await request(path, {
    body: JSON.stringify({ code, trustDevice: false }),
    method: "POST",
  });
}

export async function requestPasswordReset(email: string): Promise<void> {
  await request("/api/auth/request-password-reset", {
    body: JSON.stringify({ email }),
    method: "POST",
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await request("/api/auth/reset-password", {
    body: JSON.stringify({ newPassword, token }),
    method: "POST",
  });
}

export async function signOut(): Promise<void> {
  await request("/api/auth/sign-out", { method: "POST" });
}

export async function listActiveSessions(signal?: AbortSignal): Promise<readonly AuthSession[]> {
  const response = await request("/api/auth/list-sessions", { signal: signal ?? null });
  return authSessionListSchema.parse(await response.json());
}

export async function revokeSession(token: string): Promise<void> {
  await request("/api/auth/revoke-session", {
    body: JSON.stringify({ token }),
    method: "POST",
  });
}

export async function listAccountOrganizations(
  signal?: AbortSignal,
): Promise<readonly AccountOrganization[]> {
  const response = await request("/api/account/organizations", { signal: signal ?? null });
  return accountOrganizationsResponseSchema.parse(await response.json()).organizations;
}

export async function getAccountSecurity(signal?: AbortSignal): Promise<AccountSecurityResponse> {
  const response = await request("/api/account/security", { signal: signal ?? null });
  return accountSecurityResponseSchema.parse(await response.json());
}

export async function getCalendarFeedUrls(signal?: AbortSignal): Promise<CalendarFeedUrlsResponse> {
  const response = await request("/api/singer/calendar-feed-url", { signal: signal ?? null });
  return calendarFeedUrlsResponseSchema.parse(await response.json());
}

export async function resetCalendarFeedUrls(): Promise<CalendarFeedUrlsResponse> {
  const response = await request("/api/singer/calendar-feed-url/reset", {
    body: JSON.stringify({}),
    method: "POST",
  });
  return calendarFeedUrlsResponseSchema.parse(await response.json());
}

export async function listOrganizationProfiles(
  signal?: AbortSignal,
): Promise<readonly OrganizationProfile[]> {
  const response = await request("/api/organization/profiles", { signal: signal ?? null });
  return organizationProfilesResponseSchema.parse(await response.json()).profiles;
}

export async function createOrganizationProfile(
  profile: OrganizationProfileRequest,
): Promise<OrganizationProfile> {
  const response = await request("/api/organization/profiles", {
    body: JSON.stringify(profile),
    method: "POST",
  });
  return organizationProfileResponseSchema.parse(await response.json());
}

export async function updateOrganizationProfile(
  profileId: string,
  profile: OrganizationProfileRequest,
): Promise<OrganizationProfile> {
  const response = await request(`/api/organization/profiles/${encodeURIComponent(profileId)}`, {
    body: JSON.stringify(profile),
    method: "PUT",
  });
  return organizationProfileResponseSchema.parse(await response.json());
}

export async function getMemberProfile(signal?: AbortSignal): Promise<MemberProfile> {
  const response = await request("/api/singer/profile", { signal: signal ?? null });
  return memberProfileResponseSchema.parse(await response.json());
}

export async function updateMemberProfile(
  profile: MemberProfileUpdateRequest,
): Promise<MemberProfile> {
  const response = await request("/api/singer/profile", {
    body: JSON.stringify(profile),
    method: "PUT",
  });
  return memberProfileResponseSchema.parse(await response.json());
}

export async function listOrganizationDirectory(
  signal?: AbortSignal,
): Promise<readonly OrganizationDirectoryProfile[]> {
  const response = await request("/api/singer/directory", { signal: signal ?? null });
  return organizationDirectoryResponseSchema.parse(await response.json()).profiles;
}

export async function listOrganizationMusic(
  signal?: AbortSignal,
): Promise<readonly OrganizationMusicPiece[]> {
  const response = await request("/api/organization/music", { signal: signal ?? null });
  return organizationMusicPiecesResponseSchema.parse(await response.json()).pieces;
}

export async function createOrganizationMusicPiece(
  piece: OrganizationMusicPieceRequest,
): Promise<OrganizationMusicPiece> {
  const response = await request("/api/organization/music", {
    body: JSON.stringify(piece),
    method: "POST",
  });
  return organizationMusicPieceResponseSchema.parse(await response.json());
}

export async function updateOrganizationMusicPiece(
  pieceId: string,
  piece: OrganizationMusicPieceRequest,
): Promise<OrganizationMusicPiece> {
  const response = await request(`/api/organization/music/${encodeURIComponent(pieceId)}`, {
    body: JSON.stringify(piece),
    method: "PUT",
  });
  return organizationMusicPieceResponseSchema.parse(await response.json());
}

export async function deleteOrganizationMusicPiece(
  pieceId: string,
  unlinkChildren: boolean,
): Promise<void> {
  const query = unlinkChildren ? "?unlinkChildren=true" : "";
  const response = await request(`/api/organization/music/${encodeURIComponent(pieceId)}${query}`, {
    method: "DELETE",
  });
  organizationMusicPieceDeleteResponseSchema.parse(await response.json());
}

export async function importOrganizationMusicCsv(csv: string): Promise<number> {
  const response = await request("/api/organization/music/import", {
    body: csv,
    headers: { "content-type": "text/csv; charset=utf-8" },
    method: "POST",
  });
  return organizationMusicImportResponseSchema.parse(await response.json()).imported;
}

export async function uploadPrivateOrganizationFile(file: File): Promise<PrivateFileResponse> {
  const fileId = crypto.randomUUID();
  const response = await request(`/api/organization/files/${fileId}`, {
    body: file,
    headers: {
      "content-type": file.type,
      "x-file-name": encodeURIComponent(file.name),
    },
    method: "PUT",
  });
  return privateFileResponseSchema.parse(await response.json());
}

export async function listOrganizationVenues(
  signal?: AbortSignal,
): Promise<readonly OrganizationVenue[]> {
  const response = await request("/api/organization/venues", { signal: signal ?? null });
  return organizationVenuesResponseSchema.parse(await response.json()).venues;
}

export async function createOrganizationVenue(
  name: string,
  address: string,
): Promise<OrganizationVenue> {
  const response = await request("/api/organization/venues", {
    body: JSON.stringify({ address, name }),
    method: "POST",
  });
  return organizationVenueSchema.parse(await response.json());
}

export async function deleteOrganizationVenue(venueId: string): Promise<void> {
  const response = await request(`/api/organization/venues/${encodeURIComponent(venueId)}`, {
    method: "DELETE",
  });
  organizationVenueDeleteResponseSchema.parse(await response.json());
}

export async function listOrganizationEvents(
  signal?: AbortSignal,
): Promise<readonly OrganizationEvent[]> {
  const response = await request("/api/organization/events", { signal: signal ?? null });
  return organizationEventsResponseSchema.parse(await response.json()).events;
}

export async function createOrganizationEvent(
  event: OrganizationEventRequest,
): Promise<OrganizationEvent> {
  const response = await request("/api/organization/events", {
    body: JSON.stringify(event),
    method: "POST",
  });
  return organizationEventSchema.parse(await response.json());
}

export async function updateOrganizationEvent(
  eventId: string,
  event: OrganizationEventRequest,
): Promise<OrganizationEvent> {
  const response = await request(`/api/organization/events/${encodeURIComponent(eventId)}`, {
    body: JSON.stringify(event),
    method: "PUT",
  });
  return organizationEventSchema.parse(await response.json());
}

export async function archiveOrganizationEvent(eventId: string): Promise<void> {
  const response = await request(`/api/organization/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
  organizationEventArchiveResponseSchema.parse(await response.json());
}

export async function setOrganizationEventRsvp(
  eventId: string,
  profileId: string,
  rsvp: "No" | "Pending" | "Yes",
  rsvpNote = "",
): Promise<OrganizationRsvp> {
  const response = await request(`/api/organization/events/${encodeURIComponent(eventId)}/rsvp`, {
    body: JSON.stringify({ profileId, rsvp, rsvpNote }),
    method: "PUT",
  });
  return organizationRsvpSchema.parse(await response.json());
}

export async function listOrganizationEventAttendance(
  eventId: string,
  signal?: AbortSignal,
): Promise<readonly OrganizationAttendanceRow[]> {
  const response = await request(
    `/api/organization/events/${encodeURIComponent(eventId)}/attendance`,
    { signal: signal ?? null },
  );
  return organizationAttendanceResponseSchema.parse(await response.json()).rows;
}

export async function updateOrganizationEventAttendance(
  eventId: string,
  updates: readonly OrganizationAttendanceUpdate[],
): Promise<readonly OrganizationAttendanceRow[]> {
  const response = await request(
    `/api/organization/events/${encodeURIComponent(eventId)}/attendance`,
    { body: JSON.stringify({ updates }), method: "PUT" },
  );
  return organizationAttendanceResponseSchema.parse(await response.json()).rows;
}

export async function getOrganizationCalendarSettings(
  signal?: AbortSignal,
): Promise<OrganizationCalendarSettings> {
  const response = await request("/api/organization/calendar-settings", {
    signal: signal ?? null,
  });
  return organizationCalendarSettingsResponseSchema.parse(await response.json());
}

export async function updateOrganizationCalendarSettings(
  timezone: string,
): Promise<OrganizationCalendarSettings> {
  const response = await request("/api/organization/calendar-settings", {
    body: JSON.stringify({ timezone }),
    method: "PUT",
  });
  return organizationCalendarSettingsResponseSchema.parse(await response.json());
}

export async function getOrganizationRosterConfiguration(
  signal?: AbortSignal,
): Promise<OrganizationRosterConfiguration> {
  const response = await request("/api/organization/roster-configuration", {
    signal: signal ?? null,
  });
  const parsed = organizationRosterConfigurationResponseSchema.parse(await response.json());
  return { sections: parsed.sections, voiceParts: parsed.voiceParts };
}

export async function updateOrganizationRosterConfiguration(
  configuration: OrganizationRosterConfiguration,
): Promise<OrganizationRosterConfiguration> {
  const response = await request("/api/organization/roster-configuration", {
    body: JSON.stringify(configuration),
    method: "PUT",
  });
  const parsed = organizationRosterConfigurationResponseSchema.parse(await response.json());
  return { sections: parsed.sections, voiceParts: parsed.voiceParts };
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

export async function getMyEventSeating(
  eventId: string,
  signal?: AbortSignal,
): Promise<SingerSeatingResponse> {
  const response = await request(`/api/singer/events/${encodeURIComponent(eventId)}/seating`, {
    signal: signal ?? null,
  });
  return singerSeatingResponseSchema.parse(await response.json());
}

export async function getMySchedule(signal?: AbortSignal): Promise<SingerEventsResponse> {
  const response = await request("/api/singer/events", { signal: signal ?? null });
  return singerEventsResponseSchema.parse(await response.json());
}

export async function setMyEventRsvp(
  eventId: string,
  rsvp: "No" | "Pending" | "Yes",
  rsvpNote = "",
): Promise<OrganizationRsvp> {
  const response = await request(`/api/singer/events/${encodeURIComponent(eventId)}/rsvp`, {
    body: JSON.stringify({ rsvp, rsvpNote }),
    method: "PUT",
  });
  return organizationRsvpSchema.parse(await response.json());
}

export async function updateAccountPassword(
  password: AccountPasswordRequest,
): Promise<AccountSecurityResponse> {
  const response = await request("/api/account/password", {
    body: JSON.stringify(password),
    method: "PUT",
  });
  return accountSecurityResponseSchema.parse(await response.json());
}

export async function getPlatformMfaStatus(
  signal?: AbortSignal,
): Promise<PlatformMfaStatusResponse> {
  const response = await request("/api/platform/mfa/status", { signal: signal ?? null });
  return platformMfaStatusResponseSchema.parse(await response.json());
}

function optionalPasswordBody(password: string): { readonly password?: string } {
  return password.length > 0 ? { password } : {};
}

export async function beginAccountMfaEnrollment(
  password = "",
): Promise<PlatformMfaEnrollmentResponse> {
  const response = await request("/api/auth/two-factor/enable", {
    body: JSON.stringify(optionalPasswordBody(password)),
    method: "POST",
  });
  return platformMfaEnrollmentResponseSchema.parse(await response.json());
}

export async function verifyAccountTotpEnrollment(code: string): Promise<void> {
  await request("/api/auth/two-factor/verify-totp", {
    body: JSON.stringify({ code, trustDevice: false }),
    method: "POST",
  });
}

export async function regenerateAccountRecoveryCodes(password = ""): Promise<readonly string[]> {
  const response = await request("/api/auth/two-factor/generate-backup-codes", {
    body: JSON.stringify(optionalPasswordBody(password)),
    method: "POST",
  });
  return platformRecoveryCodesResponseSchema.parse(await response.json()).backupCodes;
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
