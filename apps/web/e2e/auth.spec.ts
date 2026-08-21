import { expect, test } from "@playwright/test";

const currentSession = {
  activeOrganizationId: null,
  createdAt: "2026-07-20T20:00:00.000Z",
  expiresAt: "2026-07-27T20:00:00.000Z",
  id: "session-current",
  ipAddress: "192.0.2.10",
  token: "current-session-token-not-displayed",
  updatedAt: "2026-07-20T20:00:00.000Z",
  userAgent: "Chromium browser",
  userId: "user-invited-member",
} as const;

const currentUser = {
  createdAt: "2026-07-20T19:00:00.000Z",
  email: "invited.member@example.test",
  emailVerified: true,
  id: "user-invited-member",
  image: null,
  name: "Invited Member",
  twoFactorEnabled: false,
  updatedAt: "2026-07-20T20:00:00.000Z",
} as const;

type BrowserAttendanceStatus = "Absent" | "Pending" | "Present";
type BrowserRsvpStatus = "No" | "Pending" | "Yes";

interface BrowserAttendanceRow {
  readonly attendance: BrowserAttendanceStatus;
  readonly displayName: string;
  readonly profileId: string;
  readonly rsvp: BrowserRsvpStatus;
  readonly updatedAt: string;
  readonly voicePart: string;
}

interface BrowserAttendanceUpdate {
  readonly attendance: BrowserAttendanceStatus;
  readonly profileId: string;
}

function isBrowserAttendanceStatus(value: unknown): value is BrowserAttendanceStatus {
  return value === "Absent" || value === "Pending" || value === "Present";
}

function parseBrowserAttendanceUpdate(value: unknown): BrowserAttendanceUpdate | null {
  if (typeof value !== "object" || value === null) return null;
  const record = Object.fromEntries(Object.entries(value));
  if (typeof record.profileId !== "string" || !isBrowserAttendanceStatus(record.attendance)) {
    return null;
  }
  return { attendance: record.attendance, profileId: record.profileId };
}

test.beforeEach(async ({ page }) => {
  const requestId = "99999999-9999-4999-8999-999999999999";
  let seatingCharts: Record<string, unknown>[] = [];
  let memberProfile = {
    displayName: "Browser Singer",
    email: "browser.singer@example.test",
    globalStatus: "Active" as const,
    id: "11111111-1111-4111-8111-111111111111",
    phone: "555-0100",
    showInDirectory: true,
    voicePart: "S2",
  };
  let seatingConfiguration: Record<string, unknown> = {
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
  };
  const attendanceRows = new Map<string, BrowserAttendanceRow>([
    [
      "11111111-1111-4111-8111-111111111111",
      {
        attendance: "Pending",
        displayName: "Browser Singer",
        profileId: "11111111-1111-4111-8111-111111111111",
        rsvp: "Yes",
        updatedAt: "2026-07-20T20:10:00.000Z",
        voicePart: "S2",
      },
    ],
    [
      "33333333-3333-4333-8333-333333333333",
      {
        attendance: "Pending",
        displayName: "Unexpected Singer",
        profileId: "33333333-3333-4333-8333-333333333333",
        rsvp: "Pending",
        updatedAt: "2026-07-20T20:10:00.000Z",
        voicePart: "A1",
      },
    ],
  ]);
  const unassignedRsvpRow: BrowserAttendanceRow = {
    attendance: "Pending",
    displayName: "Unassigned Singer",
    profileId: "44444444-4444-4444-8444-444444444444",
    rsvp: "Pending",
    updatedAt: "2026-07-20T20:10:00.000Z",
    voicePart: "",
  };
  await page.route("**/api/organization/profiles", async (route) => {
    const profiles = [
      {
        createdAt: "2026-07-20T20:00:00.000Z",
        displayName: "Browser Singer",
        doNotEmail: false,
        globalStatus: "Active",
        id: "11111111-1111-4111-8111-111111111111",
        isSectionLeader: false,
        notes: "",
        phone: "",
        receiveAdminNotifications: true,
        receiveAttendanceReports: true,
        receiveFinancialAlerts: false,
        receiveRsvpDeclineNotices: false,
        showInDirectory: true,
        updatedAt: "2026-07-20T20:00:00.000Z",
        voicePart: "S2",
      },
      {
        createdAt: "2026-07-20T20:00:00.000Z",
        displayName: "Unexpected Singer",
        doNotEmail: false,
        globalStatus: "Active",
        id: "33333333-3333-4333-8333-333333333333",
        isSectionLeader: false,
        notes: "",
        phone: "",
        receiveAdminNotifications: true,
        receiveAttendanceReports: true,
        receiveFinancialAlerts: false,
        receiveRsvpDeclineNotices: false,
        showInDirectory: true,
        updatedAt: "2026-07-20T20:00:00.000Z",
        voicePart: "A1",
      },
      ...(page.url().includes("/admin/rsvp")
        ? [
            {
              createdAt: "2026-07-20T20:00:00.000Z",
              displayName: "Unassigned Singer",
              doNotEmail: false,
              globalStatus: "Active",
              id: "44444444-4444-4444-8444-444444444444",
              isSectionLeader: false,
              notes: "",
              phone: "",
              receiveAdminNotifications: true,
              receiveAttendanceReports: true,
              receiveFinancialAlerts: false,
              receiveRsvpDeclineNotices: false,
              showInDirectory: true,
              updatedAt: "2026-07-20T20:00:00.000Z",
              voicePart: "",
            },
          ]
        : []),
    ];
    await route.fulfill({
      body: JSON.stringify({
        profiles,
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/profiles/*", async (route) => {
    const body: unknown = route.request().postDataJSON();
    await route.fulfill({
      body: JSON.stringify({
        ...(typeof body === "object" && body !== null ? body : {}),
        createdAt: "2026-07-20T20:00:00.000Z",
        id: "11111111-1111-4111-8111-111111111111",
        requestId,
        updatedAt: "2026-07-20T20:15:00.000Z",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/singer/profile", async (route) => {
    if (route.request().method() === "PUT") {
      const body: unknown = route.request().postDataJSON();
      if (typeof body === "object" && body !== null) {
        const update = Object.fromEntries(Object.entries(body));
        memberProfile = {
          ...memberProfile,
          displayName:
            typeof update.displayName === "string" ? update.displayName : memberProfile.displayName,
          phone: typeof update.phone === "string" ? update.phone : memberProfile.phone,
          showInDirectory:
            typeof update.showInDirectory === "boolean"
              ? update.showInDirectory
              : memberProfile.showInDirectory,
        };
      }
    }
    await route.fulfill({
      body: JSON.stringify({ ...memberProfile, requestId }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/singer/directory", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        profiles: [
          ...(memberProfile.showInDirectory ? [memberProfile] : []),
          {
            displayName: "Directory Alto",
            email: "directory.alto@example.test",
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            phone: "555-0200",
            voicePart: "A1",
          },
        ],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/venues", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        requestId,
        venues: [
          {
            address: "100 Browser Way",
            createdAt: "2026-07-20T20:00:00.000Z",
            id: "22222222-2222-4222-8222-222222222222",
            name: "Browser Hall",
            updatedAt: "2026-07-20T20:00:00.000Z",
          },
        ],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/venues/*", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        requestId,
        status: "deleted",
        venueId: "22222222-2222-4222-8222-222222222222",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/events", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        events: [
          {
            advancePriceCents: 1000,
            callTime: "18:00",
            createdAt: "2026-07-20T20:00:00.000Z",
            dayOfPriceCents: 1200,
            details: "Black folders",
            doorsOpenTime: "17:30",
            durationMinutes: 150,
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            isTicketingEnabled: true,
            location: "",
            parentPerformanceId: null,
            publicDetails: "A Browser Concert for the choir.",
            publicGraphicFileId: null,
            publishOnWebsite: true,
            rsvpDeadlineAt: "2027-08-13T23:59:59.000Z",
            rsvpDeadlineDate: "2027-08-13",
            rsvpDeadlinePassed: true,
            rsvpSelfServiceOpen: false,
            setList: [{ title: "Finale" }],
            setListApproved: true,
            startsAt: "2027-08-20T23:00:00.000Z",
            ticketCapacity: 100,
            title: "Browser Concert",
            type: "Performance",
            updatedAt: "2026-07-20T20:00:00.000Z",
            venueId: null,
          },
        ],
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/events/*/attendance", async (route) => {
    if (route.request().method() === "PUT") {
      const body: unknown = route.request().postDataJSON();
      const record =
        typeof body === "object" && body !== null ? Object.fromEntries(Object.entries(body)) : null;
      const updates = record?.updates;
      const update = Array.isArray(updates) ? parseBrowserAttendanceUpdate(updates[0]) : null;
      if (update) {
        const current = attendanceRows.get(update.profileId);
        if (current) {
          attendanceRows.set(update.profileId, {
            ...current,
            attendance: update.attendance,
            rsvp: update.attendance === "Present" ? "Yes" : current.rsvp,
          });
        }
      }
    }
    await route.fulfill({
      body: JSON.stringify({
        eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        requestId,
        rows: page.url().includes("/admin/rsvp")
          ? [...attendanceRows.values(), unassignedRsvpRow]
          : [...attendanceRows.values()],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/events/*/rsvp-history", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        entries: [
          {
            actorType: "organization_member",
            automatic: false,
            displayName: "Browser Singer",
            eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            newRsvp: "Yes",
            occurredAt: "2026-07-20T20:10:00.000Z",
            previousRsvp: "Pending",
            profileId: "11111111-1111-4111-8111-111111111111",
            reason: "Member updated RSVP.",
          },
          {
            actorType: "system",
            automatic: true,
            displayName: "Unexpected Singer",
            eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            newRsvp: "No",
            occurredAt: "2026-07-20T20:05:00.000Z",
            previousRsvp: "Pending",
            profileId: "33333333-3333-4333-8333-333333333333",
            reason: "RSVP deadline passed.",
          },
        ],
        eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/calendar-settings", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ requestId, timezone: "America/New_York" }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/roster-configuration", async (route) => {
    const configuration =
      route.request().method() === "PUT"
        ? route.request().postDataJSON()
        : {
            sections: [
              { code: "S", color: "#1b4d3e", name: "Sopranos", trackOnly: false },
              { code: "A", color: "#4a7c59", name: "Altos", trackOnly: false },
            ],
            voiceParts: [
              { fullName: "Soprano 1", label: "S1", sectionCode: "S" },
              { fullName: "Soprano 2", label: "S2", sectionCode: "S" },
              { fullName: "Alto 1", label: "A1", sectionCode: "A" },
            ],
          };
    await route.fulfill({
      body: JSON.stringify({
        ...(typeof configuration === "object" && configuration !== null ? configuration : {}),
        requestId,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/seating-configuration", async (route) => {
    if (route.request().method() === "PUT") {
      const body: unknown = route.request().postDataJSON();
      if (typeof body === "object" && body !== null) {
        seatingConfiguration = Object.fromEntries(Object.entries(body));
      }
    }
    await route.fulfill({
      body: JSON.stringify({
        configuration: seatingConfiguration,
        requestId,
      }),
      contentType: "application/json",
      status: 200,
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
      const byId = new Map(seatingCharts.map((chart) => [String(chart.id), chart]));
      seatingCharts = chartIds.flatMap((chartId, index) => {
        const chart = byId.get(chartId);
        return chart ? [{ ...chart, sortOrder: index }] : [];
      });
      await route.fulfill({
        body: JSON.stringify({ charts: seatingCharts, requestId }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        body: JSON.stringify({ charts: seatingCharts, requestId }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    if (method === "DELETE") {
      seatingCharts = [];
      await route.fulfill({
        body: JSON.stringify({
          chartId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          requestId,
          status: "deleted",
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const body: unknown = route.request().postDataJSON();
    const chart = {
      ...(typeof body === "object" && body !== null ? body : {}),
      createdAt: "2026-07-20T20:00:00.000Z",
      eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      requestId,
      updatedAt: "2026-07-20T20:15:00.000Z",
    };
    seatingCharts = [chart];
    await route.fulfill({
      body: JSON.stringify(chart),
      contentType: "application/json",
      status: method === "POST" ? 201 : 200,
    });
  });
  await page.route("**/api/singer/events", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        events: [
          {
            callTime: "18:00",
            details: "Concert black",
            directRsvp: "Yes",
            durationMinutes: 150,
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            inheritedFromParent: false,
            location: "Browser Hall",
            resolvedRsvp: "Yes",
            rsvpNote: "",
            startsAt: "2027-08-20T23:00:00.000Z",
            title: "Browser Concert",
            type: "Performance",
            venueAddress: "100 Browser Way",
            venueName: "Browser Hall",
          },
          {
            callTime: "18:00",
            details: "Black folders",
            directRsvp: "Pending",
            durationMinutes: 120,
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            inheritedFromParent: true,
            location: "Choir Room",
            resolvedRsvp: "Yes",
            rsvpNote: "",
            startsAt: "2026-08-19T23:00:00.000Z",
            title: "My Rehearsal",
            type: "Rehearsal",
            venueAddress: "",
            venueName: "",
          },
        ],
        profileId: "11111111-1111-4111-8111-111111111111",
        requestId,
        timezone: "America/New_York",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/singer/events/*/seating", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        charts: [
          {
            assignments: { "0-0": "11111111-1111-4111-8111-111111111111" },
            createdAt: "2026-07-20T20:00:00.000Z",
            eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            formationId: "columns-standard",
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            name: "Member Chart",
            rowCounts: [2],
            sectionSuggestions: { "0-0": "S", "0-1": "A" },
            sortOrder: 0,
            updatedAt: "2026-07-20T20:15:00.000Z",
            venueId: null,
          },
        ],
        profiles: [
          {
            displayName: "Browser Singer",
            id: "11111111-1111-4111-8111-111111111111",
            voicePart: "S2",
          },
        ],
        requestId,
        selfProfileId: "11111111-1111-4111-8111-111111111111",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/singer/events/*/rsvp", async (route) => {
    const body: unknown = route.request().postDataJSON();
    const rsvp =
      typeof body === "object" && body !== null && "rsvp" in body && typeof body.rsvp === "string"
        ? body.rsvp
        : "Pending";
    await route.fulfill({
      body: JSON.stringify({
        eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        profileId: "11111111-1111-4111-8111-111111111111",
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
      }),
      contentType: "application/json",
      status: 200,
    });
  });
});

test("completes OTP sign-in and manages Organizations and sessions", async ({ page }) => {
  let passwordSet = false;
  let signedIn = false;
  let sessions = [
    currentSession,
    {
      ...currentSession,
      id: "session-other",
      ipAddress: "198.51.100.4",
      token: "other-session-token-not-displayed",
      userAgent: "Safari on iPad",
    },
  ];

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: "11111111-1111-4111-8111-111111111111",
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({
      body: JSON.stringify(signedIn ? { session: currentSession, user: currentUser } : null),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/public/projection", async (route) => {
    await route.fulfill({ status: 404 });
  });
  await page.route("**/api/auth/email-otp/send-verification-otp", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ success: true }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/sign-in/email-otp", async (route) => {
    signedIn = true;
    await route.fulfill({
      body: JSON.stringify({ token: "not-used-by-browser-ui", user: currentUser }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/organizations", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        organizations: [
          {
            canonicalHostname: "alpha.example.test",
            canonicalStatus: "active",
            lifecycleState: "active",
            name: "Organization Alpha",
            organizationId: "organization-alpha",
            profileId: null,
            role: "administrator",
            slug: "alpha",
          },
          {
            canonicalHostname: "future.example.test",
            canonicalStatus: "pending",
            lifecycleState: "provisioning",
            name: "Future Choir",
            organizationId: "organization-future",
            profileId: null,
            role: "member",
            slug: "future",
          },
        ],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/security", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        passwordSet,
        requestId: "44444444-4444-4444-8444-444444444444",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/password", async (route) => {
    passwordSet = true;
    await route.fulfill({
      body: JSON.stringify({
        passwordSet: true,
        requestId: "44444444-4444-4444-8444-444444444444",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/sessions", async (route) => {
    await route.fulfill({
      body: JSON.stringify(sessions),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/sessions/revoke", async (route) => {
    sessions = sessions.filter((session) => session.id !== "session-other");
    await route.fulfill({
      body: JSON.stringify({ status: true }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/sign-out", async (route) => {
    signedIn = false;
    await route.fulfill({
      body: JSON.stringify({ success: true }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/singer/profile/email-change", async (route) => {
    const body: unknown = route.request().postDataJSON();
    expect(body).toEqual({ email: "updated.browser@example.test" });
    await route.fulfill({
      body: JSON.stringify({
        email: "updated.browser@example.test",
        requestId: "44444444-4444-4444-8444-444444444444",
        status: "pending",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/mfa/status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        activePlatformAdministrator: false,
        enrollmentComplete: false,
        requestId: "22222222-2222-4222-8222-222222222222",
        twoFactorEnabled: false,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        mfaRequired: false,
        mfaVerifiedUntil: null,
        organizationId: "organization-alpha",
        requestId: "55555555-5555-4555-8555-555555555555",
        role: "member",
        twoFactorEnabled: false,
        twoFactorVerified: false,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to Choir Management." })).toBeVisible();
  await page.getByLabel("Email address").fill(currentUser.email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "If invited.member@example.test has access",
  );
  await page.getByLabel("6-digit sign-in code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "My Profile" })).toBeVisible();
  const memberProfileForm = page.locator(".member-profile-form");
  await expect(page.getByRole("heading", { name: "My Organization Profile" })).toBeVisible();
  await memberProfileForm.getByLabel("New sign-in email").fill("updated.browser@example.test");
  await memberProfileForm.getByRole("button", { name: "Change email" }).click();
  await expect(memberProfileForm.getByRole("status")).toContainText("confirmation link");

  await page.goto("/account/organizations");
  await expect(page.getByRole("heading", { name: "Welcome, Invited Member." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Organization Alpha" })).toBeVisible();
  await expect(page.getByText("Future Choir")).toBeVisible();
  await expect(page.getByText("Setup pending")).toBeVisible();

  await page.goto("/account/security");
  const passwordSection = page.getByRole("region", { name: "Account password" });
  const userPassword = "a-user-managed-password";
  await passwordSection.getByLabel("New password", { exact: true }).fill(userPassword);
  await passwordSection.getByLabel("Confirm new password").fill(userPassword);
  await passwordSection.getByRole("button", { name: "Add password" }).click();
  await expect(passwordSection.getByRole("status")).toContainText("Password added");
  await expect(passwordSection.getByLabel("Current password")).toBeVisible();

  await page.goto("/account/sessions");
  const otherSession = page.getByRole("listitem", { name: "Session: Safari on iPad" });
  await expect(otherSession).toBeVisible();
  await otherSession.getByRole("button", { name: "Revoke session" }).click();
  await expect(otherSession).toHaveCount(0);
  await expect(page.getByText("current-session-token-not-displayed")).toHaveCount(0);

  await page.getByRole("banner").getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
});

test("renders the focused seating canvas with structural controls", async ({ page }) => {
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: "11111111-1111-4111-8111-111111111111",
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ session: currentSession, user: currentUser }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/organizations", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        organizations: [
          {
            canonicalHostname: "alpha.example.test",
            canonicalStatus: "active",
            lifecycleState: "active",
            name: "Organization Alpha",
            organizationId: "organization-alpha",
            profileId: null,
            role: "administrator",
            slug: "alpha",
          },
        ],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/mfa/status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        activePlatformAdministrator: false,
        enrollmentComplete: false,
        requestId: "22222222-2222-4222-8222-222222222222",
        twoFactorEnabled: false,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/module-state", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        modules: [
          { enabled: true, id: "events" },
          { enabled: true, id: "people" },
          { enabled: true, id: "programs" },
        ],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/setup/status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        allModulesConfigured: true,
        completedSteps: [],
        currentStep: null,
        launched: true,
        organizationId: "organization-alpha",
        organizationName: "Organization Alpha",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        mfaRequired: false,
        mfaVerifiedUntil: null,
        organizationId: "organization-alpha",
        requestId: "99999999-9999-4999-8999-999999999999",
        role: "administrator",
        twoFactorEnabled: false,
        twoFactorVerified: false,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin/seating");
  await expect(page.getByRole("heading", { name: "Performance seating" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start a seating chart" })).toBeVisible();
  await page.getByRole("button", { name: "Create chart" }).click();
  await page.getByLabel("Chart name").fill("Full Canvas Chart");
  await expect(page.getByLabel("Singers to place")).toHaveValue("1");
  await expect(page.getByLabel("Rows")).toHaveValue("1");
  await expect(
    page.getByText("1 singer across 1 row — 1 singer per row.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Singers to place").fill("30");
  await page.getByLabel("Rows").fill("3");
  await expect(
    page.getByText("30 singers across 3 rows — 10 singers per row.", { exact: true }),
  ).toBeVisible();
  const createChartRequestPromise = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/seating-charts"),
  );
  await page.getByRole("button", { name: "Create chart", exact: true }).click();
  const createChartRequest = await createChartRequestPromise;
  expect(createChartRequest.postDataJSON()).toEqual(
    expect.objectContaining({ rowCounts: [10, 10, 10] }),
  );
  const chartSelect = page.getByLabel("Select seating chart");
  await expect(chartSelect).toContainText("Full Canvas Chart");
  const darkThemeButton = page.getByRole("button", { name: "Switch to dark theme" });
  if (await darkThemeButton.isVisible()) {
    await darkThemeButton.click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const optionColors = await chartSelect
    .locator("option")
    .first()
    .evaluate((option) => {
      const styles = getComputedStyle(option);
      return { backgroundColor: styles.backgroundColor, color: styles.color };
    });
  const themeColors = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--color-surface)";
    probe.style.color = "var(--color-text)";
    document.body.append(probe);
    const styles = getComputedStyle(probe);
    const colors = { backgroundColor: styles.backgroundColor, color: styles.color };
    probe.remove();
    return colors;
  });
  expect(optionColors).toEqual(themeColors);
  if ((page.viewportSize()?.width ?? 1000) <= 700) {
    await page.getByRole("button", { name: "Edit anyway" }).click();
    const openNavigation = page.getByRole("button", { name: "Open workspace navigation" });
    await openNavigation.click();
    const navigationDialog = page.getByRole("dialog", { name: "Workspace navigation" });
    await expect(navigationDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(navigationDialog).toHaveCount(0);
    await expect(openNavigation).toBeFocused();
  }
  const firstSeat = page.locator(".seating-seat--empty").first();
  await expect(firstSeat).toBeVisible();
  if ((page.viewportSize()?.width ?? 1000) > 700) {
    await firstSeat.click({ force: true });
    const seatDialog = page.getByRole("dialog").filter({ hasText: "This seat is empty." });
    await expect(seatDialog).toBeVisible();
    await seatDialog.getByRole("button", { name: /Browser Singer/ }).click();
    await expect(
      page.locator(".seating-seat--assigned").filter({ hasText: "Browser Singer" }).first(),
    ).toBeVisible();

    const assignedSeat = page
      .locator(".seating-seat--assigned")
      .filter({ hasText: "Browser Singer" })
      .first();
    await expect(assignedSeat).toHaveAttribute("title", "Browser Singer");
    await expect(assignedSeat.getByText("Browser Singer", { exact: true })).toBeHidden();
    await expect(assignedSeat.getByText("BS", { exact: true })).toBeVisible();
    await assignedSeat.getByRole("button", { name: "Remove Browser Singer from Seat 1" }).click();
    const clearSeatDialog = page.getByRole("dialog", { name: "Clear seat assignment?" });
    await expect(clearSeatDialog).toContainText("return them to Unassigned Profiles");
    await clearSeatDialog.getByRole("button", { name: "Clear assignment" }).click();
    await expect(
      page.locator(".seating-seat--assigned").filter({ hasText: "Browser Singer" }),
    ).toHaveCount(0);
    const firstRow = page.locator(".seating-row--canvas").filter({ hasText: "Row 1" }).first();
    await expect(firstRow.locator(".seating-seat--canvas")).toHaveCount(10);

    await firstRow.getByRole("button", { name: "Delete empty Seat 1", exact: true }).click();
    const deleteSeatDialog = page.getByRole("dialog", { name: "Delete empty seat?" });
    await expect(deleteSeatDialog).toBeVisible();
    await deleteSeatDialog.getByRole("button", { name: "Delete seat" }).click();
    await expect(firstRow.locator(".seating-seat--canvas")).toHaveCount(9);
  }
  await expect(page.getByRole("button", { name: "+ Add row to back" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Add row to front" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unassigned Profiles" })).toBeVisible();
});

test("confirms a member email change from the one-time link", async ({ page }) => {
  const token = "browser-email-change-token-123456";
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: "11111111-1111-4111-8111-111111111111",
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({ body: "null", contentType: "application/json", status: 200 });
  });
  await page.route("**/api/account/email-change/confirm", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token });
    await route.fulfill({
      body: JSON.stringify({
        email: "updated.browser@example.test",
        requestId: "44444444-4444-4444-8444-444444444444",
        status: "confirmed",
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/confirm-email-change?token=${token}`);
  await expect(page).toHaveURL(/\/confirm-email-change$/);
  await expect(page.getByRole("heading", { name: "Confirm your email address" })).toBeVisible();
  await expect(page.locator(".auth-card").getByRole("status")).toContainText(
    "updated.browser@example.test",
  );
});

test("enrolls and verifies mandatory Platform Administrator MFA", async ({ page }) => {
  let assertionReady = false;
  let enrollmentComplete = false;
  let schemaPreparationStarted = false;
  let twoFactorEnabled = false;
  const recoveryCodes = Array.from(
    { length: 10 },
    (_, index) => `recovery-${String(index + 1).padStart(2, "0")}`,
  );

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: "11111111-1111-4111-8111-111111111111",
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ session: currentSession, user: currentUser }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/organizations", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ organizations: [] }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/security", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        passwordSet: false,
        requestId: "44444444-4444-4444-8444-444444444444",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/sessions", async (route) => {
    await route.fulfill({
      body: JSON.stringify([currentSession]),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/mfa/status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        activePlatformAdministrator: true,
        enrollmentComplete,
        requestId: "22222222-2222-4222-8222-222222222222",
        twoFactorEnabled,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        code: "not_found",
        message: "No canonical Organization hostname is active.",
        requestId: "55555555-5555-4555-8555-555555555555",
      }),
      contentType: "application/json",
      status: 404,
    });
  });
  await page.route("**/api/auth/two-factor/enable", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        backupCodes: recoveryCodes,
        totpURI:
          "otpauth://totp/Choir%20Management:invited.member%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Choir%20Management",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
    twoFactorEnabled = true;
    await route.fulfill({
      body: JSON.stringify({ status: true }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/mfa/confirm-enrollment", async (route) => {
    enrollmentComplete = true;
    await route.fulfill({
      body: JSON.stringify({ status: "confirmed" }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/context", async (route) => {
    if (!assertionReady) {
      await route.fulfill({
        body: JSON.stringify({
          code: "unauthorized",
          message: "A recent Platform Administrator MFA verification is required.",
          requestId: "33333333-3333-4333-8333-333333333333",
        }),
        contentType: "application/json",
        status: 401,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        mfaMethod: "totp",
        mfaVerifiedUntil: "2026-07-20T20:15:00.000Z",
        requestId: "33333333-3333-4333-8333-333333333333",
        scope: { kind: "product_base" },
        userId: currentUser.id,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/organizations", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        body: JSON.stringify({
          canonicalHostname: "staging-choir.example.test",
          canonicalStatus: "pending",
          lifecycleState: "provisioning",
          organizationId: "99999999-9999-4999-8999-999999999999",
          requestId: "33333333-3333-4333-8333-333333333333",
          workflowId: "organization-provision-browser-test",
        }),
        contentType: "application/json",
        status: 202,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        nextCursor: null,
        organizations: [],
        requestId: "33333333-3333-4333-8333-333333333333",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/job-dead-letters**", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        deadLetters: [],
        nextCursor: null,
        requestId: "33333333-3333-4333-8333-333333333333",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/fleet-schema-preparation", async (route) => {
    if (route.request().method() === "POST") {
      schemaPreparationStarted = true;
    }
    await route.fulfill({
      body: JSON.stringify({
        currentVersion: 5,
        preparation: schemaPreparationStarted
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
      }),
      contentType: "application/json",
      status: route.request().method() === "POST" ? 202 : 200,
    });
  });
  await page.route("**/api/platform/mfa/verify", async (route) => {
    assertionReady = true;
    await route.fulfill({
      body: JSON.stringify({ expiresAt: "2026-07-20T20:15:00.000Z", status: "verified" }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/platform/security");
  const platformSection = page.getByRole("region", { name: "Platform Administrator access" });
  await expect(
    platformSection.getByRole("heading", { name: "Complete mandatory MFA" }),
  ).toBeVisible();
  await platformSection.getByRole("button", { name: "Start MFA setup" }).click();
  await expect(platformSection.getByLabel("Platform Administrator recovery codes")).toContainText(
    "recovery-01",
  );
  await platformSection.getByLabel("3. Verify the authenticator code").fill("123456");
  await platformSection.getByRole("button", { name: "Verify authenticator" }).click();
  await platformSection
    .getByRole("checkbox", { name: "I saved these recovery codes in a secure place." })
    .check();
  await platformSection.getByRole("button", { name: "Confirm recovery codes" }).click();

  await expect(
    platformSection.getByRole("heading", { name: "Verify Platform Administrator access" }),
  ).toBeVisible();
  await platformSection.getByLabel("6-digit code").fill("654321");
  await platformSection.getByRole("button", { name: "Verify Platform access" }).click();
  await expect(platformSection.getByRole("status")).toContainText("Platform access is ready");

  await page.goto("/platform/dead-letters");
  const deadLettersSection = page.getByRole("region", { name: "Queue dead letters" });
  await expect(
    deadLettersSection.getByRole("heading", { name: "Queue dead letters" }),
  ).toBeVisible();
  await expect(
    deadLettersSection.getByText("No jobs have reached the dead-letter queue."),
  ).toBeVisible();

  await page.goto("/platform/organizations");
  const organizationsSection = page.getByRole("region", { name: "Organizations" });
  await expect(
    organizationsSection.getByRole("heading", { name: "Organization provisioning" }),
  ).toBeVisible();
  await organizationsSection.getByRole("button", { name: "Prepare schemas" }).click();
  await expect(
    organizationsSection.getByRole("button", { name: "Preparation running" }),
  ).toBeDisabled();
  await organizationsSection.getByLabel("Organization name").fill("Staging Choir");
  await organizationsSection.getByLabel("Hostname slug").fill("staging-choir");
  await organizationsSection.getByRole("button", { name: "Create Organization" }).click();
  await expect(organizationsSection.getByText("Staging Choir", { exact: true })).toBeVisible();
  await expect(organizationsSection.getByText("Provisioning", { exact: true })).toBeVisible();
  await expect(organizationsSection.getByRole("status").last()).toContainText(
    "canonical hostname remains pending",
  );
  await expect(page.getByText("recovery-01")).toHaveCount(0);
});

test("enables and ends scoped Platform Administrator edit access", async ({ page }) => {
  let canEdit = false;
  const elevationId = "88888888-8888-4888-8888-888888888888";
  const requestId = "33333333-3333-4333-8333-333333333333";

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: "11111111-1111-4111-8111-111111111111",
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ session: currentSession, user: currentUser }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/organizations", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ organizations: [] }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/security", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ passwordSet: false, requestId }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/sessions", async (route) => {
    await route.fulfill({
      body: JSON.stringify([currentSession]),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/mfa/status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        activePlatformAdministrator: true,
        enrollmentComplete: true,
        requestId,
        twoFactorEnabled: true,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        code: "forbidden",
        message: "This identity is not an active Organization Member.",
        requestId,
      }),
      contentType: "application/json",
      status: 403,
    });
  });
  await page.route("**/api/platform/context", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        mfaMethod: "totp",
        mfaVerifiedUntil: "2026-07-20T20:15:00.000Z",
        requestId,
        scope: { kind: "organization", organizationId: "organization-alpha" },
        userId: currentUser.id,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/organization-context", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        canEdit,
        elevationExpiresAt: canEdit ? "2026-07-20T20:15:00.000Z" : null,
        elevationId: canEdit ? elevationId : null,
        organizationId: "organization-alpha",
        requestId,
        userId: currentUser.id,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/elevations", async (route) => {
    canEdit = true;
    await route.fulfill({
      body: JSON.stringify({
        canEdit: true,
        elevationExpiresAt: "2026-07-20T20:15:00.000Z",
        elevationId,
        organizationId: "organization-alpha",
        requestId,
        userId: currentUser.id,
      }),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.route("**/api/platform/elevations/*", async (route) => {
    canEdit = false;
    await route.fulfill({
      body: JSON.stringify({ elevationId, status: "revoked" }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/platform/access");
  const platformSection = page.getByRole("region", { name: "Organization access" });
  await expect(platformSection.getByRole("heading", { name: "Organization access" })).toBeVisible();
  await expect(platformSection.getByText("Read-only Platform access")).toBeVisible();
  await platformSection
    .getByLabel("Reason for enabling edits")
    .fill("Review Organization configuration");
  await platformSection
    .getByRole("button", { name: "Enable Platform edits for 15 minutes" })
    .click();
  await expect(platformSection.getByText("Platform edits enabled.")).toBeVisible();
  await platformSection.getByRole("button", { name: "End edit access" }).click();
  await expect(platformSection.getByText("Read-only Platform access")).toBeVisible();
});

test("enrolls, verifies, and safely manages an Organization MFA policy", async ({ page }) => {
  let calendarVersion = 1;
  let mfaRequired = false;
  let mfaVerifiedUntil: string | null = null;
  let twoFactorEnabled = false;
  let twoFactorVerified = false;
  const requestId = "55555555-5555-4555-8555-555555555555";
  const recoveryCodes = Array.from(
    { length: 10 },
    (_, index) => `organization-recovery-${String(index + 1).padStart(2, "0")}`,
  );
  const pendingInvitations: {
    createdAt: string;
    email: string;
    expiresAt: string;
    id: string;
    role: "administrator";
    status: "pending";
  }[] = [];

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: "11111111-1111-4111-8111-111111111111",
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ session: currentSession, user: currentUser }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/organizations", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        organizations: [
          {
            canonicalHostname: "alpha.localhost",
            canonicalStatus: "active",
            lifecycleState: "active",
            name: "Organization Alpha",
            organizationId: "organization-alpha",
            profileId: null,
            role: "owner",
            slug: "alpha",
          },
        ],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/security", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ passwordSet: false, requestId }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/sessions", async (route) => {
    await route.fulfill({
      body: JSON.stringify([currentSession]),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/setup/status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        allModulesConfigured: true,
        completedSteps: [],
        currentStep: null,
        launched: true,
        organizationId: "organization-alpha",
        organizationName: "Organization Alpha",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/mfa/status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        activePlatformAdministrator: false,
        enrollmentComplete: false,
        requestId,
        twoFactorEnabled,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        mfaRequired,
        mfaVerifiedUntil,
        organizationId: "organization-alpha",
        requestId,
        role: "owner",
        twoFactorEnabled,
        twoFactorVerified,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/singer/calendar-feed-url**", async (route) => {
    if (route.request().method() === "POST") {
      calendarVersion += 1;
    }
    const token = `browser-calendar-token-${String(calendarVersion)}`;
    await route.fulfill({
      body: JSON.stringify({
        expiresAt: "2036-07-20T08:00:00.000Z",
        httpsUrl: `http://alpha.localhost/api/calendar/feed?token=${token}`,
        requestId,
        webcalUrl: `webcal://alpha.localhost/api/calendar/feed?token=${token}`,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auth-policy", async (route) => {
    mfaRequired = !mfaRequired;
    mfaVerifiedUntil = null;
    await route.fulfill({
      body: JSON.stringify({ mfaRequired, organizationId: "organization-alpha", requestId }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/two-factor/enable", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        backupCodes: recoveryCodes,
        totpURI:
          "otpauth://totp/Choir%20Management:member%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Choir%20Management",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
    twoFactorEnabled = true;
    twoFactorVerified = true;
    await route.fulfill({
      body: JSON.stringify({ status: true }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/mfa/verify", async (route) => {
    mfaVerifiedUntil = "2026-07-21T08:00:00.000Z";
    await route.fulfill({
      body: JSON.stringify({
        expiresAt: mfaVerifiedUntil,
        organizationId: "organization-alpha",
        requestId,
        status: "verified",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/invitations", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify({ invitations: pendingInvitations, requestId, truncated: false }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const body: unknown = route.request().postDataJSON();
    expect(body).toEqual({ email: "future.member@example.test", role: "administrator" });
    pendingInvitations.push({
      createdAt: "2026-07-20T08:00:00.000Z",
      email: "future.member@example.test",
      expiresAt: "2026-07-22T08:00:00.000Z",
      id: "77777777-7777-4777-8777-777777777777",
      role: "administrator",
      status: "pending",
    });
    await route.fulfill({
      body: JSON.stringify({
        expiresAt: "2026-07-22T08:00:00.000Z",
        id: "77777777-7777-4777-8777-777777777777",
        requestId,
        status: "pending",
      }),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.route("**/api/organization/invitations/*", async (route) => {
    const invitationId = route.request().url().split("/").at(-1);
    const invitationIndex = pendingInvitations.findIndex(
      (invitation) => invitation.id === invitationId,
    );
    expect(route.request().method()).toBe("DELETE");
    expect(invitationIndex).toBeGreaterThanOrEqual(0);
    pendingInvitations.splice(invitationIndex, 1);
    await route.fulfill({
      body: JSON.stringify({ id: invitationId, requestId, status: "canceled" }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin/settings/security");
  const organizationSection = page.getByRole("region", { name: "Organization security" });
  await expect(organizationSection.getByText("MFA not required")).toBeVisible();

  await page.goto("/admin/roster");
  const rosterPage = page.getByRole("main");
  await expect(rosterPage.getByRole("button", { name: "Add Profile" })).toBeVisible();
  await rosterPage.getByRole("button", { name: "Add Profile" }).click();
  const profileDialog = page.getByRole("dialog", { name: "Add Profile" });
  await expect(profileDialog).toBeVisible();
  await profileDialog.getByLabel("Display name").fill("Changed profile");
  const discardDialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await page.keyboard.press("Escape");
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(profileDialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(profileDialog).toHaveCount(0);
  await expect(rosterPage.getByRole("link", { name: "Export CSV" })).toHaveAttribute(
    "href",
    "/api/organization/profiles/export.csv",
  );

  await page.goto("/admin/events");
  const eventsPage = page.getByRole("main");
  await expect(eventsPage.getByRole("heading", { name: "Events" })).toBeVisible();
  await expect(eventsPage.getByRole("heading", { name: "Events" })).toBeVisible();
  const eventRsvpLink = eventsPage.getByRole("link", { name: "RSVP", exact: true }).first();
  await expect(eventRsvpLink).toHaveAttribute(
    "href",
    "/admin/rsvp?eventId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  await eventRsvpLink.click();
  await expect(page).toHaveURL(/\/admin\/rsvp\?eventId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa$/);
  const linkedRsvpPage = page.getByRole("main");
  await expect(
    linkedRsvpPage.locator(".rsvp-manager__balance").getByRole("combobox", { name: "Performance" }),
  ).toHaveValue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  await expect(linkedRsvpPage.getByRole("heading", { name: "RSVP roster" })).toBeVisible();
  await expect(
    linkedRsvpPage.getByText(/Administrators can still override responses\./),
  ).toBeVisible();
  await expect(
    linkedRsvpPage.getByRole("link", { name: "Roster Settings", exact: true }),
  ).toHaveCount(0);
  const rsvpBalance = linkedRsvpPage.locator(".rsvp-manager__balance");
  const rsvpRoster = linkedRsvpPage.locator(".rsvp-manager__roster");
  const visibleRsvpContent = rsvpRoster.locator(".data-table:visible, .data-table-cards:visible");
  const expectVisibleRsvpName = async (name: string) => {
    const nameLocator = visibleRsvpContent.getByText(name, { exact: true });
    await nameLocator.scrollIntoViewIfNeeded();
    await expect(nameLocator).toBeVisible();
  };
  await rsvpBalance.getByRole("button", { name: "Sopranos 1", exact: true }).click();
  await expectVisibleRsvpName("Browser Singer");
  await expect(visibleRsvpContent.getByText("Unexpected Singer", { exact: true })).toHaveCount(0);
  await expect(
    rsvpBalance.getByRole("button", { name: "Sopranos 1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await rsvpBalance.getByRole("button", { name: "S2 1", exact: true }).click();
  await expectVisibleRsvpName("Browser Singer");
  await expect(visibleRsvpContent.getByText("Unexpected Singer", { exact: true })).toHaveCount(0);
  await rsvpBalance.getByRole("button", { name: "A1 1", exact: true }).click();
  await expectVisibleRsvpName("Unexpected Singer");
  await expect(visibleRsvpContent.getByText("Browser Singer", { exact: true })).toHaveCount(0);
  await rsvpBalance.getByRole("button", { name: "A1 1", exact: true }).click();
  await expectVisibleRsvpName("Browser Singer");
  await expectVisibleRsvpName("Unexpected Singer");
  await expectVisibleRsvpName("Unassigned Singer");
  const unassignedRsvpEntry = visibleRsvpContent
    .locator("tr, .data-table-card")
    .filter({ hasText: "Unassigned Singer" });
  await expect(unassignedRsvpEntry).toContainText("Assign a part before managing RSVP.");
  await expect(unassignedRsvpEntry.getByRole("button")).toHaveCount(0);
  await page.goto("/admin/events");
  const eventsPageAfterRsvp = page.getByRole("main");
  await expect(eventsPageAfterRsvp.getByRole("heading", { name: "Events" })).toBeVisible();
  await eventsPage.getByRole("button", { name: "Bulk add rehearsals" }).click();
  const bulkRehearsalDialog = page.getByRole("dialog", { name: "Bulk add rehearsals" });
  await expect(bulkRehearsalDialog.getByRole("combobox", { name: "Day of week" })).toHaveValue("");
  await bulkRehearsalDialog
    .getByRole("combobox", { name: "Day of week" })
    .selectOption({ label: "Wednesday" });
  await bulkRehearsalDialog.getByRole("button", { name: "Cancel" }).click();
  const browserConcertEdit = eventsPage.locator(
    '[aria-label="Edit event Browser Concert"]:visible',
  );
  await expect(browserConcertEdit).toBeVisible();
  await expect(browserConcertEdit.getByRole("link", { name: "RSVP", exact: true })).toBeVisible();
  await expect(browserConcertEdit.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(
    browserConcertEdit.getByRole("button", { name: "More actions for Browser Concert" }),
  ).toBeVisible();
  await expect(browserConcertEdit.getByRole("button", { name: "Clone", exact: true })).toHaveCount(
    0,
  );
  await browserConcertEdit.getByRole("button", { name: "Edit", exact: true }).click();
  const eventEditor = page.getByRole("dialog", { name: "Edit event" });
  await expect(
    eventEditor.getByRole("link", { name: "Change RSVP expiry in Roster Settings" }),
  ).toHaveAttribute("href", "/admin/roster?section=settings");
  await expect(eventEditor).toContainText(
    /This date (?:is|was) calculated from the event start using the organization's RSVP expiry setting\./,
  );
  await expect(eventEditor.getByText("Ticket page and QR code")).toBeVisible();
  const ticketPageLink = eventEditor.locator(
    'a[href$="/tickets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]',
  );
  await expect(ticketPageLink).toBeVisible();
  await expect(ticketPageLink).toHaveAttribute("target", "_blank");
  await expect(eventEditor.getByRole("button", { name: "Download QR code" })).toBeVisible();
  await expect(eventEditor.locator(".event-graphic-dropzone")).toContainText(
    "Drag and drop an image here",
  );
  await eventEditor.locator("#events-page-graphic").setInputFiles({
    buffer: Buffer.from("browser concert graphic"),
    mimeType: "image/png",
    name: "browser-concert.png",
  });
  await expect(eventEditor.getByText("Selected: browser-concert.png")).toBeVisible();
  await eventEditor.getByRole("button", { name: "Remove selected image" }).click();
  await eventEditor.locator(".event-graphic-dropzone").evaluate((dropzone) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File(["dropped graphic"], "dropped-concert.png", { type: "image/png" }),
    );
    dropzone.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
    );
  });
  await expect(eventEditor.getByText("Selected: dropped-concert.png")).toBeVisible();
  await eventEditor.getByRole("button", { name: "Remove selected image" }).click();
  await expect(eventEditor.getByRole("region", { name: "Unsaved event changes" })).toHaveCount(0);
  await eventEditor.getByLabel("Title").fill("Browser Concert draft");
  const eventSaveBar = eventEditor.getByRole("region", { name: "Unsaved event changes" });
  await expect(eventSaveBar).toBeVisible();
  await expect(eventSaveBar.getByText("Unsaved changes")).toBeVisible();
  await expect(eventSaveBar.getByRole("button", { name: "Save event", exact: true })).toBeVisible();
  await eventEditor.getByLabel("Title").fill("Browser Concert");
  await expect(eventSaveBar).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(eventEditor).toHaveCount(0);
  await page.goto("/admin/attendance");
  const attendancePage = page.getByRole("main");
  await expect(attendancePage.getByRole("heading", { name: "Attendance" })).toBeVisible();
  await expect(attendancePage.locator(".attendance-manager__sync")).toContainText(
    "Live updates every 30 seconds",
  );
  const markRemainingPresent = attendancePage.getByRole("button", {
    name: "Mark remaining present",
    exact: true,
  });
  await expect(markRemainingPresent).toBeEnabled();
  await markRemainingPresent.click();
  const attendanceConfirmation = page.getByRole("dialog", { name: "Mark remaining present?" });
  await expect(attendanceConfirmation).toBeVisible();
  await expect(attendanceConfirmation).toContainText("This will mark 1 performer");
  await attendanceConfirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(attendanceConfirmation).toBeHidden();
  await markRemainingPresent.click();
  await attendanceConfirmation
    .getByRole("button", { name: "Mark remaining present", exact: true })
    .click();
  await expect(attendanceConfirmation).toBeHidden();
  await attendancePage.getByRole("button", { name: "Present 1", exact: true }).click();
  await expect(
    attendancePage.getByRole("button", { name: /Browser Singer: Present/ }),
  ).toBeVisible();
  await expect(attendancePage.getByRole("button", { name: "All 1", exact: true })).toBeVisible();
  await attendancePage.getByRole("button", { name: "All 1", exact: true }).click();
  const unexpectedSinger = attendancePage.getByRole("button", {
    name: /Unexpected Singer: Tap to check in/,
  });
  await expect(unexpectedSinger).toHaveCount(0);
  await expect(attendancePage.getByRole("separator", { name: "Not currently RSVP'd" })).toHaveCount(
    0,
  );
  await attendancePage.getByRole("searchbox", { name: "Find a performer" }).fill("Unexpected");
  await expect(unexpectedSinger).toBeVisible();
  await expect(unexpectedSinger).toContainText("Not currently RSVP'd");
  await expect(
    attendancePage.getByRole("separator", { name: "Not currently RSVP'd" }),
  ).toBeVisible();
  await expect(attendancePage.getByRole("dialog")).toHaveCount(0);
  await unexpectedSinger.click();
  const rescueConfirmation = page.getByRole("dialog", {
    name: "Mark unexpected attendee present?",
  });
  await expect(rescueConfirmation).toBeVisible();
  await expect(rescueConfirmation).toContainText("Unexpected Singer");
  await expect(rescueConfirmation).toContainText("will RSVP them Yes");
  await rescueConfirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(rescueConfirmation).toBeHidden();
  await expect(unexpectedSinger).toContainText("Not currently RSVP'd");
  await unexpectedSinger.click();
  await rescueConfirmation
    .getByRole("button", { name: "Mark present and RSVP", exact: true })
    .click();
  await expect(rescueConfirmation).toBeHidden();
  await expect(
    attendancePage.getByRole("button", { name: /Unexpected Singer: Present/ }),
  ).toBeVisible();
  await page.goto("/admin/events");
  await expect(eventsPage.getByRole("heading", { name: "Events" })).toBeVisible();
  await browserConcertEdit
    .getByRole("button", { name: "More actions for Browser Concert" })
    .click();
  await page.getByRole("menuitem", { name: "Clone", exact: true }).click();
  const cloneDialog = page.getByRole("dialog", { name: "Clone event" });
  await expect(cloneDialog).toBeVisible();
  await cloneDialog.getByRole("button", { name: "Close" }).click();
  await expect(cloneDialog).toHaveCount(0);
  await browserConcertEdit
    .getByRole("button", { name: "More actions for Browser Concert" })
    .click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Archive event?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/admin/venues");
  const venuesPage = page.getByRole("main");
  await expect(venuesPage.getByRole("heading", { name: "Venues" })).toBeVisible();
  await venuesPage.locator('button:has-text("Delete"):visible').click();
  await expect(page.getByRole("dialog", { name: "Delete venue?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.setViewportSize({ height: 734, width: 844 });
  await page.goto("/admin/events/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/roster");
  const collapseNavigation = page.getByRole("button", {
    name: "Collapse workspace navigation",
  });
  await expect(collapseNavigation).toBeVisible();
  await expect(page.locator(".signed-in-header")).toHaveCSS("height", "60px");
  await expect(page.locator(".signed-in-sidebar")).toHaveCSS("top", "60px");
  await expect(page.locator(".sidebar-toolbar__button--pin path")).toHaveAttribute(
    "d",
    "M8 4h8v5l3 3H5l3-3V4M12 12v8",
  );
  await collapseNavigation.click();
  await expect(page.locator(".signed-in-sidebar")).toHaveCount(0);
  const openNavigation = page.getByRole("button", { name: "Open workspace navigation" });
  await expect(openNavigation).toBeVisible();
  await openNavigation.click();
  const navigationDrawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(navigationDrawer).toBeVisible();
  const pinNavigation = navigationDrawer.getByRole("button", { name: "Pin navigation open" });
  const closeNavigation = navigationDrawer.getByRole("button", { name: "Close navigation" });
  await expect(pinNavigation).toHaveClass(/sidebar-drawer__pin/);
  await expect(pinNavigation).toHaveCSS("width", "36px");
  await expect(closeNavigation).toHaveCSS("width", "36px");
  await expect(closeNavigation).toHaveCSS("height", "36px");
  await expect(pinNavigation.locator("svg")).toHaveCSS("overflow", "visible");
  await expect(pinNavigation.locator("path")).toHaveAttribute("d", "M8 4h8v5l3 3H5l3-3V4M12 12v8");

  await page.setViewportSize({ height: 734, width: 390 });
  const pinBox = await pinNavigation.boundingBox();
  const closeBox = await closeNavigation.boundingBox();
  const drawerBox = await navigationDrawer.boundingBox();
  expect(pinBox).not.toBeNull();
  expect(closeBox).not.toBeNull();
  expect(drawerBox).not.toBeNull();
  if (!pinBox || !closeBox || !drawerBox) {
    throw new Error("Workspace navigation controls should have visible geometry");
  }
  expect(Math.abs(pinBox.y - closeBox.y)).toBeLessThanOrEqual(1);
  expect(closeBox.x - (pinBox.x + pinBox.width)).toBeGreaterThanOrEqual(7);
  expect(closeBox.x - (pinBox.x + pinBox.width)).toBeLessThanOrEqual(9);
  expect(pinBox.x).toBeGreaterThanOrEqual(drawerBox.x);
  expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(drawerBox.x + drawerBox.width);

  await pinNavigation.click();
  await page.setViewportSize({ height: 734, width: 844 });
  await expect(navigationDrawer).toHaveCount(0);
  await expect(collapseNavigation).toBeVisible();
  await page.reload();
  await expect(collapseNavigation).toBeVisible();

  const rsvpPage = page.getByRole("main");
  const performanceSelect = rsvpPage
    .locator(".rsvp-manager__balance")
    .getByRole("combobox", { name: "Performance" });
  await expect(performanceSelect).toHaveValue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  await expect(performanceSelect).toHaveCSS("appearance", "auto");
  await expect(rsvpPage.locator(".rsvp-manager__roster").getByRole("combobox")).toHaveCount(0);
  await expect(rsvpPage.getByRole("textbox", { name: "Search active singers" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Export CSV" })).toHaveAttribute(
    "href",
    "/api/organization/events/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/rsvp-export.csv?sort=lastName",
  );
  const historyTab = rsvpPage.getByRole("tab", { name: "History", exact: true });
  await historyTab.click({ force: true });
  const historySection = rsvpPage.locator(".rsvp-manager__history");
  await expect(historySection.getByRole("heading", { name: "Event RSVP History" })).toHaveCount(1);
  const historySearch = historySection.getByRole("searchbox", { name: "Search history" });
  await expect(historySearch).toBeVisible();
  await expect(historySection.getByRole("columnheader", { name: /Changed/ })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await historySearch.fill("Browser Singer");
  await expect(
    historySection.locator("strong:visible").filter({ hasText: "Browser Singer" }),
  ).toBeVisible();
  await expect(
    historySection.locator("strong:visible").filter({ hasText: "Unexpected Singer" }),
  ).toHaveCount(0);
  await historySearch.fill("");
  await historySection.getByRole("combobox", { name: "Filter new RSVP" }).selectOption("No");
  await expect(
    historySection.locator("strong:visible").filter({ hasText: "Unexpected Singer" }),
  ).toBeVisible();
  await expect(
    historySection.locator("strong:visible").filter({ hasText: "Browser Singer" }),
  ).toHaveCount(0);
  await historySection.getByRole("button", { name: "Sort by Performer" }).click();
  await expect(historySection.getByRole("columnheader", { name: /Performer/ })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );

  await page.goto("/admin/settings/invitations");
  const invitationSection = page.getByRole("region", { name: "Invite a member" });
  await expect(invitationSection.getByLabel("Email address")).toBeVisible();
  await invitationSection.getByLabel("Email address").fill("future.member@example.test");
  await invitationSection
    .getByLabel("Organization role")
    .selectOption({ label: "Organization Administrator" });
  await invitationSection.getByRole("button", { name: "Create invitation" }).click();
  await expect(invitationSection.getByRole("status")).toContainText(
    "Invitation created for future.member@example.test",
  );

  await page.goto("/admin/settings/setup-checklist");
  const providerStatus = page.getByRole("region", { name: "Payments and email setup" });
  await expect(providerStatus.getByText("Platform-managed setup:")).toBeVisible();
  await expect(providerStatus.getByText("How platform setup works")).toHaveCount(0);

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("signs in as the recipient and accepts an Organization invitation", async ({ page }) => {
  let signedIn = false;
  const invitationId = "77777777-7777-4777-8777-777777777777";

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: "11111111-1111-4111-8111-111111111111",
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({
      body: JSON.stringify(signedIn ? { session: currentSession, user: currentUser } : null),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/email-otp/send-verification-otp", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ success: true }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/sign-in/email-otp", async (route) => {
    signedIn = true;
    await route.fulfill({
      body: JSON.stringify({ token: "not-used-by-browser-ui", user: currentUser }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(`**/api/organization/invitations/${invitationId}`, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        email: currentUser.email,
        expiresAt: "2026-07-22T08:00:00.000Z",
        id: invitationId,
        inviterEmail: "owner@example.test",
        organizationId: "organization-alpha",
        organizationName: "Organization Alpha",
        organizationSlug: "alpha",
        role: "member",
        status: "pending",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(`**/api/organization/invitations/${invitationId}/accept`, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        id: invitationId,
        requestId: "55555555-5555-4555-8555-555555555555",
        status: "accepted",
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/accept-invitation?id=${invitationId}`);
  await expect(page.getByRole("heading", { name: "Sign in to Choir Management." })).toBeVisible();
  await page.getByLabel("Email address").fill(currentUser.email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await page.getByLabel("6-digit sign-in code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Join Organization Alpha." })).toBeVisible();
  await expect(page.getByText(currentUser.email)).toBeVisible();
  await expect(page.getByText("Organization Member")).toBeVisible();
  await page.getByRole("button", { name: "Accept Organization invitation" }).click();
  await expect(page.getByRole("heading", { name: "You joined Organization Alpha." })).toBeVisible();
  await expect(page.getByText("Your Organization Membership is ready.")).toBeVisible();
});

test("requires confirmation before declining an Organization invitation", async ({ page }) => {
  const invitationId = "88888888-8888-4888-8888-888888888888";

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: "11111111-1111-4111-8111-111111111111",
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ session: currentSession, user: currentUser }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(`**/api/organization/invitations/${invitationId}`, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        email: currentUser.email,
        expiresAt: "2026-07-22T08:00:00.000Z",
        id: invitationId,
        inviterEmail: "owner@example.test",
        organizationId: "organization-alpha",
        organizationName: "Organization Alpha",
        organizationSlug: "alpha",
        role: "member",
        status: "pending",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(`**/api/organization/invitations/${invitationId}/reject`, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        id: invitationId,
        requestId: "55555555-5555-4555-8555-555555555555",
        status: "rejected",
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/accept-invitation?id=${invitationId}`);
  await expect(page.getByRole("heading", { name: "Join Organization Alpha." })).toBeVisible();
  await page.getByRole("button", { name: "Decline invitation" }).click();
  const confirmation = page.getByRole("group", { name: "Confirm invitation decline" });
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Accept Organization invitation" })).toBeVisible();
  await page.getByRole("button", { name: "Decline invitation" }).click();
  await confirmation.getByRole("button", { name: "Confirm: decline invitation" }).click();
  await expect(page.getByRole("heading", { name: "Invitation declined." })).toBeVisible();
  await expect(page.getByText("You did not join Organization Alpha.")).toBeVisible();
});

test("offers password MFA sign-in and completes non-enumerating account recovery", async ({
  page,
}) => {
  const resetToken = "browser-reset-token-123456";

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: "11111111-1111-4111-8111-111111111111",
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({ body: "null", contentType: "application/json", status: 200 });
  });
  await page.route("**/api/auth/sign-in/email", async (route) => {
    const body: unknown = route.request().postDataJSON();
    expect(body).toEqual({
      email: currentUser.email,
      password: "member-password-value",
    });
    await route.fulfill({
      body: JSON.stringify({ twoFactorMethods: ["totp"], twoFactorRedirect: true }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/request-password-reset", async (route) => {
    const body: unknown = route.request().postDataJSON();
    expect(body).toEqual({
      email: currentUser.email,
    });
    await route.fulfill({
      body: JSON.stringify({
        message: "If this email exists in our system, check your email for the reset link",
        status: true,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/reset-password", async (route) => {
    const body: unknown = route.request().postDataJSON();
    expect(body).toEqual({
      newPassword: "a-new-browser-password",
      token: resetToken,
    });
    await route.fulfill({
      body: JSON.stringify({ status: true }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/login");
  await page.getByRole("button", { name: "Password", exact: true }).click();
  await page.getByLabel("Email address").fill(currentUser.email);
  await page.getByLabel("Password", { exact: true }).fill("member-password-value");
  await page.getByRole("button", { name: "Sign in with password" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "Complete two-factor sign-in",
  );
  await expect(page.getByLabel("6-digit authenticator code")).toBeVisible();

  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill(currentUser.email.toUpperCase());
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "If that email belongs to an invited account",
  );

  await page.goto(`/reset-password#token=${resetToken}`);
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel("New password", { exact: true }).fill("a-new-browser-password");
  await page.getByLabel("Confirm new password").fill("a-different-password");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByRole("alert")).toContainText("passwords do not match");
  await page.getByLabel("Confirm new password").fill("a-new-browser-password");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("password was reset");
  await expect(
    page.getByRole("main").getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
});
