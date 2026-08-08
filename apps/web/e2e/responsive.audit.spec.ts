import { expect, test, type Page, type Route } from "@playwright/test";

// Responsive audit: renders key signed-in pages at the breakpoint ladder and
// asserts the document never overflows horizontally. API responses are mocked
// (matching the other e2e specs); the real app markup and CSS are exercised.

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const musicId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const profileId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const seasonId = "12121212-1212-4121-8121-121212121212";
const pollId = "34343434-3434-4343-8434-343434343434";

const memberDashboardRehearsal = {
  attendanceWarning: null,
  callTime: "18:00",
  details: "Bring your music.",
  directRsvp: "Pending" as const,
  durationMinutes: 120,
  featuredAssignments: [],
  id: eventId,
  inheritedFromParent: false,
  location: "Choir Room",
  practice: { sourceEventId: null, status: "not_published" as const, trackCount: 0 },
  resolvedRsvp: "Pending" as const,
  rsvpDeadlineAt: null,
  rsvpDeadlineDate: null,
  rsvpDeadlinePassed: false,
  rsvpNote: "",
  rsvpSelfServiceOpen: true,
  seating: { status: "not_published" as const },
  setList: [],
  startsAt: "2026-08-21T23:00:00.000Z",
  title: "Weekly Rehearsal",
  type: "Rehearsal" as const,
  venueAddress: "",
  venueName: "",
};

const memberSchedulePerformance = {
  ...memberDashboardRehearsal,
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  title: "Schedule Performance",
  type: "Performance" as const,
};

const memberScheduleRehearsal = {
  ...memberDashboardRehearsal,
  id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  title: "Schedule Rehearsal",
};

const session = {
  session: {
    activeOrganizationId: null,
    createdAt: "2026-07-20T20:00:00.000Z",
    expiresAt: "2026-07-27T20:00:00.000Z",
    id: "session-responsive",
    ipAddress: "192.0.2.40",
    token: "responsive-token-not-displayed",
    updatedAt: "2026-07-20T20:00:00.000Z",
    userAgent: "Chromium browser",
    userId: "user-responsive-admin",
  },
  user: {
    createdAt: "2026-07-20T19:00:00.000Z",
    email: "responsive.admin@example.test",
    emailVerified: true,
    id: "user-responsive-admin",
    image: null,
    name: "Responsive Admin",
    twoFactorEnabled: false,
    updatedAt: "2026-07-20T19:00:00.000Z",
  },
};

const widths = [390, 640, 768, 900, 1024, 1280];

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });
}

async function handleShellRoute(route: Route): Promise<boolean> {
  const pathname = new URL(route.request().url()).pathname;
  const responses: Record<string, unknown> = {
    "/api/account/organizations": {
      organizations: [
        {
          canonicalHostname: "setlist.example.test",
          canonicalStatus: "active",
          lifecycleState: "active",
          name: "Responsive Choir",
          organizationId: "org-responsive",
          profileId: null,
          role: "administrator",
          slug: "responsive",
        },
      ],
    },
    "/api/auth/get-session": session,
    "/api/account/sessions": [session.session],
    "/api/health": {
      environment: "local",
      requestId,
      service: "choir-management-cloudflare",
      status: "ok",
      version: "browser-test",
    },
    "/api/organization/module-state": {
      modules: [
        { enabled: true, id: "events" },
        { enabled: true, id: "people" },
        { enabled: true, id: "programs" },
        { enabled: true, id: "communications" },
        { enabled: true, id: "finance" },
      ],
    },
    "/api/organization/auth-status": {
      mfaRequired: false,
      mfaVerifiedUntil: null,
      organizationId: "org-responsive",
      requestId,
      role: "administrator",
      twoFactorEnabled: false,
      twoFactorVerified: false,
    },
    "/api/platform/mfa/status": {
      activePlatformAdministrator: false,
      enrollmentComplete: false,
      requestId,
      twoFactorEnabled: false,
    },
    "/api/setup/status": {
      allModulesConfigured: true,
      completedSteps: [],
      currentStep: null,
      launched: true,
      organizationId: "org-responsive",
      organizationName: "Responsive Choir",
    },
  };
  if (pathname === "/api/public/projection") {
    await route.fulfill({ status: 404 });
    return true;
  }
  const body = responses[pathname];
  if (body === undefined) return false;
  await fulfillJson(route, body);
  return true;
}

const events = [
  {
    advancePriceCents: 2500,
    callTime: "18:00",
    createdAt: "2026-07-20T20:00:00.000Z",
    dayOfPriceCents: 3000,
    details:
      "Long details text that should wrap gracefully on narrow screens without forcing the layout wider.",
    doorsOpenTime: "17:30",
    durationMinutes: 150,
    id: eventId,
    isTicketingEnabled: true,
    location: "Main Concert Hall, Downtown Performing Arts Center",
    parentPerformanceId: null,
    publicDetails: "",
    publicGraphicFileId: null,
    publishOnWebsite: false,
    setList: [
      {
        composer: "Composer A",
        id: "item-a",
        pieceId: musicId,
        title: "Opening Song",
        type: "song",
      },
      { composer: "Composer B", id: "item-b", pieceId: musicId, title: "Finale", type: "song" },
    ],
    setListApproved: true,
    startsAt: "2026-08-20T23:00:00.000Z",
    ticketCapacity: 500,
    title: "Summer Concert Series: An Evening of Choral Masterworks",
    type: "Performance" as const,
    venueId: null,
    updatedAt: "2026-07-20T20:00:00.000Z",
  },
  {
    advancePriceCents: 0,
    callTime: "19:00",
    createdAt: "2026-07-20T20:00:00.000Z",
    dayOfPriceCents: 0,
    details: "",
    doorsOpenTime: "",
    durationMinutes: 90,
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    isTicketingEnabled: false,
    location: "Rehearsal Hall B",
    parentPerformanceId: null,
    publicDetails: "",
    publicGraphicFileId: null,
    publishOnWebsite: false,
    setList: [],
    setListApproved: false,
    startsAt: "2026-08-21T23:00:00.000Z",
    ticketCapacity: null,
    title: "Weekly Rehearsal",
    type: "Rehearsal" as const,
    venueId: null,
    updatedAt: "2026-07-20T20:00:00.000Z",
  },
];

const responsiveManagerResponses: Record<string, unknown> = {
  "/api/organization/dues": { dues: [], requestId },
  "/api/organization/donation-settings": {
    buttonText: "Give now",
    description: "Support our choir.",
    levels: [],
    requestId,
  },
  "/api/organization/donations": { donations: [], requestId },
  "/api/organization/patrons": { patrons: [], requestId },
  "/api/organization/polls": {
    polls: [
      {
        archivedAt: "",
        createdAt: "2026-07-20T20:00:00.000Z",
        expiresAt: "",
        id: pollId,
        responseCount: 0,
        title: "Responsive poll",
      },
    ],
    requestId,
  },
  "/api/organization/seasons": {
    requestId,
    seasons: [
      {
        createdAt: "2026-07-20T20:00:00.000Z",
        duesAmountCents: 12000,
        endsAt: "2026-12-31T23:59:59.000Z",
        id: seasonId,
        isActive: true,
        name: "Fall season",
        startsAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-07-20T20:00:00.000Z",
      },
    ],
  },
  "/api/organization/ticket-confirmation-settings": {
    pendingMessage: "Your order is pending.",
    qrCodeInstructions: "Show this code at the door.",
    requestId,
    successMessage: "Your order is confirmed.",
    willCallInstructions: "Pick up tickets at will call.",
  },
  "/api/organization/tickets/bundles": { bundles: [], requestId },
  "/api/organization/tickets/orders": { orders: [], requestId },
};

async function handleDataRoute(route: Route): Promise<boolean> {
  const url = new URL(route.request().url());
  if (url.pathname === "/api/organization/events") {
    await fulfillJson(route, { events, requestId });
    return true;
  }
  if (url.pathname === `/api/organization/events/${eventId}`) {
    await fulfillJson(route, events[0]);
    return true;
  }
  if (url.pathname === "/api/organization/music") {
    await fulfillJson(route, {
      pieces: [
        {
          arranger: "",
          catalogId: "",
          composer: "Composer A",
          copies: null,
          createdAt: "2026-07-20T20:00:00.000Z",
          durationSeconds: 180,
          genres: [],
          id: musicId,
          lastPerformedAt: null,
          notes: "",
          parentId: null,
          performanceCount: 1,
          purchaseDate: null,
          sectionBuckets: [],
          title: "Opening Song",
          trackFileIds: {},
          updatedAt: "2026-07-20T20:00:00.000Z",
        },
      ],
      requestId,
    });
    return true;
  }
  if (url.pathname === "/api/organization/profiles") {
    await fulfillJson(route, {
      profiles: [
        {
          createdAt: "2026-07-20T20:00:00.000Z",
          displayName: "Responsive Singer",
          doNotEmail: false,
          globalStatus: "Active",
          id: profileId,
          isSectionLeader: false,
          notes: "",
          phone: "",
          receiveAdminNotifications: true,
          receiveAttendanceReports: true,
          receiveFinancialAlerts: false,
          receiveRsvpDeclineNotices: false,
          showInDirectory: true,
          updatedAt: "2026-07-20T20:00:00.000Z",
          voicePart: "Soprano",
        },
      ],
      requestId,
    });
    return true;
  }
  const managerResponse = responsiveManagerResponses[url.pathname];
  if (managerResponse !== undefined) {
    await fulfillJson(route, managerResponse);
    return true;
  }
  if (url.pathname === "/api/organization/venues") {
    await fulfillJson(route, {
      requestId,
      venues: [
        {
          address: "1 Music Way",
          createdAt: "2026-07-20T20:00:00.000Z",
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          name: "Main Concert Hall",
          updatedAt: "2026-07-20T20:00:00.000Z",
        },
      ],
    });
    return true;
  }
  if (url.pathname === "/api/organization/dashboard-summary") {
    await fulfillJson(route, {
      activeProfileCount: 42,
      nextEvents: events.slice(0, 2),
      requestId,
      upcomingEventCount: 6,
    });
    return true;
  }
  if (url.pathname === "/api/singer/dashboard") {
    await fulfillJson(route, {
      activeSeason: null,
      activeSeasonState: "disabled",
      bulletins: [],
      bulletinsState: "ready",
      events: [memberDashboardRehearsal],
      modules: [
        { enabled: true, id: "events" },
        { enabled: true, id: "people" },
        { enabled: true, id: "programs" },
      ],
      organizationName: "Responsive Choir",
      performerLabel: "Singer",
      polls: [],
      pollsState: "ready",
      profile: { displayName: "Responsive Singer", id: profileId, voicePart: "Soprano" },
      profileLinkRequired: false,
      requestId,
      resources: [],
      resourcesState: "ready",
      timezone: "America/New_York",
    });
    return true;
  }
  if (url.pathname === "/api/singer/events") {
    await fulfillJson(route, {
      events: [memberSchedulePerformance, memberScheduleRehearsal],
      profileId,
      requestId,
      timezone: "America/New_York",
    });
    return true;
  }
  return false;
}

async function assertStackedFields(
  page: Page,
  selector: string,
  expectedCount: number,
): Promise<void> {
  const fieldsLocator = page.locator(selector);
  await expect(fieldsLocator).toHaveCount(expectedCount);
  const filterFields = await fieldsLocator.evaluateAll((fields) =>
    fields.map((field) => {
      const rect = field.getBoundingClientRect();
      return { bottom: rect.bottom, top: rect.top };
    }),
  );
  expect(filterFields).toHaveLength(expectedCount);
  for (let index = 1; index < filterFields.length; index += 1) {
    expect(filterFields[index]?.top).toBeGreaterThanOrEqual(
      (filterFields[index - 1]?.bottom ?? 0) - 1,
    );
  }
}

async function assertBreakpointSpecificLayout(
  page: Page,
  path: string,
  width: number,
): Promise<void> {
  if (path === "/admin/events" && width <= 768) {
    const searchFieldSize = await page
      .locator(".event-manager-search .search-field")
      .evaluate((label) => ({
        inputHeight: label.querySelector("input")?.getBoundingClientRect().height ?? 0,
        labelHeight: label.getBoundingClientRect().height,
      }));
    expect(searchFieldSize.labelHeight).toBeLessThanOrEqual(searchFieldSize.inputHeight + 1);
  }
  if (path === "/admin/seasons" && width <= 1024) {
    await assertStackedFields(page, "#dues-records-panel .dues-records-toolbar > .field", 2);
  }
  if (path === "/admin/donations" && width <= 1024) {
    await assertStackedFields(page, ".donation-dashboard__filters > .field", 4);
  }
  if (path === "/admin/tickets" && width <= 1024) {
    const metricsLocator = page.locator(
      ".ticket-dashboard:not(.donation-dashboard) .ticket-dashboard__metric",
    );
    await expect(metricsLocator).toHaveCount(4);
    const metrics = await metricsLocator.evaluateAll((cards) =>
      cards.map((card) => {
        const cardRight = card.getBoundingClientRect().right;
        const overflowingDescendant = [...card.querySelectorAll("*")].some(
          (descendant) => descendant.getBoundingClientRect().right > cardRight + 1,
        );
        return { overflowingDescendant };
      }),
    );
    expect(metrics.map(({ overflowingDescendant }) => overflowingDescendant)).not.toContain(true);
  }
  if (path === "/admin/polls" && width > 640) {
    await expect(page.getByRole("columnheader", { name: "Sharing" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Actions" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share with members" })).toBeVisible();
  }
}

test("signed-in pages never overflow horizontally at any breakpoint", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    if (await handleShellRoute(route)) return;
    if (await handleDataRoute(route)) return;
    await fulfillJson(route, { requestId });
  });

  const pages = [
    { path: "/dashboard", label: "member dashboard" },
    { path: "/admin", label: "admin overview" },
    { path: "/admin/donations", label: "donations" },
    { path: "/admin/events", label: "events" },
    { path: "/admin/polls", label: "polls" },
    { path: "/admin/tickets", label: "ticketing" },
    { path: "/admin/seasons", label: "seasons and dues" },
    { path: "/admin/setlists", label: "set lists" },
  ];

  for (const { path, label } of pages) {
    await page.goto(path);
    // The signed-in shell must render. The header stays visible at every
    // breakpoint (the sidebar nav collapses to a hamburger below 48rem).
    await expect(
      page.locator(".signed-in-header"),
      `${label}: signed-in shell did not render`,
    ).toBeVisible();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(120);
      await assertBreakpointSpecificLayout(page, path, width);
      const audit = await page.evaluate(() => {
        const viewport = window.innerWidth;
        const scrollWidth = document.documentElement.scrollWidth;
        const offenders = [...document.querySelectorAll("body *")]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.right > viewport + 1 && getComputedStyle(element).position !== "fixed";
          })
          .slice(0, 8)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const chain = [];
            let parent = element.parentElement;
            for (let i = 0; i < 3 && parent; i += 1) {
              const pr = parent.getBoundingClientRect();
              const parentClass = typeof parent.className === "string" ? parent.className : "";
              chain.push(
                `${parent.tagName.toLowerCase()}.${parentClass.split(" ").slice(0, 2).join(".")}[${String(Math.round(pr.left))}-${String(Math.round(pr.right))}]`,
              );
              parent = parent.parentElement;
            }
            const elementClass = typeof element.className === "string" ? element.className : "";
            const left = String(Math.round(rect.left));
            const right = String(Math.round(rect.right));
            return `${element.tagName.toLowerCase()}.${elementClass.split(" ").slice(0, 2).join(".")}[${left}-${right}] margin:${style.marginLeft}/${style.marginRight} chain:${chain.join(" > ")}`;
          });
        return { overflow: scrollWidth > viewport, offenders };
      });
      expect(
        audit.overflow,
        `${label} @ ${String(width)}px overflows horizontally: ${audit.offenders.join(", ")}`,
      ).toBe(false);
    }
  }
});

test("member RSVP actions show feedback and use a decline modal", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (await handleShellRoute(route)) return;
    if (url.pathname === `/api/singer/events/${eventId}/rsvp`) {
      const body: unknown = route.request().postDataJSON();
      const rsvp =
        typeof body === "object" &&
        body !== null &&
        "rsvp" in body &&
        (body.rsvp === "No" || body.rsvp === "Yes")
          ? body.rsvp
          : "Pending";
      const rsvpNote =
        typeof body === "object" &&
        body !== null &&
        "rsvpNote" in body &&
        typeof body.rsvpNote === "string"
          ? body.rsvpNote
          : "";
      await fulfillJson(route, {
        eventId,
        profileId,
        requestId,
        rsvp,
        rsvpNote,
        updatedAt: "2026-07-20T20:10:00.000Z",
      });
      return;
    }
    if (await handleDataRoute(route)) return;
    await fulfillJson(route, { requestId });
  });

  await page.goto("/dashboard");
  const eventCard = page
    .locator("article.member-dashboard__event-card")
    .filter({ hasText: "Weekly Rehearsal" });
  await expect(eventCard).toBeVisible();
  await eventCard.getByRole("button", { name: "Attend", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Your RSVP was updated.");

  await eventCard.getByRole("button", { name: "Decline", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Decline rehearsal" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Decline rehearsal" })).toBeDisabled();
  await dialog.getByLabel("Note").fill("Travel conflict");
  await dialog.getByRole("button", { name: "Decline rehearsal" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status")).toContainText("Your RSVP was updated.");
});

test("member schedule uses Yes and No buttons for RSVP choices", async ({ page }) => {
  let scheduleRsvp: "No" | "Pending" | "Yes" = "Pending";
  let scheduleRsvpNote = "";
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (await handleShellRoute(route)) return;
    if (url.pathname === "/api/singer/events") {
      await fulfillJson(route, {
        events: [
          memberSchedulePerformance,
          {
            ...memberScheduleRehearsal,
            directRsvp: scheduleRsvp,
            inheritedFromParent: scheduleRsvp === "Pending",
            resolvedRsvp: scheduleRsvp,
            rsvpNote: scheduleRsvp === "No" ? scheduleRsvpNote : "",
          },
        ],
        profileId,
        requestId,
        timezone: "America/New_York",
      });
      return;
    }
    if (url.pathname.endsWith("/rsvp")) {
      const body: unknown = route.request().postDataJSON();
      const rsvp =
        typeof body === "object" &&
        body !== null &&
        "rsvp" in body &&
        (body.rsvp === "No" || body.rsvp === "Yes")
          ? body.rsvp
          : "Pending";
      scheduleRsvp = rsvp;
      scheduleRsvpNote =
        typeof body === "object" &&
        body !== null &&
        "rsvpNote" in body &&
        typeof body.rsvpNote === "string"
          ? body.rsvpNote
          : "";
      await fulfillJson(route, {
        eventId: memberScheduleRehearsal.id,
        profileId,
        requestId,
        rsvp,
        rsvpNote: scheduleRsvpNote,
        updatedAt: "2026-07-20T20:10:00.000Z",
      });
      return;
    }
    if (await handleDataRoute(route)) return;
    await fulfillJson(route, { requestId });
  });

  await page.goto("/schedule");
  const scheduleRehearsal = page
    .locator(".schedule-list > li")
    .filter({ hasText: "Schedule Rehearsal" });
  await expect(scheduleRehearsal).toBeVisible();
  await expect(page.locator(".schedule-rsvp select")).toHaveCount(0);
  await expect(scheduleRehearsal.getByRole("button", { name: "Yes", exact: true })).toBeVisible();
  await expect(scheduleRehearsal.getByRole("button", { name: "No", exact: true })).toBeVisible();

  await scheduleRehearsal.getByRole("button", { name: "No", exact: true }).click();
  const declineNote = scheduleRehearsal.getByLabel("Decline note (required)", { exact: true });
  await expect(declineNote).toBeVisible();
  await expect(scheduleRehearsal.getByRole("button", { name: "Save RSVP" })).toBeDisabled();
  await declineNote.fill("Travel conflict");
  await scheduleRehearsal.getByRole("button", { name: "Save RSVP" }).click();
  await expect(page.getByRole("status")).toContainText("Your RSVP was updated.");
  await expect(scheduleRehearsal.getByRole("button", { name: "No", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
