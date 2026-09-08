import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";

test("labels the Organization MFA policy fieldset with a legend", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "owner", strict: true });

  await page.goto("/admin/settings/security");
  const organizationSection = page.getByRole("region", { name: "Organization security" });
  const policy = organizationSection.getByRole("group", { name: "Organization MFA policy" });
  await expect(policy).toBeVisible();
  await expect(policy.locator("legend")).toHaveText("Organization MFA policy");
  await expect(policy.locator("h3")).toHaveCount(0);
  api.assertNoUnexpectedRequests();
});
