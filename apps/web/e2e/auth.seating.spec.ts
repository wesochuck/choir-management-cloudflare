import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";

test("renders the focused seating canvas with structural controls", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });

  await page.goto("/admin/seating");
  await expect(page.getByRole("heading", { name: "Performance seating" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start a seating chart" })).toBeVisible();
  await page.getByRole("button", { name: "Create chart" }).click();
  await page.getByLabel("Chart name").fill("Full Canvas Chart");
  await expect(page.getByLabel("Singers to place")).toHaveValue("1");
  await expect(page.getByLabel("Rows")).toHaveValue("1");
  await expect(
    page.getByText("1 singer across 1 row — 1 singer per row.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Singers to place").fill("30");
  await page.getByLabel("Rows").fill("3");
  await expect(
    page.getByText("30 singers across 3 rows — 10 singers per row.", { exact: true }),
  ).toBeVisible();
  const createChartRequestPromise = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/seating-charts"),
  );
  await page.getByRole("button", { name: "Create chart", exact: true }).click();
  const createChartRequest = await createChartRequestPromise;
  expect(createChartRequest.postDataJSON()).toEqual(
    expect.objectContaining({ rowCounts: [10, 10, 10] }),
  );
  const chartSelect = page.getByLabel("Select seating chart");
  await expect(chartSelect).toContainText("Full Canvas Chart");
  if ((page.viewportSize()?.width ?? 0) > 700) {
    await page.setViewportSize({ height: 871, width: 971 });
    const toolbarOverflow = await page
      .locator(".seating-toolbar--secondary")
      .evaluate((toolbar) => {
        const toolbarRight = toolbar.getBoundingClientRect().right;
        return [...toolbar.querySelectorAll("*")]
          .filter((element) => element.getBoundingClientRect().right > toolbarRight + 1)
          .map((element) => element.className);
      });
    expect(toolbarOverflow).toEqual([]);
  }
  const darkThemeButton = page.getByRole("button", { name: "Switch to dark theme" });
  if (await darkThemeButton.isVisible()) {
    await darkThemeButton.click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const optionColors = await chartSelect
    .locator("option")
    .first()
    .evaluate((option) => {
      const styles = getComputedStyle(option);
      return { backgroundColor: styles.backgroundColor, color: styles.color };
    });
  const themeColors = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--color-surface)";
    probe.style.color = "var(--color-text)";
    document.body.append(probe);
    const styles = getComputedStyle(probe);
    const colors = { backgroundColor: styles.backgroundColor, color: styles.color };
    probe.remove();
    return colors;
  });
  expect(optionColors).toEqual(themeColors);
  if ((page.viewportSize()?.width ?? 1000) <= 700) {
    await page.getByRole("button", { name: "Edit anyway" }).click();
    const openNavigation = page.getByRole("button", { name: "Open workspace navigation" });
    await openNavigation.click();
    const navigationDialog = page.getByRole("dialog", { name: "Workspace navigation" });
    await expect(navigationDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(navigationDialog).toHaveCount(0);
    await expect(openNavigation).toBeFocused();
  }
  const firstSeat = page.locator(".seating-seat--empty").first();
  await expect(firstSeat).toBeVisible();
  if ((page.viewportSize()?.width ?? 1000) > 700) {
    await firstSeat.click({ force: true });
    const seatDialog = page.getByRole("dialog").filter({ hasText: "This seat is empty." });
    await expect(seatDialog).toBeVisible();
    await seatDialog.getByRole("button", { name: /Browser Singer/ }).click();
    await expect(
      page.locator(".seating-seat--assigned").filter({ hasText: "Browser Singer" }).first(),
    ).toBeVisible();

    const assignedSeat = page
      .locator(".seating-seat--assigned")
      .filter({ hasText: "Browser Singer" })
      .first();
    await expect(assignedSeat).toHaveAttribute("title", "Browser Singer");
    await expect(assignedSeat.getByText("Browser Singer", { exact: true })).toBeHidden();
    await expect(assignedSeat.getByText("BS", { exact: true })).toBeVisible();
    await assignedSeat.getByRole("button", { name: "Remove Browser Singer from Seat 1" }).click();
    const clearSeatDialog = page.getByRole("dialog", { name: "Clear seat assignment?" });
    await expect(clearSeatDialog).toContainText("return them to Unassigned Profiles");
    await clearSeatDialog.getByRole("button", { name: "Clear assignment" }).click();
    await expect(
      page.locator(".seating-seat--assigned").filter({ hasText: "Browser Singer" }),
    ).toHaveCount(0);
    const firstRow = page.locator(".seating-row--canvas").filter({ hasText: "Row 1" }).first();
    await expect(firstRow.locator(".seating-seat--canvas")).toHaveCount(10);

    await firstRow.getByRole("button", { name: "Delete empty Seat 1", exact: true }).click();
    const deleteSeatDialog = page.getByRole("dialog", { name: "Delete empty seat?" });
    await expect(deleteSeatDialog).toBeVisible();
    await deleteSeatDialog.getByRole("button", { name: "Delete seat" }).click();
    await expect(firstRow.locator(".seating-seat--canvas")).toHaveCount(9);
  }
  await expect(page.getByRole("button", { name: "+ Add row to back" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Add row to front" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unassigned Profiles" })).toBeVisible();
  api.assertNoUnexpectedRequests();
});
