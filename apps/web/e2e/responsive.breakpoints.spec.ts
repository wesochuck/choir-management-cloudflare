import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { fulfillJson } from "./fixtures/session";

const publicDonationSettings = {
  active: true,
  allowAnonymous: true,
  allowCustomAmount: true,
  allowRecurring: true,
  allowTribute: true,
  coverFeesDefault: false,
  coverFeesEnabled: true,
  currency: "usd",
  customAmountMaxCents: 1000000,
  customAmountMinCents: 500,
  defaultAmountCents: 5000,
  description: "Help us keep choral arts accessible to all.",
  levels: [
    { amountCents: 2500, description: "Supports rehearsal materials", id: "lvl-1", name: "Friend" },
    {
      amountCents: 5000,
      description: "Funds sheet music for one singer",
      id: "lvl-2",
      name: "Supporter",
    },
    { amountCents: 10000, description: "Sponsors a student singer", id: "lvl-3", name: "Patron" },
    { amountCents: 25000, description: "Supports guest artists", id: "lvl-4", name: "Benefactor" },
    {
      amountCents: 50000,
      description: "Underwrites an entire concert",
      id: "lvl-5",
      name: "Director Circle",
    },
  ],
  orgId: "org-donation-responsive",
  orgName: "Harmony Chorus",
  suggestedAmounts: [2500, 5000, 10000, 25000, 50000],
  title: "Support our Music",
};

const publicFeeSettings = {
  feeFixedCents: 30,
  feePercentage: 2.9,
};

test.describe("Normalized Responsive Breakpoints (Issue #80)", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`public donation layout responds across 40rem and 48rem boundaries in ${theme} theme`, async ({
      page,
    }) => {
      await page.route("**/api/public/donation-settings*", async (route) => {
        await route.fulfill({
          body: JSON.stringify(publicDonationSettings),
          contentType: "application/json",
          status: 200,
        });
      });
      await page.route("**/api/public/transaction-fee-settings*", async (route) => {
        await route.fulfill({
          body: JSON.stringify(publicFeeSettings),
          contentType: "application/json",
          status: 200,
        });
      });

      await page.goto("/donate");
      await page.evaluate((t) => {
        document.documentElement.setAttribute("data-theme", t);
      }, theme);
      await expect(page.getByRole("heading", { name: "Support our Music" })).toBeVisible();

      const body = page.locator(".public-donation-body");
      const levelGrid = page.locator(".public-donation-form .donation-level-grid");
      const tributeOptions = page.locator(".donation-tribute-options");
      const contactGrid = page.locator(".public-donation-contact-grid");

      // 1. Desktop (> 48rem = 768px, test at 1024px / 64rem)
      await page.setViewportSize({ width: 1024, height: 800 });
      await page.waitForTimeout(100);

      expect(
        await body.evaluate(
          (el) => window.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
        ),
      ).toBe(2);
      expect(
        await levelGrid.evaluate(
          (el) => window.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
        ),
      ).toBe(3);
      expect(
        await tributeOptions.evaluate(
          (el) => window.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
        ),
      ).toBe(3);
      expect(
        await contactGrid.evaluate(
          (el) => window.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
        ),
      ).toBe(3);

      let hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasOverflow, "desktop layout should not overflow horizontally").toBe(false);

      // 2. Tablet (between 40rem = 640px and 48rem = 768px, test at 700px)
      await page.setViewportSize({ width: 700, height: 800 });
      await page.waitForTimeout(100);

      expect(
        await body.evaluate(
          (el) => window.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
        ),
      ).toBe(1);
      expect(
        await levelGrid.evaluate(
          (el) => window.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
        ),
      ).toBe(2);
      expect(
        await tributeOptions.evaluate(
          (el) => window.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
        ),
      ).toBe(2);
      expect(
        await contactGrid.evaluate(
          (el) => window.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
        ),
      ).toBe(2);

      hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasOverflow, "tablet layout should not overflow horizontally").toBe(false);

      // 3. Mobile (< 40rem = 640px, test at 390px)
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(100);

      expect(
        await body.evaluate(
          (el) => window.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
        ),
      ).toBe(1);
      expect(
        await levelGrid.evaluate(
          (el) => window.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
        ),
      ).toBe(1);
      expect(
        await tributeOptions.evaluate(
          (el) => window.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
        ),
      ).toBe(1);
      expect(
        await contactGrid.evaluate(
          (el) => window.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
        ),
      ).toBe(1);

      hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasOverflow, "mobile layout should not overflow horizontally").toBe(false);
    });

    test(`admin overview cards respond across 40rem boundary in ${theme} theme`, async ({
      page,
    }) => {
      await installOrganizationApi(page, { role: "administrator", strict: true });
      await page.route("**/api/organization/tickets/orders", async (route) => {
        await fulfillJson(route, { orders: [], requestId: "99999999-9999-4999-8999-999999999999" });
      });

      await page.goto("/admin");
      await page.evaluate((t) => {
        document.documentElement.setAttribute("data-theme", t);
      }, theme);
      await expect(page.locator(".signed-in-header")).toBeVisible();

      const cardsGrid = page.locator(".admin-overview__cards").first();
      await expect(cardsGrid).toBeVisible();

      // 1. Desktop (> 40rem = 640px, test at 1280px / 80rem)
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(100);

      expect(
        await cardsGrid.evaluate(
          (el) => window.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
        ),
      ).toBe(4);

      let hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasOverflow, "desktop admin overview should not overflow horizontally").toBe(false);

      // 2. Mobile (< 40rem = 640px, test at 390px)
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(100);

      expect(
        await cardsGrid.evaluate(
          (el) => window.getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
        ),
      ).toBe(1);

      hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasOverflow, "mobile admin overview should not overflow horizontally").toBe(false);
    });
  }
});
