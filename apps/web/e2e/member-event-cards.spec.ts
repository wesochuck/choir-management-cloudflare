import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { SingerEvent } from "@choir/contracts";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { fulfillJson } from "./fixtures/session";
import { buildSingerDashboardResponse } from "./fixtures/builders";

const event: SingerEvent = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "2026 Holiday Parade",
  type: "Performance",
  startsAt: "2026-11-21T15:00:00.000Z",
  callTime: "09:30",
  durationMinutes: 120,
  location: "",
  venueName: "Fairfield County Fairgrounds",
  venueAddress: "157 E Fair Ave, Lancaster, Ohio 43130",
  details: "",
  directRsvp: "Yes",
  resolvedRsvp: "Yes",
  inheritedFromParent: false,
  rsvpSelfServiceOpen: true,
  rsvpDeadlineAt: "2026-11-02T04:59:59.000Z",
  rsvpDeadlineDate: "2026-11-01",
  rsvpDeadlinePassed: false,
  rsvpNote: "",
  seating: { status: "not_assigned" },
  setList: [],
  practice: {
    sourceEventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "available",
    trackCount: 3,
  },
  attendanceWarning: null,
  featuredAssignments: [],
};

async function installCalendarFeed(page: Page) {
  await page.route("**/api/singer/calendar-feed-url**", async (route) => {
    await fulfillJson(route, {
      expiresAt: "2027-10-21T12:00:00.000Z",
      httpsUrl: "https://calendar.example.test/feed.ics?token=calendar-fixture",
      webcalUrl: "webcal://calendar.example.test/feed.ics?token=calendar-fixture",
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
  });
}

for (const path of ["/schedule", "/dashboard"]) {
  test(`${path} shows compact event details and practice without disclosure in both themes`, async ({
    page,
  }) => {
    const api = await installOrganizationApi(page, { role: "member", strict: true });
    api.singerEvents.set([event]);
    await installCalendarFeed(page);
    api.setSingerDashboard(
      buildSingerDashboardResponse({ events: [event], timezone: "America/New_York" }),
    );
    for (const width of [1519, 900, 390]) {
      await page.setViewportSize({ width, height: 1036 });
      await page.goto(path);
      const card = page.locator(".member-event-card").first();
      await expect(card).toBeVisible();
      await expect(card.getByText("Arrive 9:30 AM")).toBeVisible();
      await expect(card.getByText("Starts 10:00 AM EST")).toBeVisible();
      await expect(card.getByText("2 hours")).toBeVisible();
      await expect(card.getByRole("link", { name: "Seat not assigned" })).toBeVisible();
      await expect(card.getByRole("button", { name: "Open practice player" })).toBeVisible();
      await expect(card.locator('[data-feature-icon="headphones"]')).toHaveCount(1);
      await expect(card.getByText("Event details", { exact: true })).toHaveCount(0);
      for (const theme of ["light", "dark"]) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
          document.querySelector(".signed-in-shell")?.setAttribute("data-theme", value);
        }, theme);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.evaluate(async () => {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                resolve();
              }),
            ),
          );
          for (const animation of document.getAnimations()) {
            if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish();
          }
        });
        const audit = await new AxeBuilder({ page })
          .include(path === "/schedule" ? ".account-section--my-schedule" : ".member-event-card")
          .analyze();
        expect(
          audit.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
        ).toEqual([]);
        if (path === "/schedule") {
          await page.locator(".calendar-subscription-card").screenshot({
            path: `/tmp/calendar-panel-${String(width)}-${theme}.png`,
            animations: "disabled",
          });
        }
        await page.screenshot({
          path: `/tmp/member-events-${path.slice(1)}-${String(width)}-${theme}.png`,
          fullPage: true,
          animations: "disabled",
        });
      }
      if (path === "/dashboard" && width === 1519) {
        const events = await page.locator(".member-dashboard__events").boundingBox();
        const updates = await page
          .getByRole("complementary", { name: "Member updates" })
          .boundingBox();
        if (!events || !updates) throw new Error("Dashboard columns must be visible");
        expect(updates.x).toBeGreaterThan(events.x + events.width - 1);
      }
    }
    api.assertNoUnexpectedRequests();
  });
}

test("calendar options work by keyboard and keep reset behind confirmation", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "member", strict: true });
  api.singerEvents.set([event]);
  await installCalendarFeed(page);
  await page.goto("/schedule");
  const calendar = page.getByRole("region", { name: "Add to your calendar" });
  await expect(calendar.getByRole("link", { name: "Google Calendar" })).toBeVisible();
  await expect(calendar.getByRole("link", { name: "Apple Calendar / Other app" })).toHaveAttribute(
    "href",
    /^webcal:/,
  );
  await expect(calendar.getByLabel("Calendar subscription link")).toBeHidden();
  const options = calendar.locator("summary");
  await options.focus();
  await page.keyboard.press("Enter");
  await expect(calendar.getByLabel("Calendar subscription link")).toBeVisible();
  await expect(
    calendar.getByText("Anyone with this link can view your calendar. Do not share it."),
  ).toBeVisible();
  await calendar.getByRole("button", { name: "Copy link" }).click();
  await expect(calendar.getByRole("button", { name: "✓ Copied!" })).toBeVisible();
  await calendar.getByRole("button", { name: "Reset calendar address" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset calendar address?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("all your devices");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await calendar.screenshot({ path: "/tmp/calendar-other-options.png", animations: "disabled" });
  await options.focus();
  await page.keyboard.press("Enter");
  await expect(calendar.getByLabel("Calendar subscription link")).toBeHidden();
  api.assertNoUnexpectedRequests();
});
