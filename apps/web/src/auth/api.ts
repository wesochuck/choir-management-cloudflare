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
  memberProfileResponseSchema,
  organizationMusicPiecesResponseSchema,
  organizationMusicLibrarySettingsResponseSchema,
  organizationMusicPieceDeleteResponseSchema,
  organizationMusicImportResponseSchema,
  organizationMusicPieceResponseSchema,
  organizationResourceDeleteResponseSchema,
  organizationResourceResponseSchema,
  organizationResourcesResponseSchema,
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
  organizationMembershipsResponseSchema,
  organizationProviderStatusResponseSchema,
  organizationPaymentSettingsResponseSchema,
  organizationStripeConnectOnboardingResponseSchema,
  organizationStripeConnectStatusResponseSchema,
  organizationEventSchema,
  organizationEventArchiveResponseSchema,
  organizationEventCancelResponseSchema,
  organizationEventRsvpHistoryResponseSchema,
  organizationEventsResponseSchema,
  organizationDashboardSummaryResponseSchema,
  organizationCalendarSettingsResponseSchema,
  organizationRosterConfigurationResponseSchema,
  organizationRosterAutomationPreviewResponseSchema,
  organizationSeatingChartSchema,
  organizationSeatingChartsResponseSchema,
  organizationSeatingChartOrderResponseSchema,
  seatingConfigurationResponseSchema,
  singerSeatingResponseSchema,
  organizationMfaPolicyResponseSchema,
  organizationMfaVerificationResponseSchema,
  organizationProfileResponseSchema,
  organizationProfilesResponseSchema,
  organizationProfileImportResponseSchema,
  organizationProfileFolderNumberSchema,
  organizationProfileFolderNumbersResponseSchema,
  organizationProfilePerformanceHistoryResponseSchema,
  organizationProfileStatusHistoryResponseSchema,
  organizationRsvpSchema,
  organizationVenueSchema,
  organizationVenueDeleteResponseSchema,
  organizationVenuesResponseSchema,
  singerEventsResponseSchema,
  singerLearningTrackPiecesResponseSchema,
  organizationProvisionResponseSchema,
  platformContextResponseSchema,
  platformFleetSchemaStatusResponseSchema,
  platformJobDeadLettersResponseSchema,
  platformSetupStatusResponseSchema,
  platformElevationRevocationResponseSchema,
  platformMfaEnrollmentResponseSchema,
  platformMfaStatusResponseSchema,
  platformOrganizationContextResponseSchema,
  platformOrganizationsResponseSchema,
  privateFileResponseSchema,
  platformRecoveryCodesResponseSchema,
  problemDetailsSchema,
  publishedOrganizationProjectionSchema,
  publicWebsitePublishResponseSchema,
  publicWebsiteSettingsResponseSchema,
  organizationTicketOrderSchema,
  organizationTicketOrdersResponseSchema,
  publicTicketPurchaseResponseSchema,
  ticketCheckoutResponseSchema,
  ticketBundleSchema,
  ticketBundlesResponseSchema,
  ticketScanResponseSchema,
  organizationAuditionSchema,
  organizationAuditionListResponseSchema,
  organizationAuditionSettingsSchema,
  generateAuditionTokensResponseSchema,
  organizationAuditionSettingsResponseSchema,
  organizationAuditionCreateRequestSchema,
  organizationAuditionResponseSchema,
  organizationAuditionUpdateRequestSchema,
  donationSettingsResponseSchema,
  publicDonationReceiptResponseSchema,
  ticketConfirmationSettingsResponseSchema,
  transactionFeeSettingsResponseSchema,
  organizationExportStartResponseSchema,
  organizationExportStatusResponseSchema,
  duesRecordSchema,
  duesRecordsResponseSchema,
  duesCashPaymentRequestSchema,
  memberDuesResponseSchema,
  duesCheckoutResponseSchema,
  seasonSchema,
  seasonsResponseSchema,
  type DuesRecord,
  type Season,
  type DuesCheckoutResponse,
  type SeasonCreateRequest,
  type SeasonUpdateRequest,
  type AccountOrganization,
  type CommunicationDeliverySummary,
  type CommunicationDraftRequest,
  type CommunicationMessage,
  type CommunicationReach,
  type CommunicationScheduledMessage,
  type CommunicationSendRequest,
  type CommunicationTemplate,
  type CommunicationTemplateRequest,
  type CommunicationTestEmailRequest,
  type TransactionFeeSettings,
  type TicketConfirmationSettings,
  type AccountPasswordRequest,
  type AccountSecurityResponse,
  type AuthSession,
  type CalendarFeedUrlsResponse,
  type CurrentAuthSession,
  type MemberProfile,
  type MemberProfileUpdateRequest,
  type OrganizationMusicPiece,
  type OrganizationMusicLibrarySettings,
  type OrganizationMusicBulkUpdateRequest,
  type OrganizationMusicPieceRequest,
  type OrganizationResource,
  type OrganizationResourceRequest,
  type OrganizationDirectoryProfile,
  type OrganizationAuthStatusResponse,
  type OrganizationAttendanceRow,
  type OrganizationAttendanceUpdate,
  type OrganizationInvitationDetails,
  type OrganizationInvitationActionResponse,
  type OrganizationInvitationRequest,
  type OrganizationAuditionCreateRequest,
  type OrganizationAuditionSettings,
  type OrganizationInvitationResponse,
  type OrganizationInvitationsResponse,
  type OrganizationMembershipsResponse,
  type OrganizationProviderStatusResponse,
  type OrganizationPaymentSettingsResponse,
  type PublicDonationReceiptResponse,
  type OrganizationStripeConnectOnboardingResponse,
  type OrganizationStripeConnectStatusResponse,
  type OrganizationEvent,
  type OrganizationEventRsvpHistoryResponse,
  type OrganizationDashboardSummaryResponse,
  type OrganizationEventRequest,
  type OrganizationCalendarSettings,
  type OrganizationRosterConfiguration,
  type OrganizationRosterAutomationPreviewResponse,
  type OrganizationSeatingChart,
  type OrganizationSeatingChartRequest,
  type SeatingConfiguration,
  type SingerSeatingResponse,
  type OrganizationMfaPolicyResponse,
  type OrganizationMfaVerificationResponse,
  type OrganizationProfile,
  type OrganizationProfileFolderNumber,
  type OrganizationProfileFolderNumberUpdate,
  type OrganizationProfileRequest,
  type OrganizationProfilePerformanceHistoryResponse,
  type OrganizationProfileStatusHistoryResponse,
  type OrganizationRsvp,
  type OrganizationVenue,
  type SingerEventsResponse,
  type SingerLearningTrackPiece,
  type OrganizationProvisionRequest,
  type OrganizationProvisionResponse,
  type PlatformContextResponse,
  type PlatformFleetSchemaStatusResponse,
  type PlatformJobDeadLettersResponse,
  type PlatformSetupStatusResponse,
  type PlatformOrganizationContextResponse,
  type PrivateFileResponse,
  type PlatformOrganizationsResponse,
  type PlatformMfaEnrollmentResponse,
  type PlatformMfaStatusResponse,
  type PublishedOrganizationProjection,
  type PublicWebsiteSettings,
  type PublicWebsiteSettingsRequest,
  type OrganizationTicketOrder,
  type PublicTicketReceipt,
  type TicketCheckoutRequest,
  type TicketBundle,
  type TicketBundleRequest,
  type TicketScanRequest,
  type TicketScanResult,
  type OrganizationAudition,
  type AuditionStatus,
  type OrganizationExportStartResponse,
  type OrganizationExportStatusResponse,
  type DonationSettings,
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
  const response = await request("/api/account/sessions", { signal: signal ?? null });
  return authSessionListSchema.parse(await response.json());
}

export async function revokeSession(token: string): Promise<void> {
  await request("/api/account/sessions/revoke", {
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

export async function listOrganizationMemberships(
  signal?: AbortSignal,
): Promise<OrganizationMembershipsResponse> {
  const response = await request("/api/organization/members", { signal: signal ?? null });
  return organizationMembershipsResponseSchema.parse(await response.json());
}

export async function linkOrganizationMembershipProfile(
  membershipId: string,
  profileId: string,
): Promise<void> {
  await request(`/api/organization/members/${encodeURIComponent(membershipId)}/profile`, {
    body: JSON.stringify({ profileId }),
    method: "PUT",
  });
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

export async function importOrganizationProfilesCsv(
  csv: string,
): Promise<{ readonly imported: number; readonly invitationCandidates: number }> {
  const response = await request("/api/organization/profiles/import", {
    body: csv,
    headers: { "content-type": "text/csv; charset=utf-8" },
    method: "POST",
  });
  const parsed = organizationProfileImportResponseSchema.parse(await response.json());
  return { imported: parsed.imported, invitationCandidates: parsed.invitationCandidates };
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

export async function getOrganizationProfilePerformanceHistory(
  profileId: string,
  signal?: AbortSignal,
): Promise<OrganizationProfilePerformanceHistoryResponse> {
  const response = await request(
    `/api/organization/profiles/${encodeURIComponent(profileId)}/performance-history`,
    { signal: signal ?? null },
  );
  return organizationProfilePerformanceHistoryResponseSchema.parse(await response.json());
}

export async function getOrganizationProfileStatusHistory(
  profileId: string,
  signal?: AbortSignal,
): Promise<OrganizationProfileStatusHistoryResponse> {
  const response = await request(
    `/api/organization/profiles/${encodeURIComponent(profileId)}/status-history`,
    { signal: signal ?? null },
  );
  return organizationProfileStatusHistoryResponseSchema.parse(await response.json());
}

export async function getOrganizationProfileFolderNumbers(
  profileId: string,
  signal?: AbortSignal,
): Promise<readonly OrganizationProfileFolderNumber[]> {
  const response = await request(
    `/api/organization/profiles/${encodeURIComponent(profileId)}/folder-numbers`,
    { signal: signal ?? null },
  );
  return organizationProfileFolderNumbersResponseSchema.parse(await response.json()).folderNumbers;
}

export async function updateOrganizationProfileFolderNumber(
  profileId: string,
  eventId: string,
  folder: OrganizationProfileFolderNumberUpdate,
): Promise<OrganizationProfileFolderNumber> {
  const response = await request(
    `/api/organization/profiles/${encodeURIComponent(profileId)}/folder-numbers/${encodeURIComponent(eventId)}`,
    { body: JSON.stringify(folder), method: "PUT" },
  );
  return organizationProfileFolderNumberSchema.parse(await response.json());
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

export async function getOrganizationMusicLibrarySettings(
  signal?: AbortSignal,
): Promise<OrganizationMusicLibrarySettings> {
  const response = await request("/api/organization/music-library-settings", {
    signal: signal ?? null,
  });
  return organizationMusicLibrarySettingsResponseSchema.parse(await response.json());
}

export async function updateOrganizationMusicLibrarySettings(
  settings: OrganizationMusicLibrarySettings,
): Promise<OrganizationMusicLibrarySettings> {
  const response = await request("/api/organization/music-library-settings", {
    body: JSON.stringify(settings),
    method: "PUT",
  });
  return organizationMusicLibrarySettingsResponseSchema.parse(await response.json());
}

export async function listSingerLearningTracks(
  signal?: AbortSignal,
): Promise<readonly SingerLearningTrackPiece[]> {
  const response = await request("/api/singer/music", { signal: signal ?? null });
  return singerLearningTrackPiecesResponseSchema.parse(await response.json()).pieces;
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

export async function bulkUpdateOrganizationMusicPieces(
  changesRequest: OrganizationMusicBulkUpdateRequest,
): Promise<readonly OrganizationMusicPiece[]> {
  const response = await request("/api/organization/music/bulk-update", {
    body: JSON.stringify(changesRequest),
    method: "POST",
  });
  return organizationMusicPiecesResponseSchema.parse(await response.json()).pieces;
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

export async function getPublishedOrganizationProjection(
  signal?: AbortSignal,
): Promise<PublishedOrganizationProjection | null> {
  const response = await fetch("/api/public/projection", {
    headers: { accept: "application/json" },
    signal: signal ?? null,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw await responseError(response);
  return publishedOrganizationProjectionSchema.parse(await response.json());
}

export async function getPublicCommerceProjection(
  signal?: AbortSignal,
): Promise<PublishedOrganizationProjection> {
  const response = await fetch("/api/public/commerce-projection", {
    headers: { accept: "application/json" },
    signal: signal ?? null,
  });
  if (!response.ok) throw await responseError(response);
  return publishedOrganizationProjectionSchema.parse(await response.json());
}

export async function getOrganizationPublicWebsiteSettings(
  signal?: AbortSignal,
): Promise<PublicWebsiteSettings> {
  const response = await request("/api/organization/website", { signal: signal ?? null });
  return publicWebsiteSettingsResponseSchema.parse(await response.json());
}

export async function updateOrganizationPublicWebsiteSettings(
  settings: PublicWebsiteSettingsRequest,
): Promise<PublicWebsiteSettings> {
  const response = await request("/api/organization/website", {
    body: JSON.stringify(settings),
    method: "PUT",
  });
  return publicWebsiteSettingsResponseSchema.parse(await response.json());
}

export async function publishOrganizationPublicWebsite(): Promise<{
  readonly publishedAt: string;
  readonly version: number;
}> {
  const response = await request("/api/organization/website/publish", { method: "POST" });
  return publicWebsitePublishResponseSchema.parse(await response.json());
}

export async function createPublicTicketCheckout(checkout: TicketCheckoutRequest) {
  const response = await fetch("/api/public/tickets/checkout", {
    body: JSON.stringify(checkout),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw await responseError(response);
  return ticketCheckoutResponseSchema.parse(await response.json());
}

export async function getPublicTicketPurchase(
  token: string,
  signal?: AbortSignal,
): Promise<PublicTicketReceipt> {
  const response = await fetch(`/api/public/tickets/order?token=${encodeURIComponent(token)}`, {
    headers: { accept: "application/json" },
    signal: signal ?? null,
  });
  if (!response.ok) throw await responseError(response);
  return publicTicketPurchaseResponseSchema.parse(await response.json());
}

export async function validateTicketScan(scan: TicketScanRequest): Promise<TicketScanResult> {
  const response = await request("/api/organization/tickets/scan", {
    body: JSON.stringify(scan),
    method: "POST",
  });
  return ticketScanResponseSchema.parse(await response.json());
}

export async function listTicketBundles(signal?: AbortSignal): Promise<readonly TicketBundle[]> {
  const response = await request("/api/organization/tickets/bundles", { signal: signal ?? null });
  return ticketBundlesResponseSchema.parse(await response.json()).bundles;
}

export async function saveTicketBundle(
  bundle: TicketBundleRequest,
  bundleId?: string,
): Promise<TicketBundle> {
  const response = await request(
    bundleId
      ? `/api/organization/tickets/bundles/${encodeURIComponent(bundleId)}`
      : "/api/organization/tickets/bundles",
    { body: JSON.stringify(bundle), method: bundleId ? "PUT" : "POST" },
  );
  return ticketBundleSchema.parse(await response.json());
}

export async function deleteTicketBundle(bundleId: string): Promise<void> {
  await request(`/api/organization/tickets/bundles/${encodeURIComponent(bundleId)}`, {
    method: "DELETE",
  });
}

export async function listOrganizationTicketOrders(
  signal?: AbortSignal,
): Promise<readonly OrganizationTicketOrder[]> {
  const response = await request("/api/organization/tickets/orders", { signal: signal ?? null });
  return organizationTicketOrdersResponseSchema.parse(await response.json()).orders;
}

export async function refundOrganizationTicketOrder(
  purchaseId: string,
): Promise<OrganizationTicketOrder> {
  const response = await request(
    `/api/organization/tickets/${encodeURIComponent(purchaseId)}/refund`,
    { method: "POST" },
  );
  return organizationTicketOrderSchema.parse(await response.json());
}

export async function resendTicketConfirmation(purchaseId: string): Promise<void> {
  await request(`/api/organization/tickets/${encodeURIComponent(purchaseId)}/confirmation`, {
    method: "POST",
  });
}

export async function setOrganizationProfilePhoto(
  profileId: string,
  fileId: string,
): Promise<void> {
  await request(
    `/api/organization/profiles/${encodeURIComponent(profileId)}/photo/${encodeURIComponent(fileId)}`,
    { method: "PUT" },
  );
}

export async function deleteOrganizationProfilePhoto(profileId: string): Promise<void> {
  await request(`/api/organization/profiles/${encodeURIComponent(profileId)}/photo`, {
    method: "DELETE",
  });
}

export async function listOrganizationResources(
  signal?: AbortSignal,
): Promise<readonly OrganizationResource[]> {
  const response = await request("/api/organization/resources", { signal: signal ?? null });
  return organizationResourcesResponseSchema.parse(await response.json()).resources;
}

export async function createOrganizationResource(
  resource: OrganizationResourceRequest,
): Promise<OrganizationResource> {
  const response = await request("/api/organization/resources", {
    body: JSON.stringify(resource),
    method: "POST",
  });
  return organizationResourceResponseSchema.parse(await response.json());
}

export async function updateOrganizationResource(
  resourceId: string,
  resource: OrganizationResourceRequest,
): Promise<OrganizationResource> {
  const response = await request(`/api/organization/resources/${encodeURIComponent(resourceId)}`, {
    body: JSON.stringify(resource),
    method: "PUT",
  });
  return organizationResourceResponseSchema.parse(await response.json());
}

export async function reorderOrganizationResources(resourceIds: readonly string[]): Promise<void> {
  await request("/api/organization/resources/order", {
    body: JSON.stringify({ resourceIds }),
    method: "PUT",
  });
}

export async function deleteOrganizationResource(resourceId: string): Promise<void> {
  const response = await request(`/api/organization/resources/${encodeURIComponent(resourceId)}`, {
    method: "DELETE",
  });
  organizationResourceDeleteResponseSchema.parse(await response.json());
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
): Promise<CommunicationMessage> {
  const response = await request("/api/organization/communications/send", {
    body: JSON.stringify(communication),
    method: "POST",
  });
  return communicationMessageResponseSchema.parse(await response.json());
}

export async function sendOrganizationCommunicationTestEmail(
  message: CommunicationTestEmailRequest,
): Promise<void> {
  const response = await request("/api/organization/communications/test-email", {
    body: JSON.stringify(message),
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

export async function deletePrivateOrganizationFile(fileId: string): Promise<void> {
  await request(`/api/organization/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
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

export async function updateOrganizationVenue(
  venueId: string,
  name: string,
  address: string,
): Promise<OrganizationVenue> {
  const response = await request(`/api/organization/venues/${encodeURIComponent(venueId)}`, {
    body: JSON.stringify({ address, name }),
    method: "PUT",
  });
  return organizationVenueSchema.parse(await response.json());
}

export async function deleteOrganizationVenue(venueId: string): Promise<void> {
  const response = await request(`/api/organization/venues/${encodeURIComponent(venueId)}`, {
    method: "DELETE",
  });
  organizationVenueDeleteResponseSchema.parse(await response.json());
}

export async function listOrganizationSeasons(signal?: AbortSignal): Promise<readonly Season[]> {
  const response = await request("/api/organization/seasons", { signal: signal ?? null });
  return seasonsResponseSchema.parse(await response.json()).seasons;
}

export async function createOrganizationSeason(season: SeasonCreateRequest): Promise<Season> {
  const response = await request("/api/organization/seasons", {
    body: JSON.stringify(season),
    method: "POST",
  });
  return seasonSchema.parse(await response.json());
}

export async function updateOrganizationSeason(
  seasonId: string,
  season: SeasonUpdateRequest,
): Promise<Season> {
  const response = await request(`/api/organization/seasons/${encodeURIComponent(seasonId)}`, {
    body: JSON.stringify(season),
    method: "PUT",
  });
  return seasonSchema.parse(await response.json());
}

export async function activateOrganizationSeason(seasonId: string): Promise<Season> {
  const response = await request(
    `/api/organization/seasons/${encodeURIComponent(seasonId)}/activate`,
    { method: "POST" },
  );
  return seasonSchema.parse(await response.json());
}

export async function deleteOrganizationSeason(seasonId: string): Promise<void> {
  await request(`/api/organization/seasons/${encodeURIComponent(seasonId)}`, {
    method: "DELETE",
  });
}

export async function listOrganizationDues(signal?: AbortSignal): Promise<readonly DuesRecord[]> {
  const response = await request("/api/organization/dues", { signal: signal ?? null });
  return duesRecordsResponseSchema.parse(await response.json()).dues;
}

export async function getMyDues(signal?: AbortSignal): Promise<{
  readonly dues: readonly DuesRecord[];
  readonly seasons: readonly Season[];
  readonly transactionFeeSettings: TransactionFeeSettings;
}> {
  const response = await request("/api/singer/dues", { signal: signal ?? null });
  const result = memberDuesResponseSchema.parse(await response.json());
  return {
    dues: result.dues,
    seasons: result.seasons,
    transactionFeeSettings: result.transactionFeeSettings,
  };
}

export async function createMyDuesCheckout(seasonId: string): Promise<DuesCheckoutResponse> {
  const response = await request("/api/singer/dues/checkout", {
    body: JSON.stringify({ seasonId }),
    method: "POST",
  });
  return duesCheckoutResponseSchema.parse(await response.json());
}

export async function refundOrganizationDues(duesId: string): Promise<DuesRecord> {
  const response = await request("/api/admin/refund-dues", {
    body: JSON.stringify({ duesId }),
    method: "POST",
  });
  return duesRecordSchema.parse(await response.json());
}

export async function markOrganizationDuesPaidInCash(
  profileId: string,
  seasonId: string,
): Promise<DuesRecord> {
  const response = await request("/api/admin/mark-dues-cash", {
    body: JSON.stringify(duesCashPaymentRequestSchema.parse({ profileId, seasonId })),
    method: "POST",
  });
  return duesRecordSchema.parse(await response.json());
}

export async function listOrganizationEvents(
  signal?: AbortSignal,
): Promise<readonly OrganizationEvent[]> {
  const response = await request("/api/organization/events", { signal: signal ?? null });
  return organizationEventsResponseSchema.parse(await response.json()).events;
}

export async function getOrganizationDashboardSummary(
  signal?: AbortSignal,
): Promise<OrganizationDashboardSummaryResponse> {
  const response = await request("/api/organization/dashboard-summary", {
    signal: signal ?? null,
  });
  return organizationDashboardSummaryResponseSchema.parse(await response.json());
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

export async function cancelOrganizationEvent(eventId: string): Promise<void> {
  const response = await request(`/api/organization/events/${encodeURIComponent(eventId)}/cancel`, {
    method: "POST",
  });
  organizationEventCancelResponseSchema.parse(await response.json());
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

export async function getOrganizationEventRsvpHistory(
  eventId: string,
  signal?: AbortSignal,
): Promise<OrganizationEventRsvpHistoryResponse> {
  const response = await request(
    `/api/organization/events/${encodeURIComponent(eventId)}/rsvp-history`,
    { signal: signal ?? null },
  );
  return organizationEventRsvpHistoryResponseSchema.parse(await response.json());
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

export async function getPublicTransactionFeeSettings(
  signal?: AbortSignal,
): Promise<TransactionFeeSettings> {
  const response = await request("/api/public/transaction-fee-settings", {
    signal: signal ?? null,
  });
  return transactionFeeSettingsResponseSchema.parse(await response.json());
}

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

export async function getPublicTicketConfirmationSettings(
  signal?: AbortSignal,
): Promise<TicketConfirmationSettings> {
  const response = await request("/api/public/ticket-confirmation-settings", {
    signal: signal ?? null,
  });
  return ticketConfirmationSettingsResponseSchema.parse(await response.json());
}

export async function getOrganizationTicketConfirmationSettings(
  signal?: AbortSignal,
): Promise<TicketConfirmationSettings> {
  const response = await request("/api/organization/ticket-confirmation-settings", {
    signal: signal ?? null,
  });
  return ticketConfirmationSettingsResponseSchema.parse(await response.json());
}

export async function updateOrganizationTicketConfirmationSettings(
  settings: TicketConfirmationSettings,
): Promise<TicketConfirmationSettings> {
  const response = await request("/api/organization/ticket-confirmation-settings", {
    body: JSON.stringify(settings),
    method: "PUT",
  });
  return ticketConfirmationSettingsResponseSchema.parse(await response.json());
}

export async function getPublicDonationSettings(signal?: AbortSignal): Promise<DonationSettings> {
  const response = await request("/api/public/donation-settings", { signal: signal ?? null });
  return donationSettingsResponseSchema.parse(await response.json());
}

export async function getPublicDonationReceipt(
  token: string,
  signal?: AbortSignal,
): Promise<PublicDonationReceiptResponse> {
  const response = await request(
    `/api/public/donation-receipt?token=${encodeURIComponent(token)}`,
    {
      signal: signal ?? null,
    },
  );
  return publicDonationReceiptResponseSchema.parse(await response.json());
}

export async function getOrganizationDonationSettings(
  signal?: AbortSignal,
): Promise<DonationSettings> {
  const response = await request("/api/organization/donation-settings", {
    signal: signal ?? null,
  });
  return donationSettingsResponseSchema.parse(await response.json());
}

export async function updateOrganizationDonationSettings(
  settings: DonationSettings,
): Promise<DonationSettings> {
  const response = await request("/api/organization/donation-settings", {
    body: JSON.stringify(settings),
    method: "PUT",
  });
  return donationSettingsResponseSchema.parse(await response.json());
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
    rsvpExpiryLeadDays: parsed.rsvpExpiryLeadDays,
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
    rsvpExpiryLeadDays: parsed.rsvpExpiryLeadDays,
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

export async function getPlatformSetupStatus(
  signal?: AbortSignal,
): Promise<PlatformSetupStatusResponse> {
  const response = await request("/api/platform/setup-status", { signal: signal ?? null });
  return platformSetupStatusResponseSchema.parse(await response.json());
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

export async function listOrganizationAuditions(
  signal?: AbortSignal,
): Promise<readonly OrganizationAudition[]> {
  const response = await request("/api/organization/auditions", { signal: signal ?? null });
  return organizationAuditionListResponseSchema.parse(await response.json()).auditions;
}

export async function getOrganizationAuditionSettings(
  signal?: AbortSignal,
): Promise<OrganizationAuditionSettings> {
  const response = await request("/api/organization/audition-settings", {
    signal: signal ?? null,
  });
  return organizationAuditionSettingsResponseSchema.parse(await response.json());
}

export async function updateOrganizationAuditionSettings(
  settings: OrganizationAuditionSettings,
): Promise<OrganizationAuditionSettings> {
  const parsed = organizationAuditionSettingsSchema.parse(settings);
  const response = await request("/api/organization/audition-settings", {
    body: JSON.stringify(parsed),
    method: "PUT",
  });
  return organizationAuditionSettingsResponseSchema.parse(await response.json());
}

export async function createOrganizationAudition(
  audition: OrganizationAuditionCreateRequest,
): Promise<OrganizationAudition> {
  const parsed = organizationAuditionCreateRequestSchema.parse(audition);
  const response = await request("/api/organization/auditions", {
    body: JSON.stringify(parsed),
    method: "POST",
  });
  return organizationAuditionResponseSchema.parse(await response.json());
}

export async function updateOrganizationAudition(
  auditionId: string,
  update: {
    readonly adminNotes?: string;
    readonly availabilityNotes?: string;
    readonly email?: string;
    readonly experience?: string;
    readonly name?: string;
    readonly performanceId?: string | null;
    readonly phone?: string;
    readonly requestedSlots?: readonly string[];
    readonly scheduledTimeSlot?: string | null;
    readonly status?: AuditionStatus;
    readonly voicePart?: string;
  },
): Promise<OrganizationAudition> {
  const parsed = organizationAuditionUpdateRequestSchema.parse(update);
  const response = await request(`/api/organization/auditions/${encodeURIComponent(auditionId)}`, {
    body: JSON.stringify(parsed),
    method: "PUT",
  });
  return organizationAuditionSchema.parse(await response.json());
}

export async function deleteOrganizationAudition(auditionId: string): Promise<void> {
  await request(`/api/organization/auditions/${encodeURIComponent(auditionId)}`, {
    method: "DELETE",
  });
}

export async function convertOrganizationAudition(
  auditionId: string,
): Promise<{ readonly profileId: string }> {
  const response = await request(
    `/api/organization/auditions/${encodeURIComponent(auditionId)}/convert`,
    { method: "POST" },
  );
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("profile" in body) ||
    typeof body.profile !== "object" ||
    body.profile === null ||
    !("id" in body.profile) ||
    typeof body.profile.id !== "string"
  ) {
    throw new Error("The audition conversion response was invalid.");
  }
  return { profileId: body.profile.id };
}

export async function generateAuditionTokens(
  auditionIds: readonly string[],
): Promise<Record<string, string>> {
  const response = await request("/api/organization/audition-tokens", {
    body: JSON.stringify({ auditionIds }),
    method: "POST",
  });
  return generateAuditionTokensResponseSchema.parse(await response.json()).tokens;
}

export async function generatePublicPlayerToken(eventId: string): Promise<string> {
  const response = await request("/api/generate-player-token", {
    body: JSON.stringify({ eventId }),
    method: "POST",
  });
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("token" in body) ||
    typeof body.token !== "string" ||
    body.token.length === 0
  ) {
    throw new Error("The practice player link response was invalid.");
  }
  return body.token;
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
