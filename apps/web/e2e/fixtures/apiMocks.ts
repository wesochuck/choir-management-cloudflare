import { expect, type Page } from "@playwright/test";
import {
  donationResponseSchema,
  donationThankYouUpdateRequestSchema,
  manualDonationCreateRequestSchema,
  organizationAttendanceBulkRequestSchema,
  seatingConfigurationRequestSchema,
  type AccountOrganization,
  type DonationRecord,
  type MemberDashboardResponse,
  type MemberProfile,
  type OrganizationAttendanceRow,
  type OrganizationEvent,
  type OrganizationProfile,
  type OrganizationSeatingChart,
  type SingerEvent,
} from "@choir/contracts";
import {
  buildAttendanceRow,
  buildCalendarSettingsResponse,
  buildDirectoryAltoProfile,
  buildDonation,
  buildMemberProfile,
  buildOrganizationEvent,
  buildOrganizationMfaPolicyResponse,
  buildOrganizationMfaVerificationResponse,
  buildOrganizationProfile,
  buildOrganizationProvisionResponse,
  buildPlatformOrganizationPublicDomainsResponse,
  buildFleetSchemaStatusResponse,
  buildPlatformContextResponse,
  buildPlatformDeadLettersResponse,
  buildPlatformElevationRevocationResponse,
  buildPlatformMfaEnrollmentResponse,
  buildPlatformMfaStatusResponse,
  buildPlatformOrganizationContextResponse,
  buildPlatformOrganizationsResponse,
  buildRehearsalSingerEvent,
  buildRosterConfigurationResponse,
  buildRsvpHistoryEntry,
  buildSeatingChart,
  buildSeatingConfiguration,
  buildSingerEvent,
  buildSingerSeatingResponse,
  buildUnassignedAttendanceRow,
  buildUnassignedProfile,
  buildUnexpectedAttendanceRow,
  buildUnexpectedProfile,
  buildVenue,
  buildVenueDeleteResponse,
  createMutableState,
  defaultFixtureRequestId,
  fixtureIds,
  organizationAlphaId,
  type MutableState,
} from "./builders";
import {
  fulfillJson,
  installSessionShell,
  type SessionShell,
  type SessionUserOverrides,
} from "./session";
import {
  installInvitationMocks,
  installOrganizationShell,
  type InvitationMocks,
  type OrganizationRole,
  type OrganizationShell,
} from "./organization";

export type { OrganizationRole };

export interface StrictGuard {
  readonly unexpectedRequests: readonly string[];
  assertNoUnexpectedRequests(): void;
}

/**
 * Standalone strict mock scope for specs that compose smaller installs instead of
 * installOrganizationApi. Register first: later spec routes shadow the guard, so only genuinely
 * unmocked app `/api/**` requests are recorded (served 404) and reported by the assertion.
 */
export async function installStrictGuard(page: Page): Promise<StrictGuard> {
  const unexpectedRequests: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    unexpectedRequests.push(`${route.request().method()} ${url.pathname}${url.search}`);
    await fulfillJson(route, { requestId: defaultFixtureRequestId }, 404);
  });
  return {
    assertNoUnexpectedRequests: () => {
      expect(
        unexpectedRequests,
        `Unexpected app API requests escaped the mocked fixture boundary: ${unexpectedRequests.join(", ")}. ` +
          `Register them in apps/web/e2e/fixtures/ or mark the suite non-strict (see fixtures README).`,
      ).toEqual([]);
    },
    unexpectedRequests,
  };
}

export interface OrganizationApiOptions {
  readonly role?: OrganizationRole;
  readonly modules?: readonly string[];
  readonly organizationId?: string;
  readonly memberships?: readonly AccountOrganization[];
  readonly user?: SessionUserOverrides;
  readonly initiallySignedIn?: boolean;
  /**
   * Strict mock scope: any app `/api/**` request that reaches no registered mock is recorded
   * and served a 404. Finish the test with `await api.assertNoUnexpectedRequests()` to fail on
   * leaks. Register spec-specific routes after install: later registrations shadow the guard.
   */
  readonly strict?: boolean;
}

export interface OrganizationApi {
  readonly session: SessionShell;
  readonly organization: OrganizationShell;
  readonly invitations: InvitationMocks["invitations"];
  readonly profiles: MutableState<OrganizationProfile[]>;
  readonly memberProfile: MutableState<MemberProfile>;
  readonly events: MutableState<OrganizationEvent[]>;
  readonly attendanceRows: MutableState<Map<string, OrganizationAttendanceRow>>;
  readonly seatingCharts: MutableState<OrganizationSeatingChart[]>;
  readonly seatingConfiguration: MutableState<ReturnType<typeof buildSeatingConfiguration>>;
  readonly singerEvents: MutableState<SingerEvent[]>;
  readonly donations: MutableState<DonationRecord[]>;
  readonly unexpectedRequests: readonly string[];
  assertNoUnexpectedRequests(): void;
  setSingerDashboard(response: MemberDashboardResponse | null): void;
}

/**
 * Full mocked workspace: session shell + organization shell + the roster/events/attendance/
 * seating/singer collections previously inlined in every large spec, plus donation and member
 * dashboard handles. Feature specs express only the behavior that differs for that test, e.g.
 * `api.donations.set([buildDonation({ buyerName: "Ada Donor" })])`.
 *
 * Served bytes for fixture-defined payloads are identical to the pre-extraction specs; every
 * builder validates through its contract schema so drift fails at fixture definition.
 * Request-driven echo routes (PUT/POST handlers reflecting the browser body) are intentionally
 * not schema-validated: their shape is owned by the live request.
 */
export async function installOrganizationApi(
  page: Page,
  options: OrganizationApiOptions = {},
): Promise<OrganizationApi> {
  const guard = options.strict ? await installStrictGuard(page) : null;

  const session = await installSessionShell(page, {
    initiallySignedIn: options.initiallySignedIn,
    user: options.user,
  });
  const organization = await installOrganizationShell(page, {
    memberships: options.memberships,
    modules: options.modules,
    organizationId: options.organizationId ?? organizationAlphaId,
    role: options.role,
  });
  const { invitations } = await installInvitationMocks(page, {});

  const requestId = "99999999-9999-4999-8999-999999999999";
  const profiles = createMutableState<OrganizationProfile[]>([
    buildOrganizationProfile({}),
    buildUnexpectedProfile(),
  ]);
  const memberProfile = createMutableState<MemberProfile>(buildMemberProfile({}));
  const events = createMutableState<OrganizationEvent[]>([buildOrganizationEvent({})]);
  const attendanceRows = createMutableState<Map<string, OrganizationAttendanceRow>>(
    new Map([
      [fixtureIds.browserProfileId, buildAttendanceRow({})],
      [fixtureIds.unexpectedProfileId, buildUnexpectedAttendanceRow()],
    ]),
  );
  const seatingCharts = createMutableState<OrganizationSeatingChart[]>([]);
  const seatingConfiguration = createMutableState(buildSeatingConfiguration());
  const singerEvents = createMutableState<SingerEvent[]>([
    buildSingerEvent({}),
    buildRehearsalSingerEvent(),
  ]);
  const donations = createMutableState<DonationRecord[]>([]);
  let singerDashboard: MemberDashboardResponse | null = null;

  // Mutable platform MFA status shadowing the shell default so TOTP lifecycle tests can flip it.
  const platformMfaState = createMutableState({
    activePlatformAdministrator: false,
    enrollmentComplete: false,
    twoFactorEnabled: false,
  });
  await page.route("**/api/platform/mfa/status", async (route) => {
    await fulfillJson(route, { ...platformMfaState.get(), requestId });
  });
  const organizationRecoveryCodes = Array.from(
    { length: 10 },
    (_, index) => `organization-recovery-${String(index + 1).padStart(2, "0")}`,
  );
  await page.route("**/api/auth/two-factor/enable", async (route) => {
    await fulfillJson(route, buildPlatformMfaEnrollmentResponse(organizationRecoveryCodes));
  });
  await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
    platformMfaState.update({ twoFactorEnabled: true });
    organization.authStatus.update({ twoFactorEnabled: true, twoFactorVerified: true });
    await fulfillJson(route, { status: true });
  });
  await page.route("**/api/organization/mfa/verify", async (route) => {
    const expiresAt = "2026-07-21T08:00:00.000Z";
    organization.authStatus.update({ mfaVerifiedUntil: expiresAt });
    await fulfillJson(route, buildOrganizationMfaVerificationResponse(expiresAt, requestId));
  });
  const mfaPolicyState = createMutableState({ mfaRequired: false });
  await page.route("**/api/organization/auth-policy", async (route) => {
    const next = !mfaPolicyState.get().mfaRequired;
    mfaPolicyState.set({ mfaRequired: next });
    organization.authStatus.update({ mfaRequired: next, mfaVerifiedUntil: null });
    await fulfillJson(
      route,
      buildOrganizationMfaPolicyResponse(next, "55555555-5555-4555-8555-555555555555"),
    );
  });

  await page.route("**/api/organization/profiles", async (route) => {
    const base = profiles.get();
    await fulfillJson(route, {
      profiles: page.url().includes("/admin/rsvp") ? [...base, buildUnassignedProfile()] : base,
      requestId,
    });
  });
  await page.route("**/api/organization/profiles/*", async (route) => {
    const body: unknown = route.request().postDataJSON();
    await fulfillJson(route, {
      ...(typeof body === "object" && body !== null ? body : {}),
      createdAt: "2026-07-20T20:00:00.000Z",
      id: fixtureIds.browserProfileId,
      requestId,
      updatedAt: "2026-07-20T20:15:00.000Z",
    });
  });
  await page.route("**/api/singer/profile", async (route) => {
    if (route.request().method() === "PUT") {
      const body: unknown = route.request().postDataJSON();
      if (typeof body === "object" && body !== null) {
        const update = Object.fromEntries(Object.entries(body));
        memberProfile.update({
          displayName:
            typeof update.displayName === "string"
              ? update.displayName
              : memberProfile.get().displayName,
          phone: typeof update.phone === "string" ? update.phone : memberProfile.get().phone,
          showInDirectory:
            typeof update.showInDirectory === "boolean"
              ? update.showInDirectory
              : memberProfile.get().showInDirectory,
        });
      }
    }
    await fulfillJson(route, { ...memberProfile.get(), requestId });
  });
  await page.route("**/api/singer/directory", async (route) => {
    const current = memberProfile.get();
    await fulfillJson(route, {
      profiles: [
        ...(current.showInDirectory
          ? [
              {
                displayName: current.displayName,
                email: current.email,
                id: current.id,
                phone: current.phone,
                voicePart: current.voicePart,
              },
            ]
          : []),
        buildDirectoryAltoProfile(),
      ],
      requestId,
    });
  });
  await page.route("**/api/organization/venues", async (route) => {
    await fulfillJson(route, { requestId, venues: [buildVenue({})] });
  });
  await page.route("**/api/organization/venues/*", async (route) => {
    await fulfillJson(route, buildVenueDeleteResponse(fixtureIds.venueId, requestId));
  });
  await page.route("**/api/organization/events", async (route) => {
    await fulfillJson(route, { events: events.get(), requestId });
  });
  await page.route("**/api/organization/events/*/attendance", async (route) => {
    if (route.request().method() === "PUT") {
      const body: unknown = route.request().postDataJSON();
      const parsed = organizationAttendanceBulkRequestSchema.safeParse(body);
      // Mirror the pre-extraction mock: only the first update in a batch is applied. The
      // attendance manager issues follow-up requests for the remaining rows, and the split
      // specs assert the intermediate single-row states.
      const update = parsed.success ? parsed.data.updates[0] : undefined;
      if (update) {
        const current = attendanceRows.get().get(update.profileId);
        if (current) {
          attendanceRows.get().set(update.profileId, {
            ...current,
            attendance: update.attendance,
            rsvp: update.attendance === "Present" ? "Yes" : current.rsvp,
          });
        }
      }
    }
    await fulfillJson(route, {
      eventId: fixtureIds.concertEventId,
      requestId,
      rows: page.url().includes("/admin/rsvp")
        ? [...attendanceRows.get().values(), buildUnassignedAttendanceRow()]
        : [...attendanceRows.get().values()],
    });
  });
  await page.route("**/api/organization/events/*/rsvp-history", async (route) => {
    await fulfillJson(route, {
      entries: [
        buildRsvpHistoryEntry({}),
        buildRsvpHistoryEntry({
          actorType: "system",
          automatic: true,
          displayName: "Unexpected Singer",
          newRsvp: "No",
          occurredAt: "2026-07-20T20:05:00.000Z",
          profileId: fixtureIds.unexpectedProfileId,
          reason: "RSVP deadline passed.",
        }),
      ],
      eventId: fixtureIds.concertEventId,
      requestId,
    });
  });
  await page.route("**/api/organization/calendar-settings", async (route) => {
    await fulfillJson(route, buildCalendarSettingsResponse());
  });
  await page.route("**/api/organization/roster-configuration", async (route) => {
    const configuration =
      route.request().method() === "PUT"
        ? route.request().postDataJSON()
        : buildRosterConfigurationResponse();
    await fulfillJson(route, {
      ...(typeof configuration === "object" && configuration !== null ? configuration : {}),
      requestId,
    });
  });
  await page.route("**/api/organization/seating-configuration", async (route) => {
    if (route.request().method() === "PUT") {
      const parsed = seatingConfigurationRequestSchema.safeParse(route.request().postDataJSON());
      if (parsed.success) {
        seatingConfiguration.set(parsed.data);
      }
    }
    await fulfillJson(route, {
      configuration: seatingConfiguration.get(),
      requestId,
    });
  });
  await page.route("**/api/organization/events/*/seating-charts**", async (route) => {
    if (route.request().url().endsWith("/order")) {
      const body: unknown = route.request().postDataJSON();
      const chartIds =
        typeof body === "object" &&
        body !== null &&
        "chartIds" in body &&
        Array.isArray(body.chartIds)
          ? body.chartIds.filter((value): value is string => typeof value === "string")
          : [];
      const byId = new Map<string, OrganizationSeatingChart>(
        seatingCharts.get().map((chart) => [chart.id, chart]),
      );
      seatingCharts.set(
        chartIds.flatMap((chartId, index) => {
          const chart = byId.get(chartId);
          return chart ? [{ ...chart, sortOrder: index }] : [];
        }),
      );
      await fulfillJson(route, { charts: seatingCharts.get(), requestId });
      return;
    }
    const method = route.request().method();
    if (method === "GET") {
      await fulfillJson(route, { charts: seatingCharts.get(), requestId });
      return;
    }
    if (method === "DELETE") {
      seatingCharts.set([]);
      await fulfillJson(route, {
        chartId: fixtureIds.seatingChartId,
        requestId,
        status: "deleted",
      });
      return;
    }
    const body: unknown = route.request().postDataJSON();
    const chart = buildEchoedSeatingChart(body);
    seatingCharts.set([chart]);
    await fulfillJson(route, chart, method === "POST" ? 201 : 200);
  });
  await page.route("**/api/singer/events", async (route) => {
    await fulfillJson(route, {
      events: singerEvents.get(),
      profileId: fixtureIds.browserProfileId,
      requestId,
      timezone: "America/New_York",
    });
  });
  await page.route("**/api/singer/events/*/seating", async (route) => {
    await fulfillJson(route, buildSingerSeatingResponse());
  });
  await page.route("**/api/singer/events/*/rsvp", async (route) => {
    const body: unknown = route.request().postDataJSON();
    const rsvp =
      typeof body === "object" && body !== null && "rsvp" in body && typeof body.rsvp === "string"
        ? body.rsvp
        : "Pending";
    await fulfillJson(route, {
      eventId: fixtureIds.rehearsalEventId,
      profileId: fixtureIds.browserProfileId,
      requestId,
      rsvp,
      rsvpNote:
        typeof body === "object" &&
        body !== null &&
        "rsvpNote" in body &&
        typeof body.rsvpNote === "string" &&
        rsvp === "No"
          ? body.rsvpNote
          : "",
      updatedAt: "2026-07-20T20:10:00.000Z",
    });
  });
  await page.route("**/api/singer/calendar-feed-url**", async (route) => {
    await fulfillJson(route, { requestId }, 200);
  });
  await page.route("**/api/singer/dashboard", async (route) => {
    if (singerDashboard) {
      await fulfillJson(route, singerDashboard);
      return;
    }
    await fulfillJson(route, { requestId }, 404);
  });

  // Donations collection for finance specs, e.g. `api.donations.set([buildDonation({...})])`.
  await page.route("**/api/organization/donation-settings", async (route) => {
    await fulfillJson(route, {
      buttonText: "Give now",
      description: "Support our choir.",
      levels: [],
      requestId,
    });
  });
  await page.route("**/api/organization/patrons", async (route) => {
    await fulfillJson(route, { patrons: [], requestId });
  });
  await page.route("**/api/organization/donations", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await fulfillJson(route, { donations: donations.get(), requestId });
  });
  await page.route("**/api/organization/donations/manual", async (route) => {
    const parsed = manualDonationCreateRequestSchema.safeParse(route.request().postDataJSON());
    if (!parsed.success) {
      await fulfillJson(
        route,
        { code: "validation_failed", message: "Invalid manual donation payload.", requestId },
        400,
      );
      return;
    }
    const created = buildDonation({
      buyerEmail: parsed.data.buyerEmail,
      buyerName: parsed.data.buyerName,
      paymentMethod: parsed.data.paymentMethod,
      paymentReference: parsed.data.paymentReference,
      thankYouSentAt: parsed.data.thankYouSent ? "2026-07-23T15:00:00.000Z" : null,
    });
    donations.set([created, ...donations.get()]);
    const response = donationResponseSchema.parse({ donation: created, requestId });
    await fulfillJson(route, response, 201);
  });
  await page.route("**/api/organization/donations/thank-you", async (route) => {
    const parsed = donationThankYouUpdateRequestSchema.safeParse(route.request().postDataJSON());
    if (!parsed.success) {
      await fulfillJson(
        route,
        { code: "validation_failed", message: "Invalid thank-you update payload.", requestId },
        400,
      );
      return;
    }
    const updated = donations.get().map((donation) =>
      donation.id === parsed.data.donationId
        ? buildDonation({
            ...donation,
            thankYouSentAt: parsed.data.thankYouSent ? "2026-07-23T15:00:00.000Z" : null,
          })
        : donation,
    );
    donations.set(updated);
    const current = updated.find((donation) => donation.id === parsed.data.donationId);
    if (!current) {
      await fulfillJson(
        route,
        { code: "not_found", message: "Donation not found.", requestId },
        404,
      );
      return;
    }
    const response = donationResponseSchema.parse({ donation: current, requestId });
    await fulfillJson(route, response);
  });

  return {
    assertNoUnexpectedRequests: () => {
      guard?.assertNoUnexpectedRequests();
    },
    attendanceRows,
    donations,
    events,
    invitations,
    memberProfile,
    organization,
    profiles,
    seatingCharts,
    seatingConfiguration,
    session,
    setSingerDashboard: (response: MemberDashboardResponse | null) => {
      singerDashboard = response;
    },
    singerEvents,
    unexpectedRequests: guard?.unexpectedRequests ?? [],
  };
}

export interface PlatformAdminMocksOptions {
  readonly userId: string;
  readonly contextScope?:
    { kind: "product_base" } | { kind: "organization"; organizationId: string } | undefined;
  readonly mfaStatus?: {
    activePlatformAdministrator?: boolean;
    enrollmentComplete?: boolean;
    hasPasskey?: boolean;
    twoFactorEnabled?: boolean;
  };
  /**
   * Whether /api/platform/context requires a fresh MFA verification first (default true,
   * the enrollment journey). The scoped edit-access journey serves an already-verified
   * session, so it passes false.
   */
  readonly gatePlatformContext?: boolean;
}

/**
 * Platform administration surface for /platform/* specs: MFA enrollment/verification gates,
 * read-only/edit elevations, provisioning, queue dead letters, email suppressions, and domain
 * management.
 */
export async function installPlatformAdminMocks(
  page: Page,
  options: PlatformAdminMocksOptions,
): Promise<void> {
  const requestId = "33333333-3333-4333-8333-333333333333";
  let assertionReady = false;
  let enrollmentComplete = false;
  let twoFactorEnabled = false;
  let canEdit = false;
  let schemaPreparationStarted = false;
  const elevationId = "88888888-8888-4888-8888-888888888888";
  const recoveryCodes = Array.from(
    { length: 10 },
    (_, index) => `recovery-${String(index + 1).padStart(2, "0")}`,
  );

  await page.route("**/api/platform/mfa/status", async (route) => {
    await fulfillJson(
      route,
      buildPlatformMfaStatusResponse({
        activePlatformAdministrator: options.mfaStatus?.activePlatformAdministrator ?? true,
        enrollmentComplete: enrollmentComplete || options.mfaStatus?.enrollmentComplete === true,
        hasPasskey: options.mfaStatus?.hasPasskey ?? false,
        twoFactorEnabled: twoFactorEnabled || options.mfaStatus?.twoFactorEnabled === true,
      }),
    );
  });
  await page.route("**/api/auth/two-factor/enable", async (route) => {
    await fulfillJson(route, buildPlatformMfaEnrollmentResponse(recoveryCodes));
  });
  await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
    twoFactorEnabled = true;
    await fulfillJson(route, { status: true });
  });
  await page.route("**/api/platform/mfa/confirm-enrollment", async (route) => {
    enrollmentComplete = true;
    await fulfillJson(route, { status: "confirmed" });
  });
  await page.route("**/api/platform/mfa/verify", async (route) => {
    assertionReady = true;
    await fulfillJson(route, { expiresAt: "2026-07-20T20:15:00.000Z", status: "verified" });
  });
  await page.route("**/api/platform/context", async (route) => {
    if ((options.gatePlatformContext ?? true) && !assertionReady) {
      await fulfillJson(
        route,
        {
          code: "unauthorized",
          message: "A recent Platform Administrator MFA verification is required.",
          requestId,
        },
        401,
      );
      return;
    }
    await fulfillJson(
      route,
      buildPlatformContextResponse(
        options.contextScope ?? { kind: "product_base" },
        options.userId,
      ),
    );
  });
  await page.route("**/api/platform/organization-context", async (route) => {
    await fulfillJson(
      route,
      buildPlatformOrganizationContextResponse({
        canEdit,
        elevationExpiresAt: canEdit ? "2026-07-20T20:15:00.000Z" : null,
        elevationId: canEdit ? elevationId : null,
        userId: options.userId,
      }),
    );
  });
  await page.route("**/api/platform/elevations", async (route) => {
    if (route.request().method() !== "POST") {
      await fulfillJson(route, { requestId }, 404);
      return;
    }
    canEdit = true;
    await fulfillJson(
      route,
      {
        canEdit: true,
        elevationExpiresAt: "2026-07-20T20:15:00.000Z",
        elevationId,
        organizationId: organizationAlphaId,
        requestId,
        userId: options.userId,
      },
      201,
    );
  });
  await page.route("**/api/platform/elevations/*", async (route) => {
    canEdit = false;
    await fulfillJson(route, buildPlatformElevationRevocationResponse(elevationId));
  });
  await page.route("**/api/platform/organizations", async (route) => {
    if (route.request().method() === "POST") {
      await fulfillJson(route, buildOrganizationProvisionResponse(), 202);
      return;
    }
    await fulfillJson(route, buildPlatformOrganizationsResponse());
  });
  await page.route("**/api/platform/organizations/*/public-domains", async (route) => {
    await fulfillJson(route, buildPlatformOrganizationPublicDomainsResponse());
  });
  await page.route("**/api/platform/job-dead-letters**", async (route) => {
    await fulfillJson(route, buildPlatformDeadLettersResponse());
  });
  await page.route("**/api/platform/fleet-schema-preparation", async (route) => {
    if (route.request().method() === "POST") {
      schemaPreparationStarted = true;
    }
    await fulfillJson(
      route,
      buildFleetSchemaStatusResponse(schemaPreparationStarted),
      route.request().method() === "POST" ? 202 : 200,
    );
  });
}

function isSeatMap(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((entry): entry is string => typeof entry === "string");
}

function isRowCounts(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry): entry is number => typeof entry === "number");
}

// Request-driven echo route helper (see builders.ts): the browser owns the posted shape. Known
// chart fields are narrowed out of the live body over validated builder defaults so the served
// bytes match the pre-extraction mock without type assertions.
function buildEchoedSeatingChart(body: unknown): OrganizationSeatingChart {
  const record: Record<string, unknown> = {};
  if (typeof body === "object" && body !== null) {
    for (const [key, value] of Object.entries(body)) {
      record[key] = value;
    }
  }
  const baseChart = buildSeatingChart({
    eventId: fixtureIds.concertEventId,
    id: fixtureIds.seatingChartId,
  });
  return {
    ...baseChart,
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    ...(typeof record.formationId === "string" ? { formationId: record.formationId } : {}),
    ...(isSeatMap(record.assignments) ? { assignments: record.assignments } : {}),
    ...(isRowCounts(record.rowCounts) ? { rowCounts: record.rowCounts } : {}),
    ...(isSeatMap(record.sectionSuggestions)
      ? { sectionSuggestions: record.sectionSuggestions }
      : {}),
    ...(typeof record.sortOrder === "number" ? { sortOrder: record.sortOrder } : {}),
    ...(record.venueId === null || typeof record.venueId === "string"
      ? { venueId: record.venueId }
      : {}),
  };
}
