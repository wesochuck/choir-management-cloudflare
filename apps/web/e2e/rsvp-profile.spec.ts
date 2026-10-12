import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installOrganizationApi } from "./fixtures/apiMocks";

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
