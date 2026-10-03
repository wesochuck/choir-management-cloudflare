import { defaultRosterConfiguration } from "@choir/domain";
import { seatingConfigurationRequestSchema } from "@choir/contracts";
import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { buildSeatingChart, fixtureIds } from "./fixtures/builders";

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
    await dialog.getByLabel("Import as").selectOption("chart");
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
  test(`saves and reuses full seating templates in ${theme} theme`, async ({ page }, testInfo) => {
    const api = await installOrganizationApi(page, { role: "administrator", strict: true });
    await page.route("**/api/organization/roster-configuration", async (route) => {
      await route.fulfill({
        json: { ...defaultRosterConfiguration, requestId: "22222222-2222-4222-8222-222222222222" },
      });
    });
    const attendance = new Map(api.attendanceRows.get());
    const singer = attendance.get(fixtureIds.browserProfileId);
    if (!singer) throw new Error("Expected browser singer attendance.");
    attendance.set(singer.profileId, { ...singer, rsvp: "Pending" });
    api.attendanceRows.set(attendance);
    await page.goto("/admin/seating");
    const themeButton = page.getByRole("button", { name: `Switch to ${theme} theme` });
    if (await themeButton.isVisible()) await themeButton.click();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Import seating chart" });
    await dialog.getByLabel("Seating template (JSON)").setInputFiles({
      name: "seating.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          ...template,
          charts: [
            {
              ...template.charts[0],
              assignments: [
                { seatKey: "1-2", name: "Browser Singer" },
                { seatKey: "0-0", name: "Future Singer" },
              ],
            },
          ],
        }),
      ),
    });
    await expect(dialog.getByLabel("Import as")).toHaveValue("template");
    await expect(dialog.getByRole("button", { name: "Save reusable template" })).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath(`seating-template-${theme}.png`),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Save reusable template" }).click();
    await expect(dialog).toHaveCount(0);
    expect(
      seatingConfigurationRequestSchema.parse(api.seatingConfiguration.get()).templates?.[0]
        ?.assignments,
    ).toEqual([
      { name: "Browser Singer", seatKey: "1-2", profileId: fixtureIds.browserProfileId },
      { name: "Future Singer", seatKey: "0-0" },
    ]);
    attendance.set(singer.profileId, { ...singer, rsvp: "Yes" });
    api.attendanceRows.set(attendance);
    api.seatingCharts.set([buildSeatingChart()]);
    await page.reload();
    await page.getByText("Saved templates (1)", { exact: true }).click();
    await page
      .getByRole("button", { name: "Use America 250 reference (imported)", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Copy seating chart", exact: true })
      .getByRole("button", { name: "Copy chart", exact: true })
      .click();
    const confirm = page.getByRole("dialog", { name: "Copy seating chart?", exact: true });
    await expect(confirm).toContainText("1 unresolved or ineligible");
    await confirm.getByRole("button", { name: "Copy chart", exact: true }).click();
    await expect(page.locator('[data-seat-key="1-2"].seating-seat--assigned')).toHaveAttribute(
      "aria-label",
      /Browser Singer/,
    );
    await expect(
      page.locator('[data-seat-key="1-2"].seating-seat--assigned .seating-seat__suggestion'),
    ).toHaveCount(0);
    await expect(page.locator(".seating-seat--empty .seating-seat__suggestion").first()).toHaveText(
      "Open",
    );
    expect(
      seatingConfigurationRequestSchema.parse(api.seatingConfiguration.get()).templates?.[0]
        ?.assignments,
    ).toHaveLength(2);
    await page
      .getByRole("button", { name: "Delete America 250 reference (imported)", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Delete seating template?" })
      .getByRole("button", { name: "Delete template", exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "Delete seating template?" })).toHaveCount(0);
    expect(
      seatingConfigurationRequestSchema.parse(api.seatingConfiguration.get()).templates,
    ).toEqual([]);
    await expect(page.locator('[data-seat-key="1-2"].seating-seat--assigned')).toBeVisible();
    api.assertNoUnexpectedRequests();
  });
}
