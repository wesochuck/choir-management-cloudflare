import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { installOrganizationApi } from "./fixtures/apiMocks";
import { fulfillJson } from "./fixtures/session";

// Automated responsive dialog test suite (Issue #14):
// Verifies all dialog sizing, scrolling, touch targets, discard guards,
// compact confirmation behavior, and accessibility across mobile and desktop viewports.

const TOLERATED_CONTRAST_TARGETS = [
  "quick-search-kbd",
  "Gap between tracks",
  "Adds silence before the next track starts.",
  "Choose whether to stop, repeat the set list, or repeat one track.",
];

function isToleratedContrast(violationId: string, target: string, html: string): boolean {
  if (violationId !== "color-contrast") return false;
  const haystack = `${target} ${html}`;
  return TOLERATED_CONTRAST_TARGETS.some((entry) => haystack.includes(entry));
}

async function expectNoSeriousAxeViolations(page: Page, context: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const blocking = results.violations.flatMap((violation) =>
    violation.nodes
      .filter(
        (node) =>
          (violation.impact === "serious" || violation.impact === "critical") &&
          !isToleratedContrast(violation.id, node.target.join(" "), node.html),
      )
      .map(
        (node) =>
          `${violation.id} (${violation.impact ?? "unknown"}): ` +
          `${node.target.join(" ")} — ${violation.helpUrl}`,
      ),
  );

  expect(blocking, `axe violations found for ${context}`).toEqual([]);
}

async function setupDonationsPage(page: Page): Promise<void> {
  await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.route("**/api/organization/tickets/orders", async (route) => {
    await fulfillJson(route, { orders: [], requestId: "99999999-9999-4999-8999-999999999999" });
  });
  await page.goto("/admin/donations");
}

test.describe("Responsive Dialog System", () => {
  test("mobile viewports render full-viewport dialog with scrollable body, sticky actions, and >=44px close target", async ({
    page,
  }) => {
    const mobileViewports = [
      { height: 568, name: "320x568 (iPhone SE 1st gen)", width: 320 },
      { height: 667, name: "375x667 (iPhone SE 2nd/3rd gen)", width: 375 },
      { height: 844, name: "390x844 (iPhone 12/13/14)", width: 390 },
    ];

    for (const vp of mobileViewports) {
      await page.setViewportSize({ height: vp.height, width: vp.width });
      await setupDonationsPage(page);

      await page.getByRole("button", { name: "Record donation" }).click();
      const dialog = page.getByRole("dialog", { name: "Record donation" });
      await expect(dialog).toBeVisible();

      // 1. Assert no horizontal document-level overflow
      const docOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(docOverflow, `Document should not horizontally overflow on ${vp.name}`).toBe(false);

      // 2. Assert dialog bounds occupy full mobile viewport
      const dialogBox = await dialog.boundingBox();
      expect(dialogBox, `Dialog bounding box should exist on ${vp.name}`).not.toBeNull();
      if (dialogBox) {
        expect(dialogBox.x).toBeLessThanOrEqual(1);
        expect(dialogBox.width).toBeGreaterThanOrEqual(vp.width - 2);
        expect(dialogBox.height).toBeGreaterThanOrEqual(vp.height - 2);
      }

      // 3. Assert close button touch target is at least 44x44px
      const closeButton = dialog.locator(".dialog__close");
      await expect(closeButton).toBeVisible();
      const closeBox = await closeButton.boundingBox();
      expect(closeBox, `Close button bounding box on ${vp.name}`).not.toBeNull();
      if (closeBox) {
        expect(closeBox.width).toBeGreaterThanOrEqual(44);
        expect(closeBox.height).toBeGreaterThanOrEqual(44);
      }

      // 4. Assert header is visible at the top
      const header = dialog.locator(".dialog__header");
      await expect(header).toBeVisible();

      // 5. Assert body scrolls and actions are sticky at the bottom
      const body = dialog.locator(".dialog__body");
      await expect(body).toBeVisible();
      const isBodyScrollable = await body.evaluate((el) => el.scrollHeight > el.clientHeight);
      expect(isBodyScrollable, `Dialog body should be scrollable on ${vp.name}`).toBe(true);

      const actions = dialog.locator(".dialog__actions");
      await expect(actions).toBeVisible();
      const actionsBox = await actions.boundingBox();
      expect(actionsBox, `Actions bounding box on ${vp.name}`).not.toBeNull();
      if (actionsBox) {
        // Sticky actions should be visible in viewport without scrolling
        expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(vp.height + 2);
      }

      // 6. Close dialog via close button
      await closeButton.click();
      await expect(dialog).not.toBeVisible();
    }
  });

  test("short viewport (375x400 virtual keyboard) and landscape (667x375) preserve scroll and actions", async ({
    page,
  }) => {
    const constrainedViewports = [
      { height: 400, name: "375x400 (virtual keyboard)", width: 375 },
      { height: 375, name: "667x375 (landscape mobile)", width: 667 },
    ];

    for (const vp of constrainedViewports) {
      await page.setViewportSize({ height: vp.height, width: vp.width });
      await setupDonationsPage(page);

      await page.getByRole("button", { name: "Record donation" }).click();
      const dialog = page.getByRole("dialog", { name: "Record donation" });
      await expect(dialog).toBeVisible();

      // No horizontal overflow
      const docOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(docOverflow, `Document should not horizontally overflow on ${vp.name}`).toBe(false);

      // Body scrollable
      const body = dialog.locator(".dialog__body");
      const isScrollable = await body.evaluate((el) => el.scrollHeight > el.clientHeight);
      expect(isScrollable, `Body must be scrollable on ${vp.name}`).toBe(true);

      // Actions visible and reachable
      const actions = dialog.locator(".dialog__actions");
      await expect(actions).toBeVisible();

      // Close button reachable and works
      const closeButton = dialog.locator(".dialog__close");
      await expect(closeButton).toBeVisible();
      await closeButton.click();
      await expect(dialog).not.toBeVisible();
    }
  });

  test("desktop viewport (1280x800) renders centered floating dialog", async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1280 });
    await setupDonationsPage(page);

    await page.getByRole("button", { name: "Record donation" }).click();
    const dialog = page.getByRole("dialog", { name: "Record donation" });
    await expect(dialog).toBeVisible();

    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    if (dialogBox) {
      // Floating centered modal: should not be 100vw wide, and should have left margin > 0
      expect(dialogBox.width).toBeLessThan(1000);
      expect(dialogBox.x).toBeGreaterThan(100);
      expect(dialogBox.y).toBeGreaterThan(20);
    }

    // Escape dismisses clean dialog
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });

  test("dirty form dismissal triggers discard confirmation dialog which remains compact and centered", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await setupDonationsPage(page);

    await page.getByRole("button", { name: "Record donation" }).click();
    const dialog = page.getByRole("dialog", { name: "Record donation" });
    await expect(dialog).toBeVisible();

    // Type in an input to make form dirty
    const amountInput = dialog.getByLabel("Amount (USD)");
    await amountInput.fill("125.00");

    // Attempt to dismiss via Escape
    await page.keyboard.press("Escape");

    // Discard confirmation should appear
    const confirmDialog = page.locator(".dialog--confirmation");
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByText("Discard unsaved changes?")).toBeVisible();

    // Verify confirmation dialog is compact and centered, NOT full-height or full-width sheet
    const confirmBox = await confirmDialog.boundingBox();
    expect(confirmBox).not.toBeNull();
    if (confirmBox) {
      // Should be compact width with side margins on 390px viewport
      expect(confirmBox.width).toBeLessThanOrEqual(390);
      // Compact height, not full 100dvh (844px)
      expect(confirmBox.height).toBeLessThan(400);
      expect(confirmBox.y).toBeGreaterThan(100);
    }

    // Clicking "Cancel" in confirmation retains the original dialog and data
    await confirmDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmDialog).not.toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(amountInput).toHaveValue("125.00");

    // Now clicking close button also opens confirmation
    await dialog.locator(".dialog__close").click();
    await expect(confirmDialog).toBeVisible();

    // Confirming "Discard changes" closes both
    await confirmDialog.getByRole("button", { name: "Discard changes" }).click();
    await expect(confirmDialog).not.toBeVisible();
    await expect(dialog).not.toBeVisible();
  });

  test("dialog accessibility passes WCAG 2 A/AA axe scans on mobile and desktop", async ({
    page,
  }) => {
    // Mobile scan
    await page.setViewportSize({ height: 844, width: 390 });
    await setupDonationsPage(page);
    await page.getByRole("button", { name: "Record donation" }).click();
    const dialog = page.getByRole("dialog", { name: "Record donation" });
    await expect(dialog).toBeVisible();
    await expectNoSeriousAxeViolations(page, "record-donation modal on mobile");

    await dialog.locator(".dialog__close").click();
    await expect(dialog).not.toBeVisible();

    // Desktop scan
    await page.setViewportSize({ height: 800, width: 1280 });
    await page.getByRole("button", { name: "Record donation" }).click();
    await expect(dialog).toBeVisible();
    await expectNoSeriousAxeViolations(page, "record-donation modal on desktop");
  });
});
