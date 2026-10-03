import { defaultRosterConfiguration } from "@choir/domain";
import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { fixtureIds } from "./fixtures/builders";

const template = {
  format: "choir-seating-template",
  version: 1,
  charts: [
    {
      name: "America 250 reference",
      rowCounts: [2, 3],
      formation: {
        id: "columns-standard",
        name: "S–B–T–A reference",
        isVoicePartLayout: false,
        sectionOrder: ["S", "B", "T", "A"],
        strategy: "vertical_column",
      },
      assignments: [{ seatKey: "1-2", name: " browser   SINGER " }],
    },
  ],
};

for (const theme of ["light", "dark"] as const) {
  test(`imports a seating template with name matches in ${theme} theme`, async ({
    page,
  }, testInfo) => {
    const api = await installOrganizationApi(page, { role: "administrator", strict: true });
    await page.route("**/api/organization/roster-configuration", async (route) => {
      await route.fulfill({
        json: { ...defaultRosterConfiguration, requestId: "22222222-2222-4222-8222-222222222222" },
      });
    });
    await page.goto("/admin/seating");
    const themeButton = page.getByRole("button", { name: `Switch to ${theme} theme` });
    if (await themeButton.isVisible()) await themeButton.click();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Import seating chart" });
    await dialog.getByLabel("Seating template (JSON)").setInputFiles({
      name: "seating.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(template)),
    });
    await expect(dialog.getByRole("status")).toHaveText(
      "2 rows · 5 seats · 1 matched assignments · 0 need review",
    );
    await dialog
      .getByRole("combobox", { name: "Formation", exact: true })
      .selectOption("__template__");
    await dialog.getByText("Review singer matches", { exact: true }).click();
    await expect(dialog.getByText(/browser\s+SINGER.*Matched/u)).toBeVisible();
    const overflow = await dialog.evaluate(
      (element) => element.scrollWidth > element.clientWidth + 1,
    );
    expect(overflow).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath(`seating-import-${theme}.png`),
      fullPage: true,
    });
    const creation = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().includes("/seating-charts"),
    );
    await dialog.getByRole("button", { name: "Import as new chart" }).click();
    expect((await creation).postDataJSON()).toEqual(
      expect.objectContaining({
        rowCounts: [2, 3],
        assignments: { "1-2": fixtureIds.browserProfileId },
        formationId: "import-columns-standard",
      }),
    );
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel("Select seating chart")).toContainText(
      "America 250 reference (imported)",
    );
    await expect(
      page.locator(".seating-seat--assigned").filter({ hasText: "Browser Singer" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Source Performance" })).toContainText(
      "Browser Concert (current Performance)",
    );
    api.assertNoUnexpectedRequests();
  });
}
