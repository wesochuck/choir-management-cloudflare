import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { futureIsoDate } from "@choir/testkit";

import { installOrganizationApi } from "./fixtures/apiMocks";
import { buildSingerDashboardResponse } from "./fixtures/builders";
import { fulfillJson } from "./fixtures/session";

// Automated accessibility smoke scans (plan §4.14). These specs run axe with
// the WCAG 2 A/AA tags against representative mocked pages and states on both
// the desktop Chromium and Pixel 7 projects. Serious and critical impacts fail
// the run; minor/moderate findings are triaged in the fixture README baseline.
// Automated scans do not replace manual review: keyboard-only walkthroughs and
// screen-reader checks remain manual (see fixtures README).

const PLAYER_REQUEST_ID = "12121212-1212-4121-8121-121212121212";

// Tolerated color-contrast baseline, measured 2026-09-07 on the light theme in
// Chromium. Each entry is matched as a substring against the axe node's target
// plus HTML. The accent/secondary palette sits below the WCAG AA 4.5:1 minimum
// in these spots:
//
// - sign-in method switchers (`.text-button`): #ea580c on #ffffff (3.55)
// - command-palette hint (`quick-search-kbd`): #94a3b8 on #334155 (4.03)
// - player track badge / guide toggle: #ea580c on #ffffff (3.55)
// - player "Now Playing" pill: #f8f9fa on #ea580c (3.37)
// - player set-list track label: #ea580c on #fce8dd (3.0)
// - player offline error notice (`.notice`): #dc2626 on #fef2f2 (4.41)
// - player set-list subtitle: #64748b on #fce8dd (4.01)
// - rehearsal-panel secondary copy: #64748b on #fbe1d3 / #fdf0e9 (3.8-4.26)
//
// Remediation needs a design-token pass across both themes (see fixtures README
// follow-ups), so product CSS is intentionally untouched here. The gate fails
// on every other serious/critical violation and on any contrast node matching
// none of these entries, so new debt cannot hide behind the baseline.
const TOLERATED_CONTRAST_TARGETS: readonly string[] = [
  ".text-button",
  "quick-search-kbd",
  "public-player__track-badge",
  "public-player__now-playing-pill",
  "public-player__item-track",
  "public-player__set-list-item-main",
  "public-player__guide-toggle",
  ".notice",
  "Start track at",
  "Skips the beginning of this track every time you play it.",
  ">seconds</small>",
  ">Volume</span>",
  ">100%</small>",
  "Gap between tracks",
  "Adds silence before the next track starts.",
  "Choose whether to stop, repeat the set list, or repeat one track.",
];

function isToleratedContrast(violationId: string, target: string, html: string): boolean {
  if (violationId !== "color-contrast") return false;
  const haystack = `${target} ${html}`;
  return TOLERATED_CONTRAST_TARGETS.some((entry) => haystack.includes(entry));
}

async function expectNoSeriousAxeViolations(
  page: Page,
  context: string,
  includeSelector?: string,
): Promise<void> {
  const axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
  if (includeSelector) axe.include(includeSelector);
  const results = await axe.analyze();
  const blocking = results.violations.flatMap((violation) =>
    violation.nodes
      .filter(
        (node) =>
          (violation.impact === "serious" || violation.impact === "critical") &&
          !isToleratedContrast(violation.id, node.target.join(" "), node.html),
      )
      .map(
        (node) =>
          `${violation.id} (${violation.impact ?? "unknown"}): ` +
          `${node.target.join(" ")} — ${violation.helpUrl}`,
      ),
  );
  expect(blocking, `${context} must have no serious/critical axe violations`).toEqual([]);
}

test("sign-in page has no serious accessibility violations", async ({ page }) => {
  const api = await installOrganizationApi(page, {
    initiallySignedIn: false,
    role: "member",
    strict: true,
  });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to Choir Management." })).toBeVisible();

  await expectNoSeriousAxeViolations(page, "sign-in");
  api.assertNoUnexpectedRequests();
});

test("member dashboard has no serious accessibility violations", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "member", strict: true });
  api.setSingerDashboard(
    buildSingerDashboardResponse({ organizationName: "Lancaster Men's Chorus" }),
  );

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();

  await expectNoSeriousAxeViolations(page, "member dashboard");
  api.assertNoUnexpectedRequests();
});

test("administrator roster table has no serious accessibility violations", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });

  await page.goto("/admin/roster");
  await expect(page.getByRole("button", { name: "Add Profile" })).toBeVisible();

  await expectNoSeriousAxeViolations(page, "roster table");
  api.assertNoUnexpectedRequests();
});

test("record-donation modal has no serious accessibility violations @webkit-smoke", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  // Spec-specific route shadowing the strict guard (see fixtures README): the
  // donations workspace loads ticket-buyer suggestions for the donor field.
  await page.route("**/api/organization/tickets/orders", async (route) => {
    await fulfillJson(route, { orders: [], requestId: "99999999-9999-4999-8999-999999999999" });
  });

  await page.goto("/admin/donations");
  await page.getByRole("button", { name: "Record donation" }).click();
  const dialog = page.getByRole("dialog", { name: "Record donation" });
  await expect(dialog).toBeVisible();

  await expectNoSeriousAxeViolations(page, "record-donation modal");
  api.assertNoUnexpectedRequests();
});

test("open mobile navigation has no serious accessibility violations @webkit-smoke", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });

  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/admin/roster");
  await page.getByRole("button", { name: "Open workspace navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(drawer).toBeVisible();

  await expectNoSeriousAxeViolations(page, "mobile navigation open");
  api.assertNoUnexpectedRequests();
});

test("practice player has no serious accessibility violations @webkit-smoke", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: PLAYER_REQUEST_ID,
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
  await page.route("**/api/public/player/media/**", async (route) => {
    await route.fulfill({
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      ),
      contentType: "image/png",
      status: 200,
    });
  });
  await page.route("**/api/public/player-details", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        eventArtworkFileId: "file-art-1",
        eventId: "event-123",
        eventStartsAt: futureIsoDate({ days: 60 }),
        eventTitle: "Summer Showcase",
        items: [
          {
            arranger: "Arranger Name",
            composer: "Composer Name",
            durationSeconds: 180,
            pieceId: "piece-1",
            title: "Hallelujah Chorus",
            trackFileIds: { alto: "file-alto-1", tutti: "file-tutti-1" },
          },
        ],
        profileName: "Jane Doe",
        requestId: PLAYER_REQUEST_ID,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/player?token=valid-player-token");
  await expect(page.getByRole("heading", { name: "Summer Showcase" })).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "light");
  });
  await expectNoSeriousAxeViolations(page, "practice player");

  await page.getByRole("button", { name: /Set list/i }).click();
  const setListPicker = page.getByRole("dialog", { name: "Set List" });
  await expect(setListPicker).toBeVisible();
  const pickerDownload = setListPicker.locator(".public-player__download-btn");
  await expect(pickerDownload).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expectNoSeriousAxeViolations(
    page,
    "light mobile practice player Set List picker",
    ".sheet[role='dialog']",
  );
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  });
  await expect(pickerDownload).toHaveCSS("background-color", "rgb(30, 41, 59)");
  await expect(pickerDownload).toHaveCSS("color", "rgb(248, 250, 252)");
  await expectNoSeriousAxeViolations(
    page,
    "dark mobile practice player Set List picker",
    ".sheet[role='dialog']",
  );
});
