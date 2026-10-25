import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";

for (const theme of ["light", "dark"] as const) {
  test(`keeps Add venue beside its heading and opens the venue dialog in ${theme}`, async ({
    page,
  }, testInfo) => {
    await installOrganizationApi(page, { role: "administrator", strict: true });
    await page.addInitScript((value) => {
      localStorage.setItem(`choir-theme:${location.hostname}`, value);
    }, theme);
    await page.goto("/admin/venues");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("heading", { name: "Venues", exact: true })).toHaveCount(1);
    const heading = page.locator(".page-heading--actions");
    const add = heading.getByRole("button", { name: "Add venue", exact: true });
    await expect(add).toBeVisible();
    const text = await heading.locator(":scope > div").boundingBox();
    const action = await add.boundingBox();
    if (!text || !action) throw new Error("Venue heading is missing");
    expect(action.x).toBeGreaterThanOrEqual(text.x + text.width);
    expect(action.y + action.height / 2).toBeGreaterThanOrEqual(text.y);
    expect(action.y + action.height / 2).toBeLessThanOrEqual(text.y + text.height);
    await heading.screenshot({ path: testInfo.outputPath("venue-heading.png") });
    await add.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add venue", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}
