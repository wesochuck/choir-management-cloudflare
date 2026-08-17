import { expect, test, type Page, type Route } from "@playwright/test";

const requestId = "90909090-9090-4090-8090-909090909090";

function piece(id: string, title: string, composer: string, arranger: string) {
  return {
    arranger,
    catalogId: "",
    composer,
    copies: null,
    createdAt: "2026-08-17T00:00:00.000Z",
    durationSeconds: null,
    genres: [],
    id,
    lastPerformedAt: null,
    notes: "",
    parentId: null,
    performanceCount: 0,
    purchaseDate: null,
    sectionBuckets: [],
    title,
    trackFileIds: {},
    updatedAt: "2026-08-17T00:00:00.000Z",
  };
}

async function fulfill(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });
}

function isCreditRenameRequest(
  value: unknown,
): value is { readonly currentName: string; readonly newName: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "currentName" in value &&
    "newName" in value &&
    typeof value.currentName === "string" &&
    typeof value.newName === "string"
  );
}

async function installRoutes(page: Page): Promise<void> {
  let pieces = [
    piece("11111111-1111-4111-8111-111111111111", "First Work", "Jane Doe", "J. Smith"),
    piece("22222222-2222-4222-8222-222222222222", "Second Work", "Jane Doe", "Jane Doe"),
  ];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/organization/music/credits/rename") {
      const body: unknown = route.request().postDataJSON();
      if (!isCreditRenameRequest(body)) {
        await fulfill(route, { code: "validation_failed", requestId }, 400);
        return;
      }
      expect(body).toEqual({ currentName: "Jane Doe", newName: "Jane Q. Doe" });
      pieces = pieces.map((item) => ({
        ...item,
        arranger: item.arranger === body.currentName ? body.newName : item.arranger,
        composer: item.composer === body.currentName ? body.newName : item.composer,
      }));
      await fulfill(route, { pieces, requestId });
      return;
    }
    const responses: Record<string, unknown> = {
      "/api/account/organizations": {
        organizations: [
          {
            canonicalHostname: "music.example.test",
            canonicalStatus: "active",
            lifecycleState: "active",
            name: "Music Test Choir",
            organizationId: "music-test-organization",
            profileId: null,
            role: "administrator",
            slug: "music-test",
          },
        ],
      },
      "/api/auth/get-session": {
        session: {
          activeOrganizationId: "music-test-organization",
          createdAt: "2026-08-17T00:00:00.000Z",
          expiresAt: "2027-08-17T00:00:00.000Z",
          id: "music-test-session",
          ipAddress: "192.0.2.1",
          token: "browser-test-token",
          updatedAt: "2026-08-17T00:00:00.000Z",
          userAgent: "Playwright",
          userId: "music-test-user",
        },
        user: {
          createdAt: "2026-08-17T00:00:00.000Z",
          email: "music.test@example.test",
          emailVerified: true,
          id: "music-test-user",
          image: null,
          name: "Music Test Administrator",
          twoFactorEnabled: false,
          updatedAt: "2026-08-17T00:00:00.000Z",
        },
      },
      "/api/health": {
        baseHostname: "127.0.0.1",
        environment: "local",
        requestId,
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      },
      "/api/organization/auth-status": {
        mfaRequired: false,
        mfaVerifiedUntil: null,
        organizationId: "music-test-organization",
        requestId,
        role: "administrator",
        twoFactorEnabled: false,
        twoFactorVerified: false,
      },
      "/api/organization/calendar-settings": { requestId, timezone: "America/New_York" },
      "/api/organization/events": { events: [], requestId },
      "/api/organization/module-state": {
        modules: [
          { enabled: true, id: "events" },
          { enabled: true, id: "people" },
          { enabled: true, id: "programs" },
        ],
      },
      "/api/organization/music": { pieces, requestId },
      "/api/organization/music-library-settings": {
        practicePlayerLinkLifetimeDays: 180,
        publisherSearchTemplate: "",
        requestId,
      },
      "/api/organization/roster-configuration": {
        attendanceReportWarningThreshold: 3,
        onBreakTimeoutDays: 90,
        onBreakTimeoutEnabled: false,
        performerLabel: "Performer",
        requestId,
        rsvpExpiryEnabled: false,
        rsvpExpiryLeadDays: 3,
        rsvpFollowUpEnabled: false,
        rsvpFollowUpLeadHours: 48,
        sections: [{ code: "S", color: "#1b4d3e", name: "Sopranos", trackOnly: false }],
        statusAutomationEnabled: false,
        statusAutomationMissThreshold: 3,
        statusAutomationRecoveryEnabled: true,
        voiceParts: [{ fullName: "Soprano 1", label: "S1", sectionCode: "S" }],
      },
      "/api/organization/venues": { requestId, venues: [] },
      "/api/platform/mfa/status": {
        activePlatformAdministrator: false,
        enrollmentComplete: false,
        requestId,
        twoFactorEnabled: false,
      },
      "/api/public/projection": { code: "not_found", requestId },
      "/api/setup/status": {
        allModulesConfigured: true,
        completedSteps: [],
        currentStep: null,
        launched: true,
        organizationId: "music-test-organization",
        organizationName: "Music Test Choir",
      },
    };
    await fulfill(
      route,
      responses[url.pathname] ?? { code: "not_found", message: "Not found", requestId },
      url.pathname === "/api/public/projection" ? 404 : responses[url.pathname] ? 200 : 404,
    );
  });
}

test("renames a composer credit from the bookmarkable directory and updates the catalog", async ({
  page,
}) => {
  await installRoutes(page);
  await page.goto("/admin/library?view=credits");

  await expect(page.getByRole("link", { name: "Composers & arrangers" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const mobile = page.viewportSize()?.width ?? 1_280;
  const creditRow =
    mobile < 600
      ? page.locator(".data-table-card:visible").filter({ hasText: "Jane Doe" })
      : page.locator("tbody tr:visible").filter({ hasText: "Jane Doe" });
  await expect(creditRow).toBeVisible();
  await expect(creditRow.getByText("2", { exact: true }).first()).toBeVisible();
  await creditRow.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("New credit name").fill("   ");
  await expect(page.getByRole("button", { name: "Rename credit" })).toBeDisabled();
  await page.getByLabel("New credit name").fill("Jane Q. Doe");
  await expect(page.getByRole("button", { name: "Rename credit" })).toBeEnabled();
  await page.getByRole("button", { name: "Rename credit" }).click();
  await expect(
    page.getByText(/Renamed Jane Doe to Jane Q\. Doe across 2 distinct music pieces/),
  ).toBeVisible();
  await expect(
    mobile < 600
      ? page.locator(".data-table-card:visible").filter({ hasText: "Jane Q. Doe" })
      : page.locator("tbody tr:visible").filter({ hasText: "Jane Q. Doe" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Music Catalog" }).click();
  await expect(
    mobile < 600
      ? page.locator(".data-table-card:visible").filter({ hasText: "Jane Q. Doe / arr. J. Smith" })
      : page.locator("tbody tr:visible").filter({ hasText: "Jane Q. Doe / arr. J. Smith" }),
  ).toBeVisible();
});
