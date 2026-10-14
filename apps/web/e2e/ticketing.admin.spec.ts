import { expect, test } from "@playwright/test";
import { futureDateString, futureIsoDate } from "@choir/testkit";
import { buildRosterConfigurationResponse } from "./fixtures/builders";
import { selectEventEditorSection } from "./support/eventEditor";
import {
  adminBundle,
  adminDiscountCode,
  adminEvent,
  adminOrder,
  bundleAdminOrder,
  bundleId,
  eventId,
  futureDate,
  newBundleId,
  pendingDiscountAdminOrder,
  purchaseId,
  redeemedAdminDiscountCode,
  refundedDiscountAdminOrder,
  requestId,
  routeAdminAuth,
  routeHealth,
  saleEndDate,
  saleEndInputValue,
  scanToken,
  secondAdminEvent,
  secondPerformanceDiscountAdminOrder,
  secondPerformanceId,
  sortableAdminOrder,
} from "./support/ticketingFixtures";

test.describe("admin ticket management", () => {
  test("lists orders with buyer, performance, quantity, total, and status", async ({ page }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          orders: [
            adminOrder,
            sortableAdminOrder,
            bundleAdminOrder,
            {
              ...sortableAdminOrder,
              id: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
              buyerName: "Expired Buyer",
              status: "expired",
            },
            {
              ...bundleAdminOrder,
              id: "88888888-9999-4aaa-8bbb-cccccccccccc",
              buyerName: "Expired Bundle Buyer",
              status: "expired",
            },
            {
              ...sortableAdminOrder,
              id: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
              buyerName: "Refunded Buyer",
              status: "refunded",
            },
          ],
          requestId,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    const performanceSummary = page.getByRole("group", { name: "Performance summary" });
    await expect(performanceSummary).toBeVisible();
    await expect(performanceSummary.locator("legend")).toHaveText("Performance summary");
    await expect(performanceSummary.locator("h3")).toHaveCount(0);
    const willCallChecklist = page.getByRole("group", { name: "Will call checklist" });
    await expect(willCallChecklist).toBeVisible();
    await expect(willCallChecklist.locator("legend")).toHaveText("Will call checklist");
    await expect(willCallChecklist.locator("h3")).toHaveCount(0);
    const visibleOrders = page.locator(".data-table:visible, .data-table-cards:visible");
    await expect(visibleOrders.getByText("Jane Buyer", { exact: true })).toBeVisible();
    await expect(visibleOrders.getByText("jane@example.test", { exact: true })).toBeVisible();
    await expect(visibleOrders.locator(".ticket-discount-code-pill")).toHaveText("SPRING10");
    await expect(page.getByRole("status")).toContainText("Updates automatically every 5 seconds.");
    await expect(
      page.locator(".ticket-dashboard__metric--sold").getByText("Spring Concert", { exact: true }),
    ).toBeVisible();
    await expect(visibleOrders.getByText("$15.74", { exact: true }).first()).toBeVisible();
    await expect(
      visibleOrders.getByText("Paid (simulation)", { exact: true }).first(),
    ).toBeVisible();

    const orderRows = visibleOrders.locator("tbody tr, .data-table-card");
    await expect(orderRows).toHaveCount(3);
    const showInactive = page.getByRole("checkbox", { name: "Show refunded and expired" });
    await expect(showInactive).not.toBeChecked();
    await expect(visibleOrders.getByText("Expired Buyer", { exact: true })).toHaveCount(0);
    await expect(visibleOrders.getByText("Expired Bundle Buyer", { exact: true })).toHaveCount(0);
    await expect(visibleOrders.getByText("Refunded Buyer", { exact: true })).toHaveCount(0);
    await showInactive.check();
    await expect(orderRows).toHaveCount(6);
    await expect(visibleOrders.getByText("Expired Buyer", { exact: true })).toBeVisible();
    await expect(visibleOrders.getByText("Expired Bundle Buyer", { exact: true })).toBeVisible();
    await expect(visibleOrders.getByText("Refunded Buyer", { exact: true })).toBeVisible();
    await showInactive.uncheck();
    await expect(orderRows).toHaveCount(3);
    const bundleRow = orderRows.filter({ hasText: "Bundle Buyer" });
    await expect(bundleRow).toHaveCount(1);
    await expect(bundleRow.locator(".ticketing-bundle-order-pill")).toHaveText("Bundle");
    const standaloneRow = orderRows.filter({ hasText: "Jane Buyer" });
    await expect(standaloneRow.locator(".ticketing-bundle-order-pill")).toHaveCount(0);
    const regularRow = orderRows.filter({ hasText: "Alex Anderson" });
    await expect(regularRow.locator('[aria-label="No discount code"]')).toHaveText("—");
    const buyerSortButton = page.getByRole("button", { name: "Sort by Buyer name" });
    if ((await buyerSortButton.count()) > 0 && (await buyerSortButton.isVisible())) {
      await buyerSortButton.click();
      await expect(orderRows.first().getByText("Alex Anderson", { exact: true })).toBeVisible();
      await buyerSortButton.click();
      await expect(orderRows.first().getByText("Jane Buyer", { exact: true })).toBeVisible();
    }
    const discountSortButton = page.getByRole("button", { name: "Sort by Discount code" });
    if ((await discountSortButton.count()) > 0 && (await discountSortButton.isVisible())) {
      await discountSortButton.click();
      await expect(discountSortButton.locator("xpath=ancestor::th")).toHaveAttribute(
        "aria-sort",
        "ascending",
      );
    }
    if ((page.viewportSize()?.width ?? 0) <= 600) {
      const discountedCard = visibleOrders.locator(".data-table-card").filter({
        hasText: "Jane Buyer",
      });
      await expect(discountedCard.getByText("Discount code", { exact: true })).toBeVisible();
      await expect(discountedCard.locator(".ticket-discount-code-pill")).toHaveText("SPRING10");
    }
    if ((page.viewportSize()?.width ?? 0) <= 600) {
      const viewport = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
    }
  });

  test("drills into confirmed discount redemptions and restores the normal list", async ({
    page,
  }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          orders: [
            adminOrder,
            refundedDiscountAdminOrder,
            pendingDiscountAdminOrder,
            secondPerformanceDiscountAdminOrder,
            sortableAdminOrder,
          ],
          requestId,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent, secondAdminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/discount-codes", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ codes: [redeemedAdminDiscountCode], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");
    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    const willCallSearch = page.getByRole("searchbox", { name: "Search", exact: true });
    await willCallSearch.fill("Pending Discount Buyer");
    await page.getByRole("tab", { name: "Discount Codes" }).click();

    const discountPanel = page.locator("#ticketing-discounts-panel");
    const redemptionButton = discountPanel.getByRole("button", {
      name: "View 3 redemptions for SPRING10",
    });
    await expect(redemptionButton).toBeVisible();
    await expect(redemptionButton.locator("..")).toContainText("/10");
    await redemptionButton.press("Enter");

    await expect(page.getByRole("tab", { name: "Concert Will Call" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByLabel("Select performance")).toHaveValue("all");
    await expect(willCallSearch).toHaveValue("");
    await expect(page.locator(".ticket-dashboard__active-filter")).toContainText(
      "Filtering by discount code: SPRING10",
    );
    await expect(page.getByRole("checkbox", { name: "Show refunded and expired" })).toBeChecked();

    const visibleOrders = page.locator(".data-table:visible, .data-table-cards:visible");
    await expect(visibleOrders.getByText("Jane Buyer", { exact: true })).toBeVisible();
    await expect(visibleOrders.getByText("Refunded Discount Buyer", { exact: true })).toBeVisible();
    await expect(visibleOrders.getByText("Winter Discount Buyer", { exact: true })).toBeVisible();
    await expect(visibleOrders.getByText("Pending Discount Buyer", { exact: true })).toHaveCount(0);
    await expect(visibleOrders.getByText("Alex Anderson", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Clear filter" }).click();
    await expect(page.locator(".ticket-dashboard__active-filter")).toHaveCount(0);
    await expect(
      page.getByRole("checkbox", { name: "Show refunded and expired" }),
    ).not.toBeChecked();
    await expect(visibleOrders.getByText("Refunded Discount Buyer", { exact: true })).toHaveCount(
      0,
    );
    await expect(visibleOrders.getByText("Pending Discount Buyer", { exact: true })).toBeVisible();
    await expect(visibleOrders.getByText("Alex Anderson", { exact: true })).toBeVisible();
  });

  test("shows a bundle pill beside bundle buyers without page overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const archivedBundleOrder = {
      ...sortableAdminOrder,
      bundleId: newBundleId,
      bundleTitle: "Archived Bundle",
      buyerEmail: "zara@example.test",
      buyerName: "Zara Anderson",
      createdAt: "2026-07-23T16:00:00.000Z",
    };
    const currentBundleOrder = {
      ...bundleAdminOrder,
      bundleTitle: "Former Season Pass title",
      buyerName: "Alex Zulu",
      createdAt: "2026-07-23T15:00:00.000Z",
    };
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          orders: [currentBundleOrder, archivedBundleOrder, adminOrder],
          requestId,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");
    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    await page.getByRole("tab", { name: "Bundle Orders" }).click();

    const bundleOrdersPanel = page.locator("#ticketing-orders-panel");
    const orderTable = bundleOrdersPanel.locator("table.data-table");
    await expect(orderTable).toBeVisible();
    await expect(orderTable.locator("thead th")).toHaveCount(8);
    await expect(orderTable.locator("thead th")).toHaveText([
      "Buyer ↕",
      "Email ↕",
      "Sale date ↓",
      "Bundle ↕",
      "Qty ↕",
      "Amount paid ↕",
      "Status ↕",
      "Actions",
    ]);
    for (const header of [
      "Buyer",
      "Email",
      "Sale date",
      "Bundle",
      "Qty",
      "Amount paid",
      "Status",
    ]) {
      await expect(orderTable.getByRole("button", { name: `Sort by ${header}` })).toBeVisible();
    }
    await expect(orderTable.getByRole("button", { name: "Sort by Actions" })).toHaveCount(0);

    const orderRows = orderTable.locator("tbody tr");
    await expect(orderRows).toHaveCount(2);
    await expect(orderRows.first().locator("td").first()).toContainText("Zara Anderson");
    await expect(orderTable.locator("thead th").nth(2)).toHaveAttribute("aria-sort", "descending");

    const bundleRow = orderRows.filter({ hasText: "Alex Zulu" });
    const archivedRow = orderRows.filter({ hasText: "Zara Anderson" });
    await expect(bundleRow.locator("td")).toHaveCount(8);
    await expect(bundleRow.locator("td").first()).toContainText("Alex Zulu");
    await expect(bundleRow.locator(".ticketing-bundle-order-pill")).toHaveText("Bundle");
    await expect(bundleRow.locator("td").nth(3)).toHaveText("Season Pass");
    await expect(archivedRow.locator("td").nth(3)).toHaveText("Archived Bundle");
    await expect(bundleRow.locator("td").nth(6)).toContainText("Paid (simulation)");
    await expect(archivedRow.locator("td").nth(6)).toContainText("pending (simulation)");

    await orderTable.getByRole("button", { name: "Sort by Buyer" }).click();
    await expect(orderTable.locator("thead th").first()).toHaveAttribute("aria-sort", "ascending");
    await expect(orderRows.first().locator("td").first()).toContainText("Zara Anderson");

    const bundleSortButton = orderTable.getByRole("button", { name: "Sort by Bundle" });
    await bundleSortButton.focus();
    await bundleSortButton.press("Enter");
    await expect(bundleSortButton).toBeFocused();
    await expect(orderTable.locator("thead th").nth(3)).toHaveAttribute("aria-sort", "ascending");
    await expect(orderRows.first().locator("td").nth(3)).toHaveText("Archived Bundle");

    await orderTable.getByRole("button", { name: "Sort by Status" }).click();
    await expect(orderRows.first().locator("td").nth(6)).toContainText("Paid (simulation)");

    const checkPageLayout = async () =>
      page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>("#ticketing-orders-panel");
        const scrollArea = panel?.querySelector<HTMLElement>(".table-scroll");
        if (!panel || !scrollArea) {
          throw new Error("Bundle orders layout is missing its panel or table scroll area.");
        }
        return {
          pageClientWidth: document.documentElement.clientWidth,
          pageScrollWidth: document.documentElement.scrollWidth,
          panelClientWidth: panel.clientWidth,
          scrollAreaClientWidth: scrollArea.clientWidth,
          scrollAreaOverflowX: getComputedStyle(scrollArea).overflowX,
        };
      });

    for (const viewport of [
      { height: 900, width: 1280 },
      { height: 844, width: 390 },
    ]) {
      await page.setViewportSize(viewport);
      const layout = await checkPageLayout();
      expect(layout.pageScrollWidth).toBeLessThanOrEqual(layout.pageClientWidth);
      expect(layout.scrollAreaClientWidth).toBeLessThanOrEqual(layout.panelClientWidth);
      expect(layout.scrollAreaOverflowX).toBe("auto");
    }

    await expect(bundleOrdersPanel.locator(".data-table-cards")).toBeVisible();
    const bundleCards = bundleOrdersPanel.locator(".data-table-card");
    await expect(bundleCards).toHaveCount(2);
    const currentBundleCard = bundleCards.filter({ hasText: "Alex Zulu" });
    await expect(currentBundleCard.locator(".data-table-card__field")).toHaveCount(8);
    await expect(currentBundleCard.locator(".ticketing-bundle-order-pill")).toHaveText("Bundle");
    await expect(currentBundleCard.getByRole("button", { name: "Resend" })).toBeVisible();
    await expect(currentBundleCard.getByRole("button", { name: "Refund" })).toBeVisible();
  });

  test("keeps bundle order resend and refund confirmation actions working", async ({ page }) => {
    let currentOrder = { ...bundleAdminOrder };
    let resendCalled = false;
    let refundCalled = false;

    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [currentOrder], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route(
      `**/api/organization/tickets/${bundleAdminOrder.id}/confirmation`,
      async (route) => {
        resendCalled = true;
        await route.fulfill({
          body: JSON.stringify({ status: "queued" }),
          contentType: "application/json",
          status: 200,
        });
      },
    );
    await page.route(`**/api/organization/tickets/${bundleAdminOrder.id}/refund`, async (route) => {
      refundCalled = true;
      currentOrder = { ...currentOrder, status: "refunded" };
      await route.fulfill({
        body: JSON.stringify(currentOrder),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");
    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    await page.getByRole("tab", { name: "Bundle Orders" }).click();

    const bundleOrdersPanel = page.locator("#ticketing-orders-panel");
    const visibleOrders = bundleOrdersPanel.locator(
      ".data-table:visible, .data-table-cards:visible",
    );
    await expect(visibleOrders.getByText("Paid (simulation)", { exact: true })).toBeVisible();

    const resendButton = visibleOrders.getByRole("button", { name: "Resend" });
    await resendButton.focus();
    await resendButton.press("Enter");
    await expect(page.getByText("Ticket confirmation queued.")).toBeVisible();
    expect(resendCalled).toBe(true);

    await visibleOrders.getByRole("button", { name: "Refund" }).click();
    const refundDialog = page.getByRole("dialog");
    await expect(refundDialog).toBeVisible();
    await expect(refundDialog.getByText("Refund bundle order?")).toBeVisible();
    await refundDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(refundDialog).not.toBeVisible();

    await visibleOrders.getByRole("button", { name: "Refund" }).click();
    await expect(refundDialog).toBeVisible();
    await refundDialog.getByRole("button", { name: "Refund order" }).click();

    await expect(page.getByText("Ticket order refunded.")).toBeVisible();
    await expect(visibleOrders.getByText("Refunded (simulation)", { exact: true })).toHaveCount(0);
    await bundleOrdersPanel.getByRole("checkbox", { name: "Show refunded" }).check();
    await expect(visibleOrders.getByText("Refunded (simulation)", { exact: true })).toBeVisible();
    expect(refundCalled).toBe(true);
  });

  test("auto-selects the performance closest to today in will call", async ({ page }) => {
    const nearEvent = {
      ...adminEvent,
      id: "33333333-3333-4333-8333-333333333333",
      startsAt: futureIsoDate({ days: 2 }),
      title: "Nearest Concert",
    };
    const farEvent = {
      ...adminEvent,
      id: "44444444-4444-4444-8444-444444444444",
      startsAt: futureIsoDate({ days: 90 }),
      title: "Singing the 70s",
    };

    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [farEvent, nearEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    const performanceSelect = page.getByLabel("Select performance");
    await expect(performanceSelect).toHaveValue(nearEvent.id);
    await expect(
      page.locator(".ticket-dashboard__metric--sold").getByText("Nearest Concert", { exact: true }),
    ).toBeVisible();
  });

  test("refunds a paid order via danger confirmation", async ({ page }) => {
    let currentOrder = { ...adminOrder };
    let refundCalled = false;

    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [currentOrder], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route(`**/api/organization/tickets/${purchaseId}/refund`, async (route) => {
      refundCalled = true;
      currentOrder = { ...currentOrder, status: "refunded" };
      await route.fulfill({
        body: JSON.stringify(currentOrder),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    const visibleOrders = page.locator(".data-table:visible, .data-table-cards:visible");
    await visibleOrders.getByRole("button", { name: "Refund" }).click({ force: true });
    const refundDialog = page.getByRole("dialog");
    await expect(refundDialog).toBeVisible();
    await expect(refundDialog.getByText("Refund ticket order?")).toBeVisible();
    await refundDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(refundDialog).not.toBeVisible();

    await visibleOrders.getByRole("button", { name: "Refund" }).click({ force: true });
    await expect(refundDialog).toBeVisible();
    await refundDialog.getByRole("button", { name: "Refund order" }).click();

    await expect(page.getByText("Ticket order refunded.")).toBeVisible();
    await expect(visibleOrders.getByText("Refunded (simulation)", { exact: true })).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Show refunded and expired" }).check();
    await expect(visibleOrders.getByText("Refunded (simulation)", { exact: true })).toBeVisible();
    expect(refundCalled).toBe(true);
  });

  test("resends ticket confirmation for a paid order", async ({ page }) => {
    let resendCalled = false;

    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [adminOrder], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route(`**/api/organization/tickets/${purchaseId}/confirmation`, async (route) => {
      resendCalled = true;
      await route.fulfill({
        body: JSON.stringify({ status: "queued" }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    await page.getByRole("button", { name: "Resend" }).click({ force: true });

    await expect(page.getByText("Ticket confirmation queued.")).toBeVisible();
    expect(resendCalled).toBe(true);
  });

  test("creates a new ticket bundle", async ({ page }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    let bundleSaved = false;
    const createdBundleId = newBundleId;
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      if (route.request().method() === "POST") {
        bundleSaved = true;
        await route.fulfill({
          body: JSON.stringify({
            capacity: 50,
            createdAt: "2026-07-24T00:00:00.000Z",
            eventIds: [eventId],
            id: createdBundleId,
            isActive: true,
            priceCents: 3000,
            saleEndAt: saleEndDate,
            title: "VIP Pass",
            updatedAt: "2026-07-24T00:00:00.000Z",
          }),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify({ bundles: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    await page.getByRole("tab", { name: "Season Bundles" }).click();
    await expect(page.getByText("New ticket bundle")).toBeVisible();
    await page.getByRole("button", { name: "New ticket bundle" }).click();

    await page.getByLabel("Bundle title").fill("VIP Pass");
    await page.getByLabel("Price (USD)").fill("30.00");
    await page.getByLabel("Capacity (blank is unlimited)").fill("50");
    await page.getByLabel("Sale ends").fill(saleEndInputValue);
    await page.getByLabel("Active for public sale").check();
    await page.getByRole("checkbox", { name: "Spring Concert" }).check();
    await page.getByRole("button", { name: "Save bundle" }).click();

    await expect(
      page.getByText("Ticket bundle saved. Publish the public website to make it visible."),
    ).toBeVisible();
    await expect(page.getByText("VIP Pass")).toBeVisible();
    expect(bundleSaved).toBe(true);
  });

  test("creates a discount code and clears its saved notice when leaving the tab", async ({
    page,
  }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    let savedBody: unknown = null;
    let discountCodeSaved = false;
    await page.route("**/api/organization/tickets/discount-codes", async (route) => {
      if (route.request().method() === "POST") {
        savedBody = route.request().postDataJSON();
        discountCodeSaved = true;
        await route.fulfill({
          body: JSON.stringify({ ...adminDiscountCode, requestId }),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify({ codes: discountCodeSaved ? [adminDiscountCode] : [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");
    await page.getByRole("tab", { name: "Discount Codes" }).click();
    await expect(page.getByText("No discount codes yet.")).toBeVisible();
    await page.getByRole("button", { name: "New discount code" }).click();
    const dialog = page.getByRole("dialog", { name: "New discount code" });
    await dialog.getByRole("textbox", { name: "Code" }).fill("SPRING10");
    await dialog.getByLabel("Eligible item").selectOption({ label: "Spring Concert" });
    await dialog.getByLabel("Percentage (1–100)").fill("10");
    await dialog.getByLabel("Redemption limit (blank is unlimited)").fill("10");
    await page.clock.install();
    await dialog.getByRole("button", { name: "Save discount code" }).click();

    await expect(page.getByText("Discount code saved.")).toBeVisible();
    await page.getByRole("tab", { name: "Season Bundles" }).click();
    await expect(page.getByText("Discount code saved.")).toHaveCount(0);
    await page.getByRole("tab", { name: "Discount Codes" }).click();
    await expect(page.getByText("Discount code saved.")).toHaveCount(0);
    const discountResults = page.locator(".data-table:visible, .data-table-cards:visible");
    await expect(discountResults.getByText("SPRING10", { exact: true }).first()).toBeVisible();
    await expect(discountResults.getByText("10%", { exact: true }).first()).toBeVisible();
    expect(savedBody).toMatchObject({
      code: "SPRING10",
      discountType: "percentage",
      discountValue: 10,
      eventId,
    });
  });

  test("edits an existing ticket bundle", async ({ page }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    let putReceived = false;
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route(`**/api/organization/tickets/bundles/${bundleId}`, async (route) => {
      if (route.request().method() === "PUT") {
        putReceived = true;
        await route.fulfill({
          body: JSON.stringify({
            ...adminBundle,
            priceCents: 3500,
            title: "Updated Season Pass",
            updatedAt: "2026-07-24T00:00:00.000Z",
          }),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    await page.getByRole("tab", { name: "Season Bundles" }).click();
    await expect(page.getByText("Season Pass")).toBeVisible();
    await page.getByRole("button", { name: "Edit" }).click({ force: true });

    await expect(page.getByRole("dialog", { name: "Edit ticket bundle" })).toBeVisible();
    await expect(page.getByLabel("Bundle title")).toHaveValue("Season Pass");
    await expect(page.getByLabel("Price (USD)")).toHaveValue("25.00");

    await page.getByLabel("Bundle title").fill("Updated Season Pass");
    await page.getByLabel("Price (USD)").fill("35.00");
    await page.getByRole("button", { name: "Save bundle" }).click();

    await expect(
      page.getByText("Ticket bundle saved. Publish the public website to make it visible."),
    ).toBeVisible();
    await expect(page.getByText("Updated Season Pass")).toBeVisible();
    await expect(page.getByText("$35.00")).toBeVisible();
    expect(putReceived).toBe(true);
  });

  test("deletes a ticket bundle", async ({ page }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    let deleteCalled = false;
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route(`**/api/organization/tickets/bundles/${bundleId}`, async (route) => {
      if (route.request().method() === "DELETE") {
        deleteCalled = true;
      }
      await route.fulfill({ status: 200 });
    });

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    await page.getByRole("tab", { name: "Season Bundles" }).click();
    await expect(page.getByText("Season Pass")).toBeVisible();
    await page.getByRole("button", { name: "Delete" }).click({ force: true });

    await expect(page.getByText("Ticket bundle deleted.")).toBeVisible();
    await expect(page.getByText("Season Pass")).not.toBeVisible();
    expect(deleteCalled).toBe(true);
  });

  test("validates a ticket scan at the door", async ({ page }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    let scanBody: unknown = null;
    await page.route("**/api/organization/tickets/scan", async (route) => {
      scanBody = route.request().postDataJSON();
      await route.fulfill({
        body: JSON.stringify({
          buyerName: "Jane Buyer",
          eventId,
          eventStartsAt: futureDate,
          eventTitle: "Spring Concert",
          purchaseId,
          quantity: 1,
          requestId,
          valid: true,
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets/scan");

    await expect(page.getByRole("heading", { name: "Scan tickets" })).toBeVisible();

    await page.getByRole("combobox", { name: "Performance" }).selectOption(eventId);
    await page.getByLabel("Ticket credential").fill(scanToken);
    await page.getByRole("button", { name: "Validate ticket" }).click();

    await expect(page.getByText("Valid: Jane Buyer, 1 ticket.")).toBeVisible();
    expect(scanBody).toBeTruthy();
    expect(
      typeof scanBody === "object" &&
        scanBody !== null &&
        "token" in scanBody &&
        scanBody.token === scanToken,
    ).toBe(true);
  });

  test("shows empty state when no ticket orders exist", async ({ page }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");

    await expect(page.getByRole("heading", { name: "Ticketing" })).toBeVisible();
    await expect(page.getByText("No ticket orders yet.")).toBeVisible();
    await page.getByRole("tab", { name: "Season Bundles" }).click();
    await expect(page.getByText("No bundles yet.")).toBeVisible();
  });

  test("reactivates an inactive discount code and aligns redemption count geometry", async ({
    page,
  }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ orders: [], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    const inactiveRedeemedCode = {
      ...adminDiscountCode,
      active: false,
      code: "INACTIVE10",
      deactivatedAt: "2026-07-20T00:00:00.000Z",
      editable: false,
      id: "b5cba6a0-6c8f-44a8-8c6e-20a1b1c6b3a1",
      redemptionCount: 1,
      redemptionLimit: 10,
    };
    const activeZeroCode = {
      ...adminDiscountCode,
      active: true,
      code: "ZEROCODE",
      editable: true,
      id: "c6dba6a0-6c8f-44a8-8c6e-20a1b1c6b3a2",
      redemptionCount: 0,
      redemptionLimit: 10,
    };

    let codes = [inactiveRedeemedCode, activeZeroCode];
    await page.route("**/api/organization/tickets/discount-codes", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ codes, requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    let reactivateCalled = false;
    await page.route(
      `**/api/organization/tickets/discount-codes/${inactiveRedeemedCode.id}/reactivate`,
      async (route) => {
        reactivateCalled = true;
        const reactivated = {
          ...inactiveRedeemedCode,
          active: true,
          deactivatedAt: null,
        };
        codes = codes.map((c) => (c.id === reactivated.id ? reactivated : c));
        await route.fulfill({
          body: JSON.stringify({ ...reactivated, requestId }),
          contentType: "application/json",
          status: 200,
        });
      },
    );

    await page.goto("/admin/tickets");
    await page.getByRole("tab", { name: "Discount Codes" }).click();

    const discountPanel = page.locator("#ticketing-discounts-panel");
    const visibleDiscounts = discountPanel.locator(
      ".data-table:visible, .data-table-cards:visible",
    );
    await expect(visibleDiscounts.getByText("INACTIVE10", { exact: true }).first()).toBeVisible();
    await expect(visibleDiscounts.getByText("ZEROCODE", { exact: true }).first()).toBeVisible();

    // Verify row actions
    const discountRows = visibleDiscounts.locator("tbody tr, .data-table-card");
    const rowInactive = discountRows.filter({ hasText: "INACTIVE10" });
    const rowZero = discountRows.filter({ hasText: "ZEROCODE" });

    // Redeemed inactive code has Reactivate, but no Edit
    await expect(rowInactive.getByRole("button", { name: "Reactivate" })).toBeVisible();
    await expect(rowInactive.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(rowInactive.getByRole("button", { name: "Deactivate" })).toHaveCount(0);

    // Unused active code has Edit and Deactivate, but no Reactivate
    await expect(rowZero.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(rowZero.getByRole("button", { name: "Deactivate" })).toBeVisible();
    await expect(rowZero.getByRole("button", { name: "Reactivate" })).toHaveCount(0);

    // Alignment geometry regression assertion: on desktop table, compare left edge of displayed count for 1 row and 0 row
    const desktopTable = discountPanel.locator("table.data-table");
    if (await desktopTable.isVisible()) {
      const desktopRowInactive = desktopTable.locator("tbody tr").filter({ hasText: "INACTIVE10" });
      const desktopRowZero = desktopTable.locator("tbody tr").filter({ hasText: "ZEROCODE" });
      const triggerBox = await desktopRowInactive
        .locator(".discount-redemptions-trigger")
        .boundingBox();
      const zeroBox = await desktopRowZero.locator(".discount-redemptions-zero").boundingBox();
      expect(triggerBox).toBeTruthy();
      expect(zeroBox).toBeTruthy();
      if (triggerBox && zeroBox) {
        expect(Math.abs(triggerBox.x - zeroBox.x)).toBeLessThanOrEqual(1.5);
      }
    }

    // Click Reactivate on INACTIVE10
    await rowInactive.getByRole("button", { name: "Reactivate" }).click();

    // Verify notice and updated state
    await expect(page.getByText("Discount code reactivated.")).toBeVisible();
    expect(reactivateCalled).toBe(true);
    // Dialog must NOT be opened
    await expect(page.getByRole("dialog", { name: "Edit discount code" })).toHaveCount(0);

    // Status is now Active and Reactivate is replaced by Deactivate
    await expect(rowInactive.getByText("Active", { exact: true })).toBeVisible();
    await expect(rowInactive.getByRole("button", { name: "Deactivate" })).toBeVisible();
    await expect(rowInactive.getByRole("button", { name: "Reactivate" })).toHaveCount(0);
    // Edit remains suppressed because terms are still locked
    await expect(rowInactive.getByRole("button", { name: "Edit" })).toHaveCount(0);
  });

  test("guides admins from ticketing setup guide to events and provides edit ticket settings shortcut", async ({
    page,
  }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          orders: [adminOrder],
          requestId,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/venues", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          requestId,
          venues: [
            {
              address: "1 Hall Way",
              createdAt: "2026-01-01T00:00:00.000Z",
              id: adminEvent.venueId,
              name: "City Concert Hall",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/calendar-settings", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ requestId, timezone: "America/New_York" }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/roster-configuration", async (route) => {
      await route.fulfill({
        body: JSON.stringify(buildRosterConfigurationResponse()),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/tickets");

    // 1. Verify Ticketing Setup Guide is rendered above tabs
    const setupGuide = page.locator(".ticketing-setup-guide");
    await expect(setupGuide).toBeVisible();
    await expect(setupGuide.getByText("Want to sell tickets for a concert?")).toBeVisible();
    const setupGuideLink = setupGuide.getByRole("link", { name: "Set Up Ticket Sales →" });
    await expect(setupGuideLink).toBeVisible();
    await expect(setupGuideLink).toHaveAttribute(
      "href",
      "/admin/events?type=Performance&returnTo=%2Fadmin%2Ftickets",
    );
    await setupGuideLink.click();
    await expect(page).toHaveURL("/admin/events?type=Performance&returnTo=%2Fadmin%2Ftickets");
    const returnToTicketingLink = page.getByRole("link", { name: "← Back to Ticketing" });
    await expect(returnToTicketingLink).toBeVisible();
    await returnToTicketingLink.click();
    await expect(page).toHaveURL("/admin/tickets");

    // 2. Will Call shortcut: by default, the first performance (Spring Concert) is selected
    const editSettingsButton = page.getByRole("link", { name: "Edit ticket settings →" });
    await expect(editSettingsButton).toBeVisible();
    await expect(editSettingsButton).toHaveAttribute(
      "href",
      `/admin/events?eventId=${eventId}&section=tickets&returnTo=%2Fadmin%2Ftickets%3FeventId%3D${eventId}`,
    );

    // 3. When 'All ticketed performances' is selected, the shortcut is hidden
    await page.getByLabel("Select performance").selectOption("all");
    await expect(editSettingsButton).toHaveCount(0);

    // 4. Select the performance again and click 'Edit ticket settings →'
    await page.getByLabel("Select performance").selectOption(eventId);
    await expect(editSettingsButton).toBeVisible();
    await editSettingsButton.click();

    // 5. Verify we are on /admin/events, EventEditorDialog is opened for this event,
    // Ticket Sales section is present and capacity field is focused
    await expect(page).toHaveURL(
      new RegExp(`/admin/events\\?eventId=${eventId}&section=tickets&returnTo=`),
    );
    const eventEditor = page.getByRole("dialog", { name: "Edit event" });
    await expect(eventEditor).toBeVisible();
    const ticketSalesSection = eventEditor.locator("#event-editor-section-tickets");
    await expect(ticketSalesSection).toBeVisible();
    await expect(eventEditor.getByRole("heading", { name: /Ticket sales/i })).toBeVisible();
    await expect(eventEditor.locator("#events-page-capacity")).toBeFocused();

    // 6. Verify 'Back to Ticketing' button is visible when dialog is not dirty
    const backToTicketingButton = eventEditor.getByRole("button", { name: "Back to Ticketing" });
    await expect(backToTicketingButton).toBeVisible();

    // 7. Click 'Back to Ticketing' and verify we return to /admin/tickets?eventId=... with the performance still selected
    await backToTicketingButton.click();
    await expect(eventEditor).not.toBeVisible();
    await expect(page).toHaveURL(`/admin/tickets?eventId=${eventId}`);
    await expect(page.getByLabel("Select performance")).toHaveValue(eventId);
  });

  test("returns to ticketing with selection restored after saving ticket settings", async ({
    page,
  }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          orders: [adminOrder],
          requestId,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/venues", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          requestId,
          venues: [
            {
              address: "1 Hall Way",
              createdAt: "2026-01-01T00:00:00.000Z",
              id: adminEvent.venueId,
              name: "City Concert Hall",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/calendar-settings", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ requestId, timezone: "America/New_York" }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/roster-configuration", async (route) => {
      await route.fulfill({
        body: JSON.stringify(buildRosterConfigurationResponse()),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route(`**/api/organization/events/${eventId}`, async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          body: JSON.stringify({ ...adminEvent, ticketCapacity: 250 }),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      await route.fallback();
    });

    await page.goto("/admin/tickets");
    await page.getByRole("link", { name: "Edit ticket settings →" }).click();

    const eventEditor = page.getByRole("dialog", { name: "Edit event" });
    await expect(eventEditor).toBeVisible();

    await eventEditor.locator("#events-page-capacity").fill("250");
    await selectEventEditorSection(eventEditor, "rsvp");
    await eventEditor.locator("#events-page-rsvp-deadline").fill(futureDateString({ days: 280 }));
    await selectEventEditorSection(eventEditor, "tickets");
    await eventEditor.getByRole("button", { name: "Save event" }).click();

    await expect(eventEditor).not.toBeVisible();
    await expect(page).toHaveURL(`/admin/tickets?eventId=${eventId}`);
    await expect(page.getByLabel("Select performance")).toHaveValue(eventId);
  });

  test("handles invalid deep-link event IDs and unticketed return selections safely", async ({
    page,
  }) => {
    await routeHealth(page);
    await routeAdminAuth(page);
    await page.route("**/api/public/projection", async (route) => {
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/organization/tickets/orders", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          orders: [adminOrder],
          requestId,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/events", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ events: [adminEvent], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/venues", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ requestId, venues: [] }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/calendar-settings", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ requestId, timezone: "America/New_York" }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/roster-configuration", async (route) => {
      await route.fulfill({
        body: JSON.stringify(buildRosterConfigurationResponse()),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/organization/tickets/bundles", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ bundles: [adminBundle], requestId }),
        contentType: "application/json",
        status: 200,
      });
    });

    // Unknown event ID: recoverable error, no dialog opens for a different event.
    await page.goto(
      "/admin/events?eventId=00000000-0000-4000-8000-000000000000&section=tickets&returnTo=%2Fadmin%2Ftickets",
    );
    await expect(page.getByRole("alert")).toContainText("could not be found");
    await expect(page.getByRole("dialog", { name: "Edit event" })).toHaveCount(0);
    const backLink = page.getByRole("link", { name: "← Back to Ticketing" });
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL("/admin/tickets");

    // Return selection for a no-longer-ticketed event: coherent fallback with notice.
    await page.goto(`/admin/tickets?eventId=${secondPerformanceId}`);
    await expect(page.getByLabel("Select performance")).toHaveValue("all");
    await expect(page.getByText("does not have ticketing enabled")).toBeVisible();
  });
});
