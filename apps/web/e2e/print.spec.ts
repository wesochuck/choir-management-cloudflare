import { expect, test, type Route } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { buildSeatingChart } from "./fixtures/builders";

const setListRequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const setListEventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const setListMusicId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const setListSession = {
  session: {
    activeOrganizationId: null,
    createdAt: "2026-07-20T20:00:00.000Z",
    expiresAt: "2026-07-27T20:00:00.000Z",
    id: "session-print-setlist",
    ipAddress: "192.0.2.30",
    token: "print-setlist-token",
    updatedAt: "2026-07-20T20:00:00.000Z",
    userAgent: "Chromium browser",
    userId: "user-print-admin",
  },
  user: {
    createdAt: "2026-07-20T19:00:00.000Z",
    email: "print.admin@example.test",
    emailVerified: true,
    id: "user-print-admin",
    image: null,
    name: "Print Admin",
    twoFactorEnabled: false,
    updatedAt: "2026-07-20T19:00:00.000Z",
  },
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });
}

test.describe("Consolidated Print Stylesheet (@media print)", () => {
  test("seating chart print layout hides screen chrome and formats canvas for landscape print", async ({
    page,
  }) => {
    const api = await installOrganizationApi(page, { role: "administrator", strict: true });
    api.seatingCharts.set([buildSeatingChart()]);

    await page.goto("/admin/seating");
    await expect(page.getByRole("heading", { name: "Performance seating" })).toBeVisible();

    if ((page.viewportSize()?.width ?? 1000) <= 700) {
      const editAnyway = page.getByRole("button", { name: "Edit anyway" });
      if (await editAnyway.isVisible()) {
        await editAnyway.click();
      }
    }

    // Ensure chart canvas is rendered
    await expect(page.locator(".seating-editor-canvas")).toBeVisible();

    // Verify screen media: header and seating toolbar are displayed
    await page.emulateMedia({ media: "screen" });
    const screenHeaderDisplay = await page
      .locator(".signed-in-header")
      .evaluate((element) => getComputedStyle(element).display);
    expect(screenHeaderDisplay).not.toBe("none");

    const screenToolbarDisplay = await page
      .locator(".seating-toolbar-card")
      .evaluate((element) => getComputedStyle(element).display);
    expect(screenToolbarDisplay).not.toBe("none");

    // Verify @page rule is defined with landscape size and 0.35in margin
    const pageRuleMatched = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules)) {
            if (rule instanceof CSSPageRule) {
              const cssText = rule.cssText.toLowerCase();
              if (cssText.includes("landscape") && cssText.includes("0.35in")) {
                return true;
              }
            }
          }
        } catch {
          // Cross-origin stylesheet access might fail
        }
      }
      return false;
    });
    expect(pageRuleMatched).toBe(true);

    // Emulate print media
    await page.emulateMedia({ media: "print" });

    // Assert screen chrome is hidden via print stylesheet
    const printHeaderDisplay = await page
      .locator(".signed-in-header")
      .evaluate((element) => getComputedStyle(element).display);
    expect(printHeaderDisplay).toBe("none");

    const printSidebar = page.locator(".signed-in-sidebar");
    if ((await printSidebar.count()) > 0) {
      const printSidebarDisplay = await printSidebar.evaluate(
        (element) => getComputedStyle(element).display,
      );
      expect(printSidebarDisplay).toBe("none");
    }

    const printToolbarDisplay = await page
      .locator(".seating-toolbar-card")
      .evaluate((element) => getComputedStyle(element).display);
    expect(printToolbarDisplay).toBe("none");

    const tray = page.locator(".seating-tray");
    if ((await tray.count()) > 0) {
      const printTrayDisplay = await tray.evaluate((element) => getComputedStyle(element).display);
      expect(printTrayDisplay).toBe("none");
    }

    // Assert shell unconstrained and styled for print
    const shellStyles = await page.locator(".signed-in-shell").evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        backgroundColor: styles.backgroundColor,
        maxWidth: styles.maxWidth,
      };
    });
    expect(shellStyles.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(shellStyles.maxWidth).toBe("none");

    // Assert seating canvas visible and formatted as flex column
    const canvasStyles = await page.locator(".seating-editor-canvas").evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        display: styles.display,
        flexDirection: styles.flexDirection,
        maxWidth: styles.maxWidth,
      };
    });
    expect(canvasStyles.display).toBe("flex");
    expect(canvasStyles.flexDirection).toBe("column");
    expect(canvasStyles.maxWidth).toBe("none");

    // Assert seating rows are visible grid rows avoiding page breaks
    const firstRowStyles = await page
      .locator(".seating-row--canvas")
      .first()
      .evaluate((element) => {
        const styles = getComputedStyle(element);
        return {
          breakInside: styles.breakInside,
          display: styles.display,
        };
      });
    expect(firstRowStyles.display).toBe("grid");
    expect(firstRowStyles.breakInside).toBe("avoid");

    // Switch back to screen and verify screen chrome is restored
    await page.emulateMedia({ media: "screen" });
    const restoredHeaderDisplay = await page
      .locator(".signed-in-header")
      .evaluate((element) => getComputedStyle(element).display);
    expect(restoredHeaderDisplay).not.toBe("none");
  });

  test("seating name index print layout renders multi-column grid and avoids page breaks", async ({
    page,
  }) => {
    const api = await installOrganizationApi(page, { role: "administrator", strict: true });
    api.seatingCharts.set([buildSeatingChart()]);

    await page.goto("/admin/seating");

    if ((page.viewportSize()?.width ?? 1000) <= 700) {
      const editAnyway = page.getByRole("button", { name: "Edit anyway" });
      if (await editAnyway.isVisible()) {
        await editAnyway.click();
      }
    }

    // Switch to Last Name Index view mode
    const indexButton = page.getByRole("button", { name: "Last name index" });
    await expect(indexButton).toBeVisible();
    await indexButton.click();

    await expect(page.locator(".seating-name-index")).toBeVisible();
    await expect(page.locator(".seating-name-index__entries")).toBeVisible();

    // Emulate print media
    await page.emulateMedia({ media: "print" });

    const indexStyles = await page.locator(".seating-name-index").evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        breakInside: styles.breakInside,
        width: styles.width,
      };
    });
    expect(indexStyles.breakInside).toBe("avoid");

    const entriesStyles = await page.locator(".seating-name-index__entries").evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        display: styles.display,
        gridTemplateColumns: styles.gridTemplateColumns.split(" ").length,
      };
    });
    expect(entriesStyles.display).toBe("grid");
    // repeat(4, minmax(0, 1fr)) resolves to 4 column tracks
    expect(entriesStyles.gridTemplateColumns).toBe(4);
  });

  test("set list print layout hides editing chrome and renders print-safe items", async ({
    page,
  }) => {
    const eventRef = {
      advancePriceCents: 0,
      callTime: "18:00",
      dayOfPriceCents: 0,
      details: "",
      doorsOpenTime: "",
      durationMinutes: 90,
      id: setListEventId,
      isTicketingEnabled: false,
      location: "Main Hall",
      parentPerformanceId: null,
      publicDetails: "",
      publicGraphicFileId: null,
      publishOnWebsite: false,
      setList: [
        {
          composer: "Composer A",
          id: "item-1",
          pieceId: setListMusicId,
          title: "First Anthem",
          type: "song",
        },
        {
          composer: "Composer B",
          id: "item-2",
          pieceId: setListMusicId,
          title: "Second Anthem",
          type: "song",
        },
      ],
      setListApproved: false,
      startsAt: "2026-08-20T23:00:00.000Z",
      ticketCapacity: null,
      title: "Print Set List Performance",
      type: "Performance",
      venueId: null,
      createdAt: "2026-07-20T20:00:00.000Z",
      updatedAt: "2026-07-20T20:00:00.000Z",
    };

    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/auth/get-session") {
        await fulfillJson(route, setListSession);
        return;
      }
      if (url.pathname === "/api/account/sessions") {
        await fulfillJson(route, [setListSession.session]);
        return;
      }
      if (url.pathname === "/api/health") {
        await fulfillJson(route, {
          environment: "local",
          requestId: setListRequestId,
          service: "choir-management-cloudflare",
          status: "ok",
          version: "browser-test",
        });
        return;
      }
      if (url.pathname === "/api/account/organizations") {
        await fulfillJson(route, {
          organizations: [
            {
              canonicalHostname: "print.example.test",
              canonicalStatus: "active",
              lifecycleState: "active",
              name: "Print Choir",
              organizationId: "org-print",
              profileId: null,
              role: "administrator",
              slug: "print",
            },
          ],
        });
        return;
      }
      if (url.pathname === "/api/organization/module-state") {
        await fulfillJson(route, {
          modules: [
            { enabled: true, id: "events" },
            { enabled: true, id: "people" },
            { enabled: true, id: "programs" },
          ],
        });
        return;
      }
      if (url.pathname === "/api/organization/auth-status") {
        await fulfillJson(route, {
          mfaRequired: false,
          mfaVerifiedUntil: null,
          organizationId: "org-print",
          requestId: setListRequestId,
          role: "administrator",
          twoFactorEnabled: false,
          twoFactorVerified: false,
        });
        return;
      }
      if (url.pathname === "/api/platform/mfa/status") {
        await fulfillJson(route, {
          activePlatformAdministrator: false,
          enrollmentComplete: false,
          requestId: setListRequestId,
          twoFactorEnabled: false,
        });
        return;
      }
      if (url.pathname === "/api/setup/status") {
        await fulfillJson(route, {
          allModulesConfigured: true,
          completedSteps: [],
          currentStep: null,
          launched: true,
          organizationId: "org-print",
          organizationName: "Print Choir",
        });
        return;
      }
      if (
        url.pathname === "/api/organization/events" ||
        url.pathname === `/api/organization/events/${setListEventId}`
      ) {
        await fulfillJson(route, { events: [eventRef], requestId: setListRequestId });
        return;
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
              id: setListMusicId,
              lastPerformedAt: null,
              notes: "",
              parentId: null,
              performanceCount: 1,
              purchaseDate: null,
              sectionBuckets: [],
              title: "First Anthem",
              trackFileIds: {},
              updatedAt: "2026-07-20T20:00:00.000Z",
            },
          ],
          requestId: setListRequestId,
        });
        return;
      }
      if (url.pathname === "/api/organization/profiles") {
        await fulfillJson(route, { profiles: [], requestId: setListRequestId });
        return;
      }
      if (url.pathname === "/api/organization/venues") {
        await fulfillJson(route, { requestId: setListRequestId, venues: [] });
        return;
      }
      await fulfillJson(route, { requestId: setListRequestId });
    });

    await page.goto("/admin/setlists");
    await expect(page.getByRole("heading", { name: "Set lists" })).toBeVisible();
    await expect(page.locator(".set-list-item").first()).toContainText("First Anthem");

    // In screen media: drag handle is visible
    await page.emulateMedia({ media: "screen" });
    const screenDragDisplay = await page
      .locator(".set-list-drag-handle")
      .first()
      .evaluate((element) => getComputedStyle(element).display);
    expect(screenDragDisplay).not.toBe("none");

    // In print media: drag handle and screen chrome are hidden
    await page.emulateMedia({ media: "print" });
    const printDragDisplay = await page
      .locator(".set-list-drag-handle")
      .first()
      .evaluate((element) => getComputedStyle(element).display);
    expect(printDragDisplay).toBe("none");

    const printHeaderDisplay = await page
      .locator(".signed-in-header")
      .evaluate((element) => getComputedStyle(element).display);
    expect(printHeaderDisplay).toBe("none");

    // In print media: set-list-item avoids break inside
    const itemStyles = await page
      .locator(".set-list-item")
      .first()
      .evaluate((element) => {
        const styles = getComputedStyle(element);
        return {
          breakInside: styles.breakInside,
        };
      });
    expect(itemStyles.breakInside).toBe("avoid");

    // Test the Printable Set List modal preview
    await page.emulateMedia({ media: "screen" });
    const printViewButton = page.getByRole("button", { name: "Print set list" });
    if (await printViewButton.isVisible()) {
      await printViewButton.click();
      const printModal = page.getByRole("dialog", { name: "Printable Set List" });
      await expect(printModal).toBeVisible();

      await page.emulateMedia({ media: "print" });
      const printViewStyles = await printModal
        .locator(".set-list-print-view")
        .evaluate((element) => {
          const styles = getComputedStyle(element);
          return {
            backgroundColor: styles.backgroundColor,
            display: styles.display,
          };
        });
      expect(printViewStyles.display).toBe("block");
      expect(printViewStyles.backgroundColor).toBe("rgb(255, 255, 255)");
    }
  });
});
