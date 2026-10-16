import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { selectEventEditorSection } from "./support/eventEditor";

for (const theme of ["light", "dark"] as const) {
  test(`event section draft markers remain distinct from selection in ${theme} theme`, async ({
    page,
  }, testInfo) => {
    const api = await installOrganizationApi(page, { role: "administrator", strict: true });
    await page.addInitScript((value) => {
      window.localStorage.setItem(`choir-theme:${window.location.hostname}`, value);
    }, theme);
    await page.goto("/admin/events");
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Edit event", exact: true });
    const title = dialog.getByRole("textbox", { name: /Title/ });
    const original = await title.inputValue();
    await title.fill(`${original} edited`);
    await selectEventEditorSection(dialog, "schedule");
    if (testInfo.project.name.includes("mobile")) {
      await expect(
        dialog.locator('#event-editor-section-select option[value="basics"]'),
      ).toContainText("Unsaved changes");
      await expect(
        dialog.locator('#event-editor-section-select option[value="schedule"]'),
      ).not.toContainText("Unsaved changes");
    } else {
      await expect(dialog.getByRole("tab", { name: /Basics/ })).toHaveAccessibleDescription(
        "Unsaved",
      );
      await expect(dialog.getByRole("tab", { name: /Schedule & venue/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(dialog.getByRole("tab", { name: /Schedule & venue/ })).not.toHaveAttribute(
        "aria-describedby",
      );
    }
    await page.screenshot({ path: testInfo.outputPath(`event-unsaved-sections-${theme}.png`) });
    await selectEventEditorSection(dialog, "basics");
    await title.fill(original);
    await expect(dialog.getByText("Unsaved", { exact: true })).toHaveCount(0);
    await selectEventEditorSection(dialog, "public");
    await dialog.locator("#events-page-graphic").setInputFiles({
      name: "poster.png",
      mimeType: "image/png",
      buffer: Buffer.from("graphic fixture"),
    });
    await expect(
      dialog.locator('#event-editor-section-select option[value="public"]'),
    ).toContainText("Unsaved changes");
    await dialog.getByRole("button", { name: "Remove selected image", exact: true }).click();
    await expect(
      dialog.locator('#event-editor-section-select option[value="public"]'),
    ).not.toContainText("Unsaved changes");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    api.assertNoUnexpectedRequests();
  });
}
