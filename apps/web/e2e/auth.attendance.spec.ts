import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { buildAttendanceRow, buildOrganizationEvent } from "./fixtures/builders";

test("keeps the attendance heading close to its manager and removes the explainer paragraph", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });

  await page.goto("/admin/attendance");
  const attendancePage = page.getByRole("main");
  await expect(attendancePage.getByRole("heading", { name: "Attendance" })).toBeVisible();

  // 1. Explainer paragraph is absent entirely
  await expect(page.getByText(/Tap a name to cycle/i)).not.toBeVisible();
  await expect(page.getByText(/Changes save immediately/i)).not.toBeVisible();

  // 2. No empty paragraph or leftover subtitle element in page heading
  await expect(attendancePage.locator(".page-heading p")).toHaveCount(0);

  // 3. Page heading and attendance manager remain closely spaced (<= 16px)
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

test("preserves list position, does not overflow horizontally, and does not obscure rows across undo bar states", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });

  await page.goto("/admin/attendance");
  const attendancePage = page.getByRole("main");
  await expect(attendancePage.getByRole("heading", { name: "Attendance" })).toBeVisible();

  // Switch to All filter so performer remains visible when status changes
  await page.getByRole("button", { name: /^All/ }).click();

  const firstRow = page.locator(".attendance-row").first();
  await expect(firstRow).toBeVisible();

  await expect(page.locator(".attendance-progress")).toHaveCount(0);

  const undoSlot = page.locator(".attendance-undo-slot");
  await expect(undoSlot).toBeVisible();
  const slotBox = await undoSlot.boundingBox();
  expect(slotBox).toBeDefined();
  expect(slotBox?.height).toBeCloseTo(48, 1);

  // Measure relative distance from sticky controls to first row
  const getRowOffsetFromHeader = async () =>
    firstRow.evaluate((el) => {
      const header = document.querySelector(".attendance-manager__sticky-header");
      return el.getBoundingClientRect().top - (header?.getBoundingClientRect().bottom ?? 0);
    });

  const initialOffset = await getRowOffsetFromHeader();

  // Tap row to change status
  const toggleButton = firstRow.getByRole("button");
  await toggleButton.click();

  const undoButton = undoSlot.getByRole("button", { name: /^Undo/ });
  await expect(undoButton).toBeVisible();

  // 1. Verify list position relative to sticky controls is identical before and after bar appears
  const activeOffset = await getRowOffsetFromHeader();
  expect(activeOffset).toBeCloseTo(initialOffset, 1);

  // 2. Verify Undo does not obscure the row
  const [activeSlotBox, activeRowBox] = await Promise.all([
    undoSlot.boundingBox(),
    firstRow.boundingBox(),
  ]);
  expect(activeSlotBox).toBeDefined();
  expect(activeRowBox).toBeDefined();
  if (activeSlotBox && activeRowBox) {
    expect(activeSlotBox.y + activeSlotBox.height).toBeLessThanOrEqual(activeRowBox.y + 1);
  }

  // 3. Verify no horizontal overflow in undo bar or page
  const slotOverflows = await undoSlot.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(slotOverflows).toBe(false);

  const pageOverflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(pageOverflows).toBe(false);

  // 4. Click Undo and verify restoration
  await undoButton.click();
  await expect(undoButton).not.toBeVisible();

  // 5. Verify position remains identical after exhausted history
  const restoredOffset = await getRowOffsetFromHeader();
  expect(restoredOffset).toBeCloseTo(initialOffset, 1);

  api.assertNoUnexpectedRequests();
});

test("allows undoing a performer who disappeared from the default Unmarked filter", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });

  await page.goto("/admin/attendance");
  const attendancePage = page.getByRole("main");
  await expect(attendancePage.getByRole("heading", { name: "Attendance" })).toBeVisible();

  // Default filter is Pending (Unmarked)
  const firstRow = page.locator(".attendance-row").first();
  await expect(firstRow).toBeVisible();

  // Mark the performer
  await firstRow.getByRole("button").click();

  // Performer disappears from Unmarked list
  await expect(page.getByText(/No (performers|singers) match this filter\./i)).toBeVisible();

  // Undo bar remains visible at top
  const undoSlot = page.locator(".attendance-undo-slot");
  const undoButton = undoSlot.getByRole("button", { name: /^Undo/ });
  await expect(undoButton).toBeVisible();

  // Clicking Undo restores the performer back to the Unmarked list
  await undoButton.click();
  await expect(firstRow).toBeVisible();
  await expect(undoButton).not.toBeVisible();

  api.assertNoUnexpectedRequests();
});

test("keeps a long selected event to one truncated line at 320, 375, 390, 430, and 1280 px without horizontal overflow", async ({
  page,
}, testInfo) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });

  const longEventTitle =
    "2026 Christmas & New Year Holiday Masterworks Mega Gala Concert Rehearsal with Combined Symphony and Special Guest Soloists";
  const longLocation = "Sanctuary Main Hall, North Campus Education Wing Room 101, Building B";
  const longEvent = buildOrganizationEvent({
    id: "11111111-1111-4111-8111-111111111101",
    location: longLocation,
    startsAt: "2026-12-20T19:00:00.000Z",
    title: longEventTitle,
    venueId: null,
  });
  const secondLongEvent = buildOrganizationEvent({
    id: "11111111-1111-4111-8111-111111111102",
    location: longLocation,
    startsAt: "2026-12-21T19:00:00.000Z",
    title:
      "2026 Christmas & New Year Holiday Masterworks Mega Gala Concert Rehearsal - Evening Dress Call",
    venueId: null,
  });
  api.events.set([longEvent, secondLongEvent]);

  await page.goto("/admin/attendance");
  const attendancePage = page.getByRole("main");
  await expect(attendancePage.getByRole("heading", { name: "Attendance" })).toBeVisible();

  const select = attendancePage.locator(".attendance-manager__event-select");
  await expect(select).toBeVisible();

  // Test across all required mobile & desktop breakpoints
  const widths = [320, 375, 390, 430, 1280];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });

    const selectBox = await select.boundingBox();
    expect(selectBox).not.toBeNull();
    // Native control height remains one line (<= 56px; standard select min-height is 3.25rem = 52px)
    expect(selectBox?.height).toBeLessThanOrEqual(56);

    // CSS properties strictly enforce single line truncation
    const styles = await select.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        textOverflow: computed.textOverflow,
        whiteSpace: computed.whiteSpace,
      };
    });
    expect(styles.textOverflow).toBe("ellipsis");

    // No horizontal page overflow
    const hasHorizontalPageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(hasHorizontalPageOverflow).toBe(false);

    // Select does not overflow its container
    const selectContainer = attendancePage.locator(".attendance-manager__event-field");
    const [selectWidth, containerWidth] = await Promise.all([
      select.evaluate((el) => el.getBoundingClientRect().width),
      selectContainer.evaluate((el) => el.getBoundingClientRect().width),
    ]);
    expect(selectWidth).toBeLessThanOrEqual(containerWidth + 1);
  }

  // Verify full event text is accessible in title attribute and option titles
  const selectTitle = await select.getAttribute("title");
  expect(selectTitle).toContain(longEventTitle);
  expect(selectTitle).toContain(longLocation);

  const options = select.locator("option");
  await expect(options).toHaveCount(2);
  const firstOptionTitle = await options.nth(0).getAttribute("title");
  const secondOptionTitle = await options.nth(1).getAttribute("title");
  expect(firstOptionTitle).toContain(longEventTitle);
  expect(secondOptionTitle).toContain("Evening Dress Call");

  // Verify event switching works
  await select.selectOption(secondLongEvent.id);
  await expect(select).toHaveValue(secondLongEvent.id);
  const updatedTitle = await select.getAttribute("title");
  expect(updatedTitle).toContain("Evening Dress Call");

  // Capture screenshots at 1280px (desktop) and 390px (mobile) in light and dark mode for visual evidence
  if (testInfo.project.name === "chromium") {
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((t) => {
        document.documentElement.setAttribute("data-theme", t);
        document.querySelector(".signed-in-shell")?.setAttribute("data-theme", t);
      }, theme);
      await page.screenshot({
        path: testInfo.outputPath(`attendance-desktop-${theme}.png`),
        fullPage: false,
      });
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => {
      document.documentElement.setAttribute("data-theme", t);
      document.querySelector(".signed-in-shell")?.setAttribute("data-theme", t);
    }, theme);
    await page.screenshot({
      path: testInfo.outputPath(`attendance-mobile-${theme}.png`),
      fullPage: false,
    });
  }

  api.assertNoUnexpectedRequests();
});

for (const theme of ["light", "dark"] as const) {
  test(`compact mobile attendance keeps two sticky control rows in ${theme}`, async ({
    page,
  }, info) => {
    const api = await installOrganizationApi(page, { role: "administrator", strict: true });
    api.attendanceRows.set(
      new Map(
        Array.from({ length: 30 }, (_, index) => {
          const row = buildAttendanceRow({
            profileId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            displayName: `Singer ${String(index + 1).padStart(2, "0")}`,
          });
          return [row.profileId, row];
        }),
      ),
    );
    await page.addInitScript((mode) => {
      localStorage.setItem(`choir-theme:${location.hostname}`, mode);
    }, theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/attendance");
    const header = page.locator(".attendance-manager__sticky-header");
    const event = page.getByLabel("Event", { exact: true });
    const search = page.getByRole("searchbox");
    const filters = page.getByRole("group", { name: "Attendance filter" });
    const bulk = page.getByRole("button", { name: "Mark remaining present", exact: true });
    await expect(page.locator(".attendance-row")).toHaveCount(30);
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      const geometry = await header.evaluate((node) => ({
        height: node.getBoundingClientRect().height,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      expect(geometry.height).toBeLessThanOrEqual(132);
      expect(geometry.overflow).toBe(false);
      const [eventBox, bulkBox, searchBox, filterBox] = await Promise.all([
        event.boundingBox(),
        bulk.boundingBox(),
        search.boundingBox(),
        filters.boundingBox(),
      ]);
      expect(eventBox?.y).toBe(bulkBox?.y);
      expect(searchBox?.y).toBe(filterBox?.y);
      expect(bulkBox?.height).toBeGreaterThanOrEqual(44);
      expect(searchBox?.width).toBeGreaterThanOrEqual(100);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await search.fill("Singer 01");
    await expect(page.locator(".attendance-row")).toHaveCount(1);
    await page.locator(".attendance-row__toggle").click();
    await expect(page.locator(".attendance-row")).toHaveCount(0);
    await page.getByRole("button", { name: /^Undo/ }).click();
    await expect(page.locator(".attendance-row")).toHaveCount(1);
    await search.clear();
    await bulk.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.screenshot({ path: info.outputPath(`compact-attendance-${theme}.png`) });
    await page.evaluate(() => {
      window.scrollTo(0, 500);
    });
    await expect.poll(async () => (await header.boundingBox())?.y).toBe(0);
    await expect(event).toBeInViewport();
    await expect(search).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`sticky-attendance-${theme}.png`) });
    api.assertNoUnexpectedRequests();
  });
}
