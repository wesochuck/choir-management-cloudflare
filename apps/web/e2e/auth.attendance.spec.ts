import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";

test("keeps the attendance heading close to its manager", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });

  await page.goto("/admin/attendance");
  const attendancePage = page.getByRole("main");
  await expect(attendancePage.getByRole("heading", { name: "Attendance" })).toBeVisible();
  const [headingBox, managerBox] = await Promise.all([
    attendancePage.locator(".page-heading").boundingBox(),
    attendancePage.locator(".attendance-manager").boundingBox(),
  ]);
  expect(headingBox).not.toBeNull();
  expect(managerBox).not.toBeNull();
  if (headingBox && managerBox) {
    expect(managerBox.y - (headingBox.y + headingBox.height)).toBeLessThanOrEqual(16);
  }
  api.assertNoUnexpectedRequests();
});
