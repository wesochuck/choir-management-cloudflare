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

  const progressBar = page.locator(".attendance-progress");
  await expect(progressBar).toBeVisible();

  const undoSlot = page.locator(".attendance-undo-slot");
  await expect(undoSlot).toBeVisible();
  const slotBox = await undoSlot.boundingBox();
  expect(slotBox).toBeDefined();
  expect(slotBox?.height).toBeCloseTo(48, 1);

  // Measure relative distance from progress bar to first row
  const getRowOffsetFromProgress = async () =>
    firstRow.evaluate((el) => {
      const progressBar = document.querySelector(".attendance-progress");
      return el.getBoundingClientRect().top - (progressBar?.getBoundingClientRect().bottom ?? 0);
    });

  const initialOffset = await getRowOffsetFromProgress();

  // Tap row to change status
  const toggleButton = firstRow.getByRole("button");
  await toggleButton.click();

  const undoButton = undoSlot.getByRole("button", { name: /^Undo/ });
  await expect(undoButton).toBeVisible();

  // 1. Verify list position relative to progress bar is identical before and after bar appears
  const activeOffset = await getRowOffsetFromProgress();
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
  const restoredOffset = await getRowOffsetFromProgress();
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
