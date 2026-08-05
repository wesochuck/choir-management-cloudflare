import { expect, test, type Route } from "@playwright/test";

// Responsive audit: renders key signed-in pages at the breakpoint ladder and
// asserts the document never overflows horizontally. API responses are mocked
// (matching the other e2e specs); the real app markup and CSS are exercised.

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const musicId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const profileId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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
      events: [],
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
  return false;
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
    { path: "/admin/events", label: "events" },
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
