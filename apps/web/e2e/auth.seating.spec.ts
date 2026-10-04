import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import {
  buildOrganizationEvent,
  buildOrganizationProfile,
  buildSeatingChart,
} from "./fixtures/builders";

test("shows compact Grid assignment guidance and hides it in print", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  const chart = buildSeatingChart();
  api.seatingCharts.set([chart]);
  await page.goto(`/admin/seating?eventId=${chart.eventId}&chartId=${chart.id}`);
  for (const mode of ["List", "Last name index"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    const hint = page.locator(".seating-mode-hint");
    await expect(hint).toHaveText("Assign or move singers in Grid mode.Switch to Grid");
    await page.emulateMedia({ media: "print" });
    await expect(hint).toBeHidden();
    await page.emulateMedia({ media: "screen" });
    await hint.getByRole("button", { name: "Switch to Grid" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Grid", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator(".seating-editor-canvas")).toBeVisible();
  }
  if ((page.viewportSize()?.width ?? 1000) <= 700) {
    await page.getByRole("button", { name: "Edit anyway" }).click();
  }
  const gridHint = page.locator(".seating-mode-hint");
  await expect(gridHint).toHaveText("Drag a singer to a seat, or select a seat to assign someone.");
  await page.emulateMedia({ media: "print" });
  await expect(gridHint).toBeHidden();
  api.assertNoUnexpectedRequests();
});

test("seat name tooltips support hover, focus, themes, and the mobile read-only chart", async ({
  page,
}, testInfo) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  const chart = buildSeatingChart({ rowCounts: [16] });
  api.seatingCharts.set([chart]);
  await page.goto(`/admin/seating?eventId=${chart.eventId}&chartId=${chart.id}`);
  const seat = page.locator('[data-seat-key="0-0"].seating-seat--assigned');
  await expect(seat).toBeVisible();
  await expect(seat).not.toHaveAttribute("title");
  if ((page.viewportSize()?.width ?? 1000) <= 700) {
    await expect(page.locator(".seating-editor-canvas")).toHaveClass(/--readonly/);
  }
  for (const theme of ["light", "dark"] as const) {
    const switchTheme = page.getByRole("button", { name: `Switch to ${theme} theme` });
    if (await switchTheme.isVisible()) await switchTheme.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await seat.evaluate(async (node) => {
      node.scrollIntoView({ behavior: "instant", block: "center" });
      // Let the scroll event close any previous tooltip before exercising focus.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve();
          }),
        ),
      );
    });
    await seat.evaluate((node) => {
      node.focus({ preventScroll: true });
    });
    await expect(page.getByRole("tooltip")).toHaveText("Browser Singer");
    await expect(page.locator(".tooltip")).toBeInViewport();
    await expect(seat).toHaveAttribute("data-state", "instant-open");
    await page.screenshot({ path: testInfo.outputPath(`seat-tooltip-${theme}.png`) });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.getByLabel("Select seating chart").focus();
    if ((page.viewportSize()?.width ?? 1000) > 700) {
      await seat.hover();
      await expect(page.getByRole("tooltip")).toHaveText("Browser Singer", { timeout: 1000 });
      await page.locator(".tooltip").hover();
      await expect(page.getByRole("tooltip")).toHaveText("Browser Singer");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("tooltip")).toHaveCount(0);
    }
  }
  api.assertNoUnexpectedRequests();
});

test("keeps unassigned singers' voice parts visible beside truncated names", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  const displayName = "Alexandra Catherine Montgomery-Wellington";
  api.profiles.set([buildOrganizationProfile({ displayName, voicePart: "S2" })]);
  await page.goto("/admin/seating");
  await page.getByRole("button", { name: "Create chart" }).click();
  await page.getByLabel("Chart name").fill("Voice part visibility");
  await page.getByRole("button", { name: "Create chart", exact: true }).click();
  if ((page.viewportSize()?.width ?? 1000) <= 700) {
    await page.getByRole("button", { name: "Edit anyway" }).click();
  }

  const chip = page.locator(".seating-profile-chip").first();
  await expect(chip).toBeVisible();
  for (const theme of ["light", "dark"] as const) {
    const switchTheme = page.getByRole("button", { name: `Switch to ${theme} theme` });
    if (await switchTheme.isVisible()) await switchTheme.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(chip.locator(".seating-profile-chip__voice")).toHaveText("S2");
    await expect(chip.locator(".seating-profile-chip__name")).not.toHaveAttribute("title");
    const layout = await chip.evaluate((element) => {
      const name = element.querySelector<HTMLElement>(".seating-profile-chip__name");
      const voice = element.querySelector<HTMLElement>(".seating-profile-chip__voice");
      const remove = element.querySelector("button");
      if (!name || !voice || !remove) throw new Error("Missing singer chip content");
      const chipBounds = element.getBoundingClientRect();
      const voiceBounds = voice.getBoundingClientRect();
      return {
        nameTruncated: name.scrollWidth > name.clientWidth,
        voiceUnclipped:
          voice.scrollWidth === voice.clientWidth && voice.scrollHeight === voice.clientHeight,
        voiceInside: voiceBounds.left >= chipBounds.left && voiceBounds.right <= chipBounds.right,
        noOverlap:
          name.getBoundingClientRect().right <= voiceBounds.left &&
          voiceBounds.right <= remove.getBoundingClientRect().left,
      };
    });
    expect(layout).toEqual({
      nameTruncated: true,
      voiceUnclipped: true,
      voiceInside: true,
      noOverlap: true,
    });
    await chip.evaluate(async (node) => {
      node.scrollIntoView({ behavior: "instant", block: "center" });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve();
          }),
        ),
      );
      node.focus({ preventScroll: true });
    });
    await expect(page.getByRole("tooltip")).toHaveText(displayName);
    await expect(chip).toHaveAttribute("data-state", "instant-open");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Search unassigned Profiles" }).focus();
    if ((page.viewportSize()?.width ?? 1000) > 700) {
      await chip.hover();
      await expect(page.getByRole("tooltip")).toHaveText(displayName, { timeout: 1000 });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("tooltip")).toHaveCount(0);
    }
  }
  if ((page.viewportSize()?.width ?? 1000) > 700) {
    await page.getByRole("button", { name: "Full Screen" }).click();
    await chip.hover();
    await expect(page.getByRole("tooltip")).toHaveText(displayName);
    expect(
      await page
        .getByRole("tooltip")
        .evaluate((tooltip) => Boolean(document.fullscreenElement?.contains(tooltip))),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect(page.locator(".seating-workspace")).toHaveClass(/seating-workspace--focus/);
  }
  api.assertNoUnexpectedRequests();
});

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
    await expect(assignedSeat).not.toHaveAttribute("title");
    await assignedSeat.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Browser Singer", { timeout: 1000 });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await assignedSeat.focus();
    await expect(page.getByRole("tooltip")).toHaveText("Browser Singer");
    await page.keyboard.press("Escape");
    await expect(assignedSeat.getByText("Browser Singer", { exact: true })).toBeHidden();
    await page.getByRole("button", { name: "Full Screen" }).click();
    await expect(page.locator(".seating-workspace")).toHaveClass(/seating-workspace--focus/);
    const isFullscreen = await page.evaluate(
      () => document.fullscreenElement === document.querySelector(".seating-workspace"),
    );
    expect(isFullscreen).toBe(true);
    await assignedSeat.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Browser Singer");
    expect(
      await page
        .getByRole("tooltip")
        .evaluate((tooltip) => Boolean(document.fullscreenElement?.contains(tooltip))),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    // Open confirmation in fullscreen
    await assignedSeat.getByRole("button", { name: "Remove Browser Singer from Seat 1" }).click();
    const clearSeatDialog = page.getByRole("dialog", { name: "Clear seat assignment?" });
    await expect(clearSeatDialog).toBeVisible();
    await expect(clearSeatDialog).toContainText("return them to Unassigned Profiles");

    // Assert the dialog is rendered inside the fullscreen workspace element
    const dialogInWorkspace = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const ws = document.querySelector(".seating-workspace");
      return Boolean(dialog && ws?.contains(dialog));
    });
    expect(dialogInWorkspace).toBe(true);

    // 1. Cancel preserves assignment, maintains fullscreen, and restores focus
    await clearSeatDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(clearSeatDialog).toHaveCount(0);
    await expect(
      page.locator(".seating-seat--assigned").filter({ hasText: "Browser Singer" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.fullscreenElement === document.querySelector(".seating-workspace"),
      ),
    ).toBe(true);

    // 2. Exiting fullscreen with dialog open keeps it visible
    await assignedSeat.getByRole("button", { name: "Remove Browser Singer from Seat 1" }).click();
    await expect(clearSeatDialog).toBeVisible();
    await page.evaluate(() => document.exitFullscreen());
    await expect(page.locator(".seating-workspace")).not.toHaveClass(/seating-workspace--focus/);
    await expect(clearSeatDialog).toBeVisible();
    // Dismissing in normal mode works cleanly
    await clearSeatDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(clearSeatDialog).toHaveCount(0);

    // Reenter fullscreen
    await page.getByRole("button", { name: "Full Screen" }).click();
    await expect(page.locator(".seating-workspace")).toHaveClass(/seating-workspace--focus/);
    await page.waitForFunction(
      () => document.fullscreenElement === document.querySelector(".seating-workspace"),
    );

    // 3. Confirm clears assignment in fullscreen and restores useful focus
    await assignedSeat.getByRole("button", { name: "Remove Browser Singer from Seat 1" }).click();
    await expect(clearSeatDialog).toBeVisible();
    await clearSeatDialog.getByRole("button", { name: "Clear assignment" }).click();
    await expect(
      page.locator(".seating-seat--assigned").filter({ hasText: "Browser Singer" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.fullscreenElement === document.querySelector(".seating-workspace"),
      ),
    ).toBe(true);
    const firstRow = page.locator(".seating-row--canvas").filter({ hasText: "Row 1" }).first();
    await expect(firstRow.locator(".seating-seat--canvas")).toHaveCount(10);

    // Delete empty seat in fullscreen
    await firstRow.getByRole("button", { name: "Delete empty Seat 1", exact: true }).click();
    const deleteSeatDialog = page.getByRole("dialog", { name: "Delete empty seat?" });
    await expect(deleteSeatDialog).toBeVisible();
    await deleteSeatDialog.getByRole("button", { name: "Delete seat" }).click();
    await expect(firstRow.locator(".seating-seat--canvas")).toHaveCount(9);

    // 4. Test another dialog + nested discard confirmation in fullscreen
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    const renameChartDialog = page.getByRole("dialog", { name: "Rename seating chart" });
    await expect(renameChartDialog).toBeVisible();
    await renameChartDialog.getByLabel("Chart name").fill("Dirty chart draft");
    // Escape triggers discard confirmation
    await page.keyboard.press("Escape");
    const discardDialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(discardDialog).toBeVisible();
    // Cancel preserves dialog
    await discardDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(discardDialog).toHaveCount(0);
    await expect(renameChartDialog).toBeVisible();
    // Discard closes
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeVisible();
    await page.getByRole("button", { name: "Discard changes" }).click();
    await expect(renameChartDialog).toHaveCount(0);

    // Exit fullscreen
    await page.getByRole("button", { name: "Exit full screen" }).click();
    await expect(page.locator(".seating-workspace")).not.toHaveClass(/seating-workspace--focus/);
  }
  await expect(page.getByRole("button", { name: "+ Add row to back" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Add row to front" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unassigned Profiles" })).toBeVisible();
  api.assertNoUnexpectedRequests();
});

test("falls back to CSS focus mode when Fullscreen API is rejected", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.goto("/admin/seating");

  if ((page.viewportSize()?.width ?? 1000) > 700) {
    // Reject requestFullscreen to exercise CSS fallback
    await page.evaluate(() => {
      Element.prototype.requestFullscreen = () =>
        Promise.reject(new Error("Fullscreen API rejected"));
    });
    await page.getByRole("button", { name: "Full Screen" }).click();
    await expect(page.locator(".seating-workspace")).toHaveClass(
      /seating-workspace--fallback-focus/,
    );

    // Open chart dialog in fallback focus
    await page.getByRole("button", { name: "Create chart" }).click();
    const chartDialog = page.getByRole("dialog", { name: "New seating chart" });
    await expect(chartDialog).toBeVisible();

    // Escape closes the dialog without exiting fallback focus
    await page.keyboard.press("Escape");
    await expect(chartDialog).toHaveCount(0);
    await expect(page.locator(".seating-workspace")).toHaveClass(
      /seating-workspace--fallback-focus/,
    );

    // Escape when no modal is open exits fallback focus
    await page.keyboard.press("Escape");
    await expect(page.locator(".seating-workspace")).not.toHaveClass(
      /seating-workspace--fallback-focus/,
    );
  }
  api.assertNoUnexpectedRequests();
});

test("defaults Seating to closest upcoming Performance and honors explicit deep links", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });

  const pastConcertId = "11111111-1111-4111-8111-111111111111";
  const nearestUpcomingId = "22222222-2222-4222-8222-222222222222";
  const distantUpcomingId = "33333333-3333-4333-8333-333333333333";
  const rehearsalId = "44444444-4444-4444-8444-444444444444";

  const now = Date.now();
  const pastDate = new Date(now - 7 * 86_400_000).toISOString();
  const nearestDate = new Date(now + 1 * 86_400_000).toISOString();
  const distantDate = new Date(now + 30 * 86_400_000).toISOString();
  const rehearsalDate = new Date(now + 12 * 3600_000).toISOString();

  const pastConcert = buildOrganizationEvent({
    id: pastConcertId,
    startsAt: pastDate,
    title: "Past Festival",
    type: "Performance",
  });
  const nearestConcert = buildOrganizationEvent({
    id: nearestUpcomingId,
    startsAt: nearestDate,
    title: "Nearest Spring Concert",
    type: "Performance",
  });
  const distantConcert = buildOrganizationEvent({
    id: distantUpcomingId,
    startsAt: distantDate,
    title: "Distant Gala",
    type: "Performance",
  });
  const rehearsal = buildOrganizationEvent({
    id: rehearsalId,
    startsAt: rehearsalDate,
    title: "Dress Rehearsal",
    type: "Rehearsal",
  });

  api.events.set([distantConcert, pastConcert, rehearsal, nearestConcert]);

  // Navigate to bare /admin/seating without query parameters
  await page.goto("/admin/seating");

  const performanceSelect = page.getByLabel("Seating Performance");
  await expect(performanceSelect).toHaveValue(nearestUpcomingId);
  await expect(page).toHaveURL(new RegExp(`eventId=${nearestUpcomingId}`));

  // Navigate directly with an explicit historical deep link
  await page.goto(`/admin/seating?eventId=${pastConcertId}`);
  await expect(performanceSelect).toHaveValue(pastConcertId);
  await expect(page).toHaveURL(new RegExp(`eventId=${pastConcertId}`));

  api.assertNoUnexpectedRequests();
});
