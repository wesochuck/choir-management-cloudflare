import {
  accountOrganizationsResponseSchema,
  accountSecurityResponseSchema,
  authSessionSchema,
  authUserSchema,
  calendarFeedUrlsResponseSchema,
  donationRecordsResponseSchema,
  healthResponseSchema,
  memberDashboardResponseSchema,
  memberEmailChangeConfirmationResponseSchema,
  memberEmailChangeResponseSchema,
  memberProfileSchema,
  organizationAttendanceResponseSchema,
  organizationAuthStatusResponseSchema,
  organizationCalendarSettingsResponseSchema,
  organizationDirectoryResponseSchema,
  organizationEventRsvpHistoryResponseSchema,
  organizationEventsResponseSchema,
  organizationInvitationActionResponseSchema,
  organizationInvitationDetailsSchema,
  organizationInvitationResponseSchema,
  organizationInvitationsResponseSchema,
  organizationMfaPolicyResponseSchema,
  organizationMfaVerificationResponseSchema,
  organizationProviderStatusResponseSchema,
  organizationStripeConnectStatusResponseSchema,
  organizationProfilesResponseSchema,
  organizationProvisionResponseSchema,
  organizationRosterConfigurationResponseSchema,
  organizationVenueDeleteResponseSchema,
  organizationVenuesResponseSchema,
  platformContextResponseSchema,
  platformElevationRevocationResponseSchema,
  platformFleetSchemaStatusResponseSchema,
  platformJobDeadLettersResponseSchema,
  platformMfaEnrollmentResponseSchema,
  platformMfaStatusResponseSchema,
  platformOrganizationContextResponseSchema,
  platformOrganizationPublicDomainsResponseSchema,
  platformOrganizationsResponseSchema,
  platformStripeConnectStatusResponseSchema,
  seatingConfigurationResponseSchema,
  seatingConfigurationRequestSchema,
  singerEventsResponseSchema,
  singerSeatingResponseSchema,
  moduleStatesResponseSchema,
  organizationSeatingChartsResponseSchema,
  setupStatusSchema,
  type AccountOrganization,
  type AuthSession,
  type AuthUser,
  type DonationRecord,
  type MemberDashboardResponse,
  type MemberProfile,
  type OrganizationAttendanceRow,
  type OrganizationAuthStatusResponse,
  type OrganizationDirectoryProfile,
  type OrganizationEvent,
  type OrganizationEventRsvpHistoryEntry,
  type OrganizationInvitationDetails,
  type OrganizationInvitationSummary,
  type OrganizationProfile,
  type OrganizationVenue,
  type OrganizationSeatingChart,
  type SingerEvent,
} from "@choir/contracts";

/**
 * Well-known deterministic IDs shared by the browser fixture dataset. Specs keep asserting on
 * these values (URLs, hrefs, visible names) while builders own the surrounding payloads.
 */
export const fixtureIds = {
  browserProfileId: "11111111-1111-4111-8111-111111111111",
  concertEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  directoryAltoId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  memberChartId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  rehearsalEventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  seatingChartId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  unassignedProfileId: "44444444-4444-4444-8444-444444444444",
  unexpectedProfileId: "33333333-3333-4333-8333-333333333333",
  venueId: "22222222-2222-4222-8222-222222222222",
} as const;

export const defaultFixtureRequestId = "11111111-1111-4111-8111-111111111111";

/** Valid UUID used only to satisfy wrapper schemas when validating a single nested payload. */
const validationRequestId = "99999999-9999-4999-8999-999999999999";

export const organizationAlphaId = "organization-alpha";

/**
 * Contract drift guard: every builder validates its payload through the shared contract schema
 * and serves the input unchanged. A contract change that tightens or extends a schema fails here,
 * next to the fixture definition, instead of letting a stale browser mock stay silently green.
 * Request-driven echo routes (PUT/POST handlers that reflect the browser's own body) are the
 * deliberate exception: their shape is owned by the live request, not by the fixture.
 */
function validated<T>(payload: T, validate: (value: unknown) => unknown): T {
  validate(payload);
  return payload;
}

export interface SessionUserOverrides {
  readonly activeOrganizationId?: string | null;
  readonly email?: string;
  readonly name?: string;
  readonly sessionId?: string;
  readonly twoFactorEnabled?: boolean;
  readonly userId?: string;
}

export function buildSessionUser(overrides: SessionUserOverrides = {}): {
  session: AuthSession;
  user: AuthUser;
} {
  const userId = overrides.userId ?? "user-invited-member";
  const user: AuthUser = {
    createdAt: "2026-07-20T19:00:00.000Z",
    email: overrides.email ?? "invited.member@example.test",
    emailVerified: true,
    id: userId,
    image: null,
    name: overrides.name ?? "Invited Member",
    twoFactorEnabled: overrides.twoFactorEnabled ?? false,
    updatedAt: "2026-07-20T20:00:00.000Z",
  };
  const session: AuthSession = {
    activeOrganizationId: overrides.activeOrganizationId ?? null,
    createdAt: "2026-07-20T20:00:00.000Z",
    expiresAt: "2026-07-27T20:00:00.000Z",
    id: overrides.sessionId ?? "session-current",
    ipAddress: "192.0.2.10",
    updatedAt: "2026-07-20T20:00:00.000Z",
    userAgent: "Chromium browser",
    userId,
  };
  authUserSchema.parse(user);
  authSessionSchema.parse(session);
  return { session, user };
}

export function buildHealthResponse(
  overrides: Record<string, string> = {},
): Record<string, string> {
  const payload = {
    environment: "local",
    requestId: defaultFixtureRequestId,
    service: "choir-management-cloudflare",
    status: "ok",
    version: "browser-test",
    ...overrides,
  };
  return validated(payload, (value) => healthResponseSchema.parse(value));
}

export function buildAccountMembership(
  overrides: Partial<AccountOrganization> = {},
): AccountOrganization {
  const membership: AccountOrganization = {
    canonicalHostname: "alpha.example.test",
    canonicalStatus: "active",
    lifecycleState: "active",
    name: "Organization Alpha",
    organizationId: organizationAlphaId,
    profileId: null,
    role: "administrator",
    slug: "alpha",
    ...overrides,
  };
  return validated(membership, (value) =>
    accountOrganizationsResponseSchema.parse({ organizations: [value] }),
  );
}

export function buildAccountSecurityResponse(passwordSet: boolean, requestId: string) {
  return validated({ passwordSet, requestId }, (value) =>
    accountSecurityResponseSchema.parse(value),
  );
}

export function buildAuthStatus(
  overrides: Partial<OrganizationAuthStatusResponse> = {},
): OrganizationAuthStatusResponse {
  const mfaRequired = overrides.mfaRequired ?? false;
  const mfaVerifiedUntil = overrides.mfaVerifiedUntil ?? null;
  const mfaSatisfiedBy =
    overrides.mfaSatisfiedBy !== undefined
      ? overrides.mfaSatisfiedBy
      : !mfaRequired
        ? null
        : mfaVerifiedUntil
          ? "totp"
          : null;
  const mfaSatisfied =
    overrides.mfaSatisfied ??
    (!mfaRequired || mfaSatisfiedBy === "passkey" || Boolean(mfaVerifiedUntil));

  const status: OrganizationAuthStatusResponse = {
    mfaRequired,
    mfaSatisfied,
    mfaSatisfiedBy,
    mfaVerifiedUntil,
    organizationId: organizationAlphaId,
    requestId: "55555555-5555-4555-8555-555555555555",
    role: "administrator",
    twoFactorEnabled: false,
    twoFactorVerified: false,
    ...overrides,
  };
  return validated(status, (value) => organizationAuthStatusResponseSchema.parse(value));
}

export function buildModuleStateResponse(moduleIds: readonly string[]) {
  return validated({ modules: moduleIds.map((id) => ({ enabled: true, id })) }, (value) =>
    moduleStatesResponseSchema.parse(value),
  );
}

export function buildSetupStatusResponse(
  overrides: { organizationId?: string; organizationName?: string } = {},
) {
  return validated(
    {
      allModulesConfigured: true,
      completedSteps: [],
      currentStep: null,
      launched: true,
      organizationId: overrides.organizationId ?? organizationAlphaId,
      organizationName: overrides.organizationName ?? "Organization Alpha",
    },
    (value) => setupStatusSchema.parse(value),
  );
}

export function buildPlatformMfaStatusResponse(
  overrides: {
    activePlatformAdministrator?: boolean;
    enrollmentComplete?: boolean;
    hasPasskey?: boolean;
    twoFactorEnabled?: boolean;
  } = {},
) {
  return validated(
    {
      activePlatformAdministrator: overrides.activePlatformAdministrator ?? false,
      enrollmentComplete: overrides.enrollmentComplete ?? false,
      hasPasskey: overrides.hasPasskey ?? false,
      requestId: "22222222-2222-4222-8222-222222222222",
      twoFactorEnabled: overrides.twoFactorEnabled ?? false,
    },
    (value) => platformMfaStatusResponseSchema.parse(value),
  );
}

export function buildOrganizationProfile(
  overrides: Partial<OrganizationProfile> = {},
): OrganizationProfile {
  const profile: OrganizationProfile = {
    bounceReason: "",
    createdAt: "2026-07-20T20:00:00.000Z",
    displayName: "Browser Singer",
    doNotEmail: false,
    globalStatus: "Active",
    id: fixtureIds.browserProfileId,
    isSectionLeader: false,
    lastBounceAt: "",
    notes: "",
    onBreakInactiveAt: null,
    phone: "",
    photoFileId: null,
    providerEmailSuppressed: false,
    receiveAdminNotifications: true,
    receiveAttendanceReports: true,
    receiveFinancialAlerts: false,
    receiveRsvpDeclineNotices: false,
    showInDirectory: true,
    hidden: false,
    statusChangedAt: "2026-07-20T20:00:00.000Z",
    statusChangeReason: "Initial status",
    statusIsManual: false,
    updatedAt: "2026-07-20T20:00:00.000Z",
    voicePart: "S2",
    ...overrides,
  };
  return validated(profile, (value) =>
    organizationProfilesResponseSchema.parse({ profiles: [value], requestId: validationRequestId }),
  );
}

export function buildUnexpectedProfile(): OrganizationProfile {
  return buildOrganizationProfile({
    displayName: "Unexpected Singer",
    id: fixtureIds.unexpectedProfileId,
    voicePart: "A1",
  });
}

export function buildUnassignedProfile(): OrganizationProfile {
  return buildOrganizationProfile({
    displayName: "Unassigned Singer",
    id: fixtureIds.unassignedProfileId,
    voicePart: "",
  });
}

export function buildMemberProfile(overrides: Partial<MemberProfile> = {}): MemberProfile {
  const profile: MemberProfile = {
    displayName: "Browser Singer",
    email: "browser.singer@example.test",
    globalStatus: "Active",
    id: fixtureIds.browserProfileId,
    phone: "555-0100",
    photoFileId: null,
    showInDirectory: true,
    voicePart: "S2",
    ...overrides,
  };
  return validated(profile, (value) => memberProfileSchema.parse(value));
}

export function buildDirectoryProfile(
  overrides: Partial<OrganizationDirectoryProfile> = {},
): OrganizationDirectoryProfile {
  const profile: OrganizationDirectoryProfile = {
    displayName: "Browser Singer",
    email: "browser.singer@example.test",
    id: fixtureIds.browserProfileId,
    phone: "555-0100",
    photoFileId: null,
    voicePart: "S2",
    ...overrides,
  };
  return validated(profile, (value) =>
    organizationDirectoryResponseSchema.parse({
      profiles: [value],
      requestId: validationRequestId,
    }),
  );
}

export function buildDirectoryAltoProfile(): OrganizationDirectoryProfile {
  return buildDirectoryProfile({
    displayName: "Directory Alto",
    email: "directory.alto@example.test",
    id: fixtureIds.directoryAltoId,
    phone: "555-0200",
    voicePart: "A1",
  });
}

export function buildVenue(overrides: Partial<OrganizationVenue> = {}): OrganizationVenue {
  const venue: OrganizationVenue = {
    address: "100 Browser Way",
    createdAt: "2026-07-20T20:00:00.000Z",
    id: fixtureIds.venueId,
    name: "Browser Hall",
    updatedAt: "2026-07-20T20:00:00.000Z",
    ...overrides,
  };
  return validated(venue, (value) =>
    organizationVenuesResponseSchema.parse({ requestId: validationRequestId, venues: [value] }),
  );
}

export function buildVenueDeleteResponse(venueId: string, requestId: string) {
  return validated({ requestId, status: "deleted", venueId }, (value) =>
    organizationVenueDeleteResponseSchema.parse(value),
  );
}

export function buildOrganizationEvent(
  overrides: Partial<OrganizationEvent> = {},
): OrganizationEvent {
  const event: OrganizationEvent = {
    advancePriceCents: 1000,
    callTime: "18:00",
    createdAt: "2026-07-20T20:00:00.000Z",
    dayOfPriceCents: 1200,
    details: "Black folders",
    doorsOpenTime: "17:30",
    durationMinutes: 150,
    id: fixtureIds.concertEventId,
    isCanceled: false,
    isTicketingEnabled: true,
    location: "",
    parentPerformanceId: null,
    publicDetails: "A Browser Concert for the choir.",
    publicGraphicFileId: null,
    publishOnWebsite: true,
    rsvpDeadlineAt: "2027-08-13T23:59:59.000Z",
    rsvpDeadlineDate: "2027-08-13",
    rsvpDeadlinePassed: true,
    rsvpFollowUpLeadHours: null,
    rsvpFollowUpMode: "inherit",
    rsvpSelfServiceOpen: false,
    setList: [{ title: "Finale" }],
    setListApproved: true,
    setListDefaultTransitionSeconds: 0,
    startsAt: "2027-08-20T23:00:00.000Z",
    ticketCapacity: 100,
    title: "Browser Concert",
    type: "Performance",
    updatedAt: "2026-07-20T20:00:00.000Z",
    venueId: null,
    ...overrides,
  };
  return validated(event, (value) =>
    organizationEventsResponseSchema.parse({ events: [value], requestId: validationRequestId }),
  );
}

export function buildAttendanceRow(
  overrides: Partial<OrganizationAttendanceRow> = {},
): OrganizationAttendanceRow {
  const row: OrganizationAttendanceRow = {
    attendance: "Pending",
    displayName: "Browser Singer",
    profileId: fixtureIds.browserProfileId,
    rsvp: "Yes",
    updatedAt: "2026-07-20T20:10:00.000Z",
    voicePart: "S2",
    ...overrides,
  };
  return validated(row, (value) =>
    organizationAttendanceResponseSchema.parse({
      eventId: fixtureIds.concertEventId,
      requestId: validationRequestId,
      rows: [value],
    }),
  );
}

export function buildUnexpectedAttendanceRow(): OrganizationAttendanceRow {
  return buildAttendanceRow({
    displayName: "Unexpected Singer",
    profileId: fixtureIds.unexpectedProfileId,
    rsvp: "Pending",
    voicePart: "A1",
  });
}

export function buildUnassignedAttendanceRow(): OrganizationAttendanceRow {
  return buildAttendanceRow({
    displayName: "Unassigned Singer",
    profileId: fixtureIds.unassignedProfileId,
    rsvp: "Pending",
    voicePart: "",
  });
}

export function buildRsvpHistoryEntry(
  overrides: Partial<OrganizationEventRsvpHistoryEntry> = {},
): OrganizationEventRsvpHistoryEntry {
  const entry: OrganizationEventRsvpHistoryEntry = {
    actorType: "organization_member",
    automatic: false,
    displayName: "Browser Singer",
    eventId: fixtureIds.concertEventId,
    newRsvp: "Yes",
    occurredAt: "2026-07-20T20:10:00.000Z",
    previousRsvp: "Pending",
    profileId: fixtureIds.browserProfileId,
    reason: "Member updated RSVP.",
    ...overrides,
  };
  return validated(entry, (value) =>
    organizationEventRsvpHistoryResponseSchema.parse({
      entries: [value],
      eventId: fixtureIds.concertEventId,
    }),
  );
}

export function buildCalendarSettingsResponse(timezone = "America/New_York") {
  return validated({ requestId: defaultFixtureRequestId, timezone }, (value) =>
    organizationCalendarSettingsResponseSchema.parse(value),
  );
}

export function buildRosterConfigurationResponse() {
  return validated(
    {
      requestId: defaultFixtureRequestId,
      sections: [
        { code: "S", color: "#1b4d3e", name: "Sopranos", trackOnly: false },
        { code: "A", color: "#4a7c59", name: "Altos", trackOnly: false },
      ],
      voiceParts: [
        { fullName: "Soprano 1", label: "S1", sectionCode: "S" },
        { fullName: "Soprano 2", label: "S2", sectionCode: "S" },
        { fullName: "Alto 1", label: "A1", sectionCode: "A" },
      ],
    },
    (value) => organizationRosterConfigurationResponseSchema.parse(value),
  );
}

export function buildSeatingConfiguration() {
  return validated(
    {
      defaultFormationId: "columns-standard",
      formations: [
        {
          id: "columns-standard",
          isVoicePartLayout: false,
          name: "Standard Columns",
          sectionOrder: ["S", "A"],
          strategy: "vertical_column",
        },
      ],
    },
    (value) => seatingConfigurationRequestSchema.parse(value),
  );
}

export function buildSeatingConfigurationResponse() {
  return validated(
    { configuration: buildSeatingConfiguration(), requestId: defaultFixtureRequestId },
    (value) => seatingConfigurationResponseSchema.parse(value),
  );
}

export function buildSeatingChart(
  overrides: Partial<OrganizationSeatingChart> = {},
): OrganizationSeatingChart {
  const chart: OrganizationSeatingChart = {
    assignments: { "0-0": fixtureIds.browserProfileId },
    createdAt: "2026-07-20T20:00:00.000Z",
    eventId: fixtureIds.concertEventId,
    formationId: "columns-standard",
    id: fixtureIds.memberChartId,
    name: "Member Chart",
    rowCounts: [2],
    sectionSuggestions: { "0-0": "S", "0-1": "A" },
    sortOrder: 0,
    updatedAt: "2026-07-20T20:15:00.000Z",
    venueId: null,
    ...overrides,
  };
  return validated(chart, (value) =>
    organizationSeatingChartsResponseSchema.parse({
      charts: [value],
      requestId: validationRequestId,
    }),
  );
}

export function buildSingerEvent(overrides: Partial<SingerEvent> = {}): SingerEvent {
  const event: SingerEvent = {
    attendanceWarning: null,
    callTime: "18:00",
    details: "Concert black",
    directRsvp: "Yes",
    durationMinutes: 150,
    featuredAssignments: [],
    id: fixtureIds.concertEventId,
    inheritedFromParent: false,
    location: "Browser Hall",
    practice: { sourceEventId: null, status: "not_published", trackCount: 0 },
    resolvedRsvp: "Yes",
    rsvpDeadlineAt: "2027-08-13T23:59:59.000Z",
    rsvpDeadlineDate: "2027-08-13",
    rsvpDeadlinePassed: true,
    rsvpNote: "",
    rsvpSelfServiceOpen: false,
    seating: { status: "not_published" },
    setList: [],
    startsAt: "2027-08-20T23:00:00.000Z",
    title: "Browser Concert",
    type: "Performance",
    venueAddress: "100 Browser Way",
    venueName: "Browser Hall",
    ...overrides,
  };
  return validated(event, (value) =>
    singerEventsResponseSchema.parse({
      events: [value],
      profileId: fixtureIds.browserProfileId,
      requestId: validationRequestId,
      timezone: "America/New_York",
    }),
  );
}

export function buildRehearsalSingerEvent(): SingerEvent {
  return buildSingerEvent({
    callTime: "18:00",
    details: "Black folders",
    directRsvp: "Pending",
    durationMinutes: 120,
    id: fixtureIds.rehearsalEventId,
    inheritedFromParent: true,
    location: "Choir Room",
    resolvedRsvp: "Yes",
    rsvpDeadlineAt: null,
    rsvpDeadlineDate: null,
    rsvpDeadlinePassed: false,
    rsvpSelfServiceOpen: true,
    startsAt: "2026-08-19T23:00:00.000Z",
    title: "My Rehearsal",
    type: "Rehearsal",
    venueAddress: "",
    venueName: "",
  });
}

export function buildSingerEventsResponse(
  events: readonly SingerEvent[],
  options: { profileId?: string; requestId?: string; timezone?: string } = {},
) {
  return validated(
    {
      events: [...events],
      profileId: options.profileId ?? fixtureIds.browserProfileId,
      requestId: options.requestId ?? defaultFixtureRequestId,
      timezone: options.timezone ?? "America/New_York",
    },
    (value) => singerEventsResponseSchema.parse(value),
  );
}

export function buildSingerSeatingResponse() {
  const payload = {
    charts: [buildSeatingChart()],
    profiles: [
      {
        displayName: "Browser Singer",
        id: fixtureIds.browserProfileId,
        voicePart: "S2",
      },
    ],
    requestId: defaultFixtureRequestId,
    selfProfileId: fixtureIds.browserProfileId,
  };
  return validated(payload, (value) => singerSeatingResponseSchema.parse(value));
}

export function buildSingerDashboardResponse(
  overrides: Partial<MemberDashboardResponse> = {},
): MemberDashboardResponse {
  const dashboard: MemberDashboardResponse = {
    activeSeason: null,
    activeSeasonState: "disabled",
    bulletins: [],
    bulletinsState: "disabled",
    events: [],
    modules: [],
    organizationName: "Organization Alpha",
    performerLabel: "Singer",
    polls: [],
    pollsState: "disabled",
    profile: {
      displayName: "Browser Singer",
      id: fixtureIds.browserProfileId,
      voicePart: "S2",
    },
    profileLinkRequired: false,
    requestId: defaultFixtureRequestId,
    resources: [],
    resourcesState: "disabled",
    timezone: "America/New_York",
    ...overrides,
  };
  return validated(dashboard, (value) => memberDashboardResponseSchema.parse(value));
}

export function buildDonation(overrides: Partial<DonationRecord> = {}): DonationRecord {
  const donation: DonationRecord = {
    amountCents: 2500,
    anonymous: false,
    buyerEmail: "dana.donor@example.test",
    buyerName: "Dana Donor",
    createdAt: "2026-07-21T20:00:00.000Z",
    expiredAt: null,
    feeCents: 50,
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    marketingConsent: false,
    patronId: null,
    paymentMethod: "stripe",
    paymentReference: "",
    processorFeeCents: null,
    processorFeeReconciledAt: null,
    providerBalanceTransactionId: null,
    refundRequested: false,
    status: "paid",
    thankYouSentAt: null,
    tributeName: "",
    tributeNotifyEmail: "",
    tributeType: "none",
    updatedAt: "2026-07-21T20:00:00.000Z",
    ...overrides,
  };
  return validated(donation, (value) =>
    donationRecordsResponseSchema.parse({ donations: [value], requestId: validationRequestId }),
  );
}

export function buildMemberEmailChangeResponse(email: string, requestId: string) {
  return validated({ email, requestId, status: "pending" }, (value) =>
    memberEmailChangeResponseSchema.parse(value),
  );
}

export function buildMemberEmailChangeConfirmationResponse(email: string, requestId: string) {
  return validated({ email, requestId, status: "confirmed" }, (value) =>
    memberEmailChangeConfirmationResponseSchema.parse(value),
  );
}

export function buildInvitationDetails(
  overrides: Partial<OrganizationInvitationDetails> = {},
): OrganizationInvitationDetails {
  const details: OrganizationInvitationDetails = {
    email: "invited.member@example.test",
    expiresAt: "2026-07-22T08:00:00.000Z",
    id: "77777777-7777-4777-8777-777777777777",
    inviterEmail: "owner@example.test",
    organizationId: organizationAlphaId,
    organizationName: "Organization Alpha",
    organizationSlug: "alpha",
    role: "member",
    status: "pending",
    ...overrides,
  };
  return validated(details, (value) => organizationInvitationDetailsSchema.parse(value));
}

export function buildInvitationSummary(
  overrides: Partial<OrganizationInvitationSummary> = {},
): OrganizationInvitationSummary {
  const summary: OrganizationInvitationSummary = {
    createdAt: "2026-07-20T08:00:00.000Z",
    email: "future.member@example.test",
    expiresAt: "2026-07-22T08:00:00.000Z",
    id: "77777777-7777-4777-8777-777777777777",
    role: "administrator",
    status: "pending",
    ...overrides,
  };
  return validated(summary, (value) =>
    organizationInvitationsResponseSchema.parse({
      invitations: [value],
      requestId: validationRequestId,
      truncated: false,
    }),
  );
}

export function buildInvitationActionResponse(
  id: string,
  status: "accepted" | "canceled" | "rejected",
  requestId: string,
) {
  return validated({ id, requestId, status }, (value) =>
    organizationInvitationActionResponseSchema.parse(value),
  );
}

export function buildInvitationCreateResponse(id: string, requestId: string) {
  return validated(
    { expiresAt: "2026-07-22T08:00:00.000Z", id, requestId, status: "pending" },
    (value) => organizationInvitationResponseSchema.parse(value),
  );
}

export function buildOrganizationMfaPolicyResponse(mfaRequired: boolean, requestId: string) {
  return validated({ mfaRequired, organizationId: organizationAlphaId, requestId }, (value) =>
    organizationMfaPolicyResponseSchema.parse(value),
  );
}

export function buildOrganizationMfaVerificationResponse(expiresAt: string, requestId: string) {
  return validated(
    { expiresAt, organizationId: organizationAlphaId, requestId, status: "verified" },
    (value) => organizationMfaVerificationResponseSchema.parse(value),
  );
}

export function buildPlatformMfaEnrollmentResponse(backupCodes: readonly string[]) {
  return validated(
    {
      backupCodes: [...backupCodes],
      totpURI:
        "otpauth://totp/Choir%20Management:invited.member%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Choir%20Management",
    },
    (value) => platformMfaEnrollmentResponseSchema.parse(value),
  );
}

export function buildPlatformContextResponse(
  scope: { kind: "product_base" } | { kind: "organization"; organizationId: string },
  userId: string,
  mfaMethod: "passkey" | "recovery_code" | "totp" = "totp",
) {
  return validated(
    {
      mfaMethod,
      mfaVerifiedUntil: "2026-07-20T20:15:00.000Z",
      requestId: "33333333-3333-4333-8333-333333333333",
      scope,
      userId,
    },
    (value) => platformContextResponseSchema.parse(value),
  );
}

export function buildPlatformOrganizationContextResponse(options: {
  canEdit: boolean;
  elevationExpiresAt?: string | null;
  elevationId?: string | null;
  organizationId?: string;
  userId: string;
}) {
  return validated(
    {
      canEdit: options.canEdit,
      elevationExpiresAt: options.elevationExpiresAt ?? null,
      elevationId: options.elevationId ?? null,
      organizationId: options.organizationId ?? organizationAlphaId,
      requestId: "33333333-3333-4333-8333-333333333333",
      userId: options.userId,
    },
    (value) => platformOrganizationContextResponseSchema.parse(value),
  );
}

export function buildPlatformElevationRevocationResponse(elevationId: string) {
  return validated({ elevationId, status: "revoked" }, (value) =>
    platformElevationRevocationResponseSchema.parse(value),
  );
}

export function buildPlatformOrganizationsResponse() {
  return validated(
    {
      nextCursor: null,
      organizations: [],
      requestId: "33333333-3333-4333-8333-333333333333",
    },
    (value) => platformOrganizationsResponseSchema.parse(value),
  );
}

export function buildPlatformOrganizationPublicDomainsResponse() {
  return validated(
    {
      domains: [],
      requestId: "33333333-3333-4333-8333-333333333333",
    },
    (value) => platformOrganizationPublicDomainsResponseSchema.parse(value),
  );
}

export function buildPlatformOrganizationStripeConnectResponse(
  organizationId = organizationAlphaId,
) {
  return validated(
    {
      accountId: null,
      activations: { donations: false, dues: false, tickets: false },
      eligibleForReset: false,
      hasPaymentHistory: false,
      hasPendingPayments: false,
      ineligibilityReason: "No Stripe account is connected.",
      organizationId,
      requestId: "33333333-3333-4333-8333-333333333333",
      status: "not_started" as const,
    },
    (value) => platformStripeConnectStatusResponseSchema.parse(value),
  );
}

export function buildOrganizationProvisionResponse() {
  return validated(
    {
      canonicalHostname: "staging-choir.example.test",
      canonicalStatus: "pending",
      lifecycleState: "provisioning",
      organizationId: "99999999-9999-4999-8999-999999999999",
      requestId: "33333333-3333-4333-8333-333333333333",
      workflowId: "organization-provision-browser-test",
    },
    (value) => organizationProvisionResponseSchema.parse(value),
  );
}

export function buildPlatformDeadLettersResponse() {
  return validated(
    {
      deadLetters: [],
      nextCursor: null,
      requestId: "33333333-3333-4333-8333-333333333333",
    },
    (value) => platformJobDeadLettersResponseSchema.parse(value),
  );
}

export function buildFleetSchemaStatusResponse(running: boolean) {
  return validated(
    {
      currentVersion: 5,
      preparation: running
        ? {
            completedAt: null,
            processedCount: 0,
            runId: "77777777-7777-4777-8777-777777777777",
            startedAt: "2026-07-21T18:00:00.000Z",
            status: "running",
            targetVersion: 5,
            updatedAt: "2026-07-21T18:00:00.000Z",
            workflowId: "fleet-schema-browser-test-0",
          }
        : null,
      requestId: "33333333-3333-4333-8333-333333333333",
    },
    (value) => platformFleetSchemaStatusResponseSchema.parse(value),
  );
}

export function buildCalendarFeedUrlsResponse(token: string, requestId: string) {
  return validated(
    {
      expiresAt: "2036-07-20T08:00:00.000Z",
      httpsUrl: `http://alpha.localhost/api/calendar/feed?token=${token}`,
      requestId,
      webcalUrl: `webcal://alpha.localhost/api/calendar/feed?token=${token}`,
    },
    (value) => calendarFeedUrlsResponseSchema.parse(value),
  );
}

export function buildOrganizationProviderStatusResponse() {
  return validated(
    {
      brevo: { detail: "Provider not configured for browser tests.", status: "error" },
      emailSender: { fromEmail: null, fromName: null },
      environment: "local",
      externalEffectsMode: "disabled",
      requestId: defaultFixtureRequestId,
      stripe: { detail: "Provider not configured for browser tests.", status: "error" },
    },
    (value) => organizationProviderStatusResponseSchema.parse(value),
  );
}

export function buildOrganizationStripeConnectStatusResponse() {
  return validated(
    {
      platformConfigured: false,
      requestId: defaultFixtureRequestId,
      stripe: {
        accountId: null,
        chargesEnabled: false,
        detailsSubmitted: false,
        payoutsEnabled: false,
        requirementsDue: [],
        status: "not_started",
      },
    },
    (value) => organizationStripeConnectStatusResponseSchema.parse(value),
  );
}

/** Mutable per-test fixture state. Builders stay immutable; handles own the mutation. */
export function createMutableState<T>(initial: T) {
  let current = initial;
  return {
    get(): T {
      return current;
    },
    set(next: T): void {
      current = next;
    },
    update(patch: Partial<T>): void {
      current = { ...current, ...patch };
    },
  };
}

export type MutableState<T> = ReturnType<typeof createMutableState<T>>;
