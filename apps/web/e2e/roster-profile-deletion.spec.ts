import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { buildOrganizationProfile } from "./fixtures/builders";

for (const contacts of ["keep", "delete_unused"] as const) {
  test(`roster deletion contact choice ${contacts} is accessible in both themes`, async ({
    page,
  }, testInfo) => {
    const api = await installOrganizationApi(page, { role: "administrator", strict: true });
    const profile = buildOrganizationProfile({
      displayName: "Imported Person",
      email: "person@example.test",
    });
    api.profiles.set([profile]);
    await page.route("**/api/organization/members", async (route) => {
      await route.fulfill({
        json: {
          memberships: [],
          truncated: false,
          requestId: "99999999-9999-4999-8999-999999999999",
        },
      });
    });
    let requestedChoice: string | null = null;
    await page.route(`**/api/organization/profiles/${profile.id}?*`, async (route) => {
      expect(route.request().method()).toBe("DELETE");
      requestedChoice = new URL(route.request().url()).searchParams.get("contacts");
      await route.fulfill({
        json: {
          deleted: true,
          profileId: profile.id,
          requestId: "99999999-9999-4999-8999-999999999999",
        },
      });
    });
    await page.goto("/admin/roster");
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((nextTheme) => {
        window.localStorage.setItem(`choir-theme:${window.location.hostname}`, nextTheme);
      }, theme);
      await page.reload();
      await expect(page.locator(".signed-in-shell")).toHaveAttribute("data-theme", theme);
      await page.getByRole("button", { name: "Delete Imported Person", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Permanently delete Imported Person?" });
      await expect(dialog.getByRole("radio", { name: "Keep Contacts", exact: true })).toBeChecked();
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Delete permanently", exact: true }),
      ).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      const viewport = page.viewportSize();
      if (!box || !viewport) throw new Error("Dialog or viewport missing");
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      const result = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        result.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
      ).toEqual([]);
      await dialog.screenshot({ path: testInfo.outputPath(`delete-profile-${theme}.png`) });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    }
    await page.getByRole("button", { name: "Delete Imported Person", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Permanently delete Imported Person?" });
    const keep = dialog.getByRole("radio", { name: "Keep Contacts", exact: true });
    await keep.focus();
    if (contacts === "delete_unused") await page.keyboard.press("ArrowDown");
    await expect(
      dialog.getByRole("radio", {
        name: contacts === "keep" ? "Keep Contacts" : "Delete unused roster-email Contacts",
        exact: true,
      }),
    ).toBeChecked();
    await dialog.getByRole("button", { name: "Delete permanently", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Imported Person has been permanently deleted.",
    );
    expect(requestedChoice).toBe(contacts);
    api.assertNoUnexpectedRequests();
  });
}
