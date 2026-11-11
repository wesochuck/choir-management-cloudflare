import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { buildOrganizationEvent, fixtureIds } from "./fixtures/builders";

const requestId = "99999999-9999-4999-8999-999999999999";

test("RSVP roster opens profile editor and returns to the same list (issue #137)", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.route("**/api/organization/members", async (route) => {
    await route.fulfill({
      json: { memberships: [], requestId, truncated: false },
    });
  });

  let savedPayload: unknown = null;
  await page.route("**/api/organization/profiles/*", async (route) => {
    if (route.request().method() === "PUT") {
      savedPayload = JSON.parse(route.request().postData() ?? "{}") as unknown;
    }
    await route.fallback();
  });

  await page.goto("/admin/rsvp");

  const opener = page.getByRole("button", { name: "Open profile for Browser Singer" }).first();
  await expect(opener).toBeVisible();

  // Preserve RSVP search state across the modal round-trip.
  const search = page.getByPlaceholder("Name or part");
  await search.fill("Browser");
  await opener.click();

  const dialog = page.getByRole("dialog", { name: "Edit Profile" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Display name")).toHaveValue("Browser Singer");
  await expect(dialog.getByRole("button", { name: "Save & Return to RSVPs" })).toBeVisible();

  const axe = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const blocking = axe.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(blocking).toEqual([]);

  await dialog.getByLabel("Display name").fill("Browser Singer Edited");
  await dialog.getByRole("button", { name: "Save & Return to RSVPs" }).click();
  await expect(dialog).not.toBeVisible();
  expect(savedPayload).toMatchObject({ displayName: "Browser Singer Edited" });

  // Same RSVP list: search preserved and focus returns to the opener.
  await expect(search).toHaveValue("Browser");
  await expect(opener).toBeFocused();
  api.assertNoUnexpectedRequests();
});

test("RSVP profile cancel returns without saving (issue #137)", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.route("**/api/organization/members", async (route) => {
    await route.fulfill({
      json: { memberships: [], requestId, truncated: false },
    });
  });
  let putCount = 0;
  await page.route("**/api/organization/profiles/*", async (route) => {
    if (route.request().method() === "PUT") putCount += 1;
    await route.fallback();
  });

  await page.goto("/admin/rsvp");
  const opener = page.getByRole("button", { name: "Open profile for Browser Singer" }).first();
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Edit Profile" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).not.toBeVisible();
  expect(putCount).toBe(0);
  await expect(opener).toBeFocused();
  api.assertNoUnexpectedRequests();
});

test("Event RSVPs opens Event Editor modal to RSVP section and returns cleanly", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  const eventId = fixtureIds.concertEventId;
  const initialEvent = buildOrganizationEvent({
    id: eventId,
    rsvpDeadlineDate: "2027-08-13",
    rsvpDeadlinePassed: false,
  });
  api.events.set([initialEvent]);

  await page.route(`**/api/organization/events/${eventId}`, async (route) => {
    if (route.request().method() === "PUT") {
      const updated = {
        ...initialEvent,
        rsvpDeadlineDate: "2027-08-18",
      };
      api.events.set([updated]);
      await route.fulfill({
        json: updated,
        status: 200,
      });
      return;
    }
    await route.fallback();
  });

  await page.goto("/admin/rsvp");

  const performanceSelect = page
    .locator(".rsvp-manager__balance")
    .getByRole("combobox", { name: "Performance" });
  await expect(performanceSelect).toHaveValue(eventId);

  const editRsvpLink = page.getByRole("link", { name: "Edit RSVP settings →" });
  await expect(editRsvpLink).toBeVisible();
  await expect(editRsvpLink).toHaveAttribute(
    "href",
    `/admin/events?eventId=${eventId}&section=rsvp&returnTo=%2Fadmin%2Frsvp%3FeventId%3D${eventId}`,
  );

  // Verify desktop alignment (side-by-side with same midline) or mobile layout (stacked, full width, no overflow)
  const [selectBox, linkBox] = await Promise.all([
    performanceSelect.boundingBox(),
    editRsvpLink.boundingBox(),
  ]);
  expect(selectBox).not.toBeNull();
  expect(linkBox).not.toBeNull();
  const viewportWidth = page.viewportSize()?.width ?? 1280;
  if (selectBox && linkBox) {
    expect(Math.abs(selectBox.height - linkBox.height)).toBeLessThanOrEqual(2);
    if (viewportWidth > 640) {
      expect(linkBox.x).toBeGreaterThanOrEqual(selectBox.x + selectBox.width - 1);
      const selectMid = selectBox.y + selectBox.height / 2;
      const linkMid = linkBox.y + linkBox.height / 2;
      expect(Math.abs(selectMid - linkMid)).toBeLessThanOrEqual(2);
    } else {
      expect(linkBox.y).toBeGreaterThanOrEqual(selectBox.y + selectBox.height);
    }
  }
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasOverflow).toBe(false);

  const pageAxe = await new AxeBuilder({ page })
    .include(".rsvp-manager__performance-row")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const pageBlocking = pageAxe.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(pageBlocking).toEqual([]);

  // 1. Click link -> opens Event Editor modal to RSVPs & reminders with deadline focused
  await editRsvpLink.click();
  await expect(page).toHaveURL(
    `/admin/events?eventId=${eventId}&section=rsvp&returnTo=%2Fadmin%2Frsvp%3FeventId%3D${eventId}`,
  );

  const eventEditor = page.getByRole("dialog", { name: "Edit event" });
  await expect(eventEditor).toBeVisible();
  await expect(eventEditor.getByRole("heading", { name: "RSVPs & reminders" })).toBeVisible();
  await expect(eventEditor.locator("#events-page-rsvp-deadline")).toBeFocused();

  const axe = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .exclude(".status-pill--neutral")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const blocking = axe.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(blocking).toEqual([]);

  // 2. Clean return via 'Back to RSVPs'
  const backToRsvpsButton = eventEditor.getByRole("button", { name: "Back to RSVPs" });
  await expect(backToRsvpsButton).toBeVisible();
  await backToRsvpsButton.click();
  await expect(eventEditor).not.toBeVisible();
  await expect(page).toHaveURL(`/admin/rsvp?eventId=${eventId}`);
  await expect(performanceSelect).toHaveValue(eventId);

  // 3. Open again, edit deadline, save, and verify updated deadline appears on /admin/rsvp
  await editRsvpLink.click();
  const reopenedEditor = page.getByRole("dialog", { name: "Edit event" });
  await expect(reopenedEditor).toBeVisible();
  await reopenedEditor.locator("#events-page-rsvp-deadline").fill("2027-08-18");
  await reopenedEditor.getByRole("button", { name: "Save event" }).click();

  await expect(reopenedEditor).not.toBeVisible();
  await expect(page).toHaveURL(`/admin/rsvp?eventId=${eventId}`);
  await expect(page.getByText(/2027-08-18/)).toBeVisible();
  api.assertNoUnexpectedRequests();
});
