import { expect, test } from "@playwright/test";
import {
  adminBundle,
  adminEvent,
  adminOrder,
  bundleAdminOrder,
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
  scanToken,
  secondAdminEvent,
  secondPerformanceDiscountAdminOrder,
  sortableAdminOrder,
} from "./support/ticketingFixtures";

test.describe("admin ticket management", () => {
  test("lists orders with buyer, performance, quantity, total, and status", async ({
    page,
  }, testInfo) => {
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

    const heading = page.locator(".page-heading--ticketing");
    const scanLink = heading.getByRole("link", { name: "Scan tickets", exact: true });
    await expect(scanLink).toBeVisible();
    const textBox = await heading.locator(":scope > div").boundingBox();
    const scanBox = await scanLink.boundingBox();
    if (!textBox || !scanBox) throw new Error("Ticketing heading is missing");
    expect(scanBox.x).toBeGreaterThanOrEqual(textBox.x + textBox.width);
    expect(scanBox.y + scanBox.height / 2).toBeGreaterThanOrEqual(textBox.y);
    expect(scanBox.y + scanBox.height / 2).toBeLessThanOrEqual(textBox.y + textBox.height);
    await heading.screenshot({ path: testInfo.outputPath("ticketing-heading.png") });

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
    const discountedOrderDisclosure = visibleOrders.getByRole("button", {
      name: "Show details for Jane Buyer",
    });
    await expect(discountedOrderDisclosure).toHaveAttribute("aria-expanded", "false");
    await discountedOrderDisclosure.click();
    const expandedOrderDisclosure = visibleOrders.getByRole("button", {
      name: "Hide details for Jane Buyer",
    });
    const discountedOrderDetails = visibleOrders.locator(".ticket-sales-details");
    await expect(expandedOrderDisclosure).toHaveAttribute("aria-expanded", "true");
    await expect(discountedOrderDetails.getByText("Full email", { exact: true })).toBeVisible();
    await expect(
      discountedOrderDetails.getByText("jane@example.test", { exact: true }),
    ).toBeVisible();
    await expect(discountedOrderDetails.getByText("Discount code", { exact: true })).toBeVisible();
    await expect(discountedOrderDetails).toContainText("SPRING10");
    await expandedOrderDisclosure.click();
    await expect(discountedOrderDisclosure).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("status")).toContainText("Updates automatically every 5 seconds.");
    await expect(
      page.locator(".ticket-dashboard__metric--sold").getByText("Spring Concert", { exact: true }),
    ).toBeVisible();
    await expect(visibleOrders.getByText("$15.74", { exact: true }).first()).toBeVisible();
    await expect(
      visibleOrders.getByText("Paid (simulation)", { exact: true }).first(),
    ).toBeVisible();

    const orderRows = visibleOrders.locator(
      "tbody > tr:not(.data-table__expanded-row), .data-table-card",
    );
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
    await bundleRow.getByRole("button", { name: "Show details for Bundle Buyer" }).click();
    const bundleDetails = visibleOrders.locator(".ticket-sales-details");
    await expect(bundleDetails.locator("dt").filter({ hasText: "Bundle" })).toBeVisible();
    await expect(bundleDetails).toContainText("Season Pass");
    await visibleOrders.getByRole("button", { name: "Hide details for Bundle Buyer" }).click();
    const standaloneRow = orderRows.filter({ hasText: "Jane Buyer" });
    await expect(standaloneRow.locator(".ticketing-bundle-order-pill")).toHaveCount(0);
    await expect(visibleOrders.locator(".ticket-sales-details")).toHaveCount(0);
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
      await discountedCard.getByRole("button", { name: "Show details for Jane Buyer" }).click();
      const discountedCardDetails = visibleOrders.locator(".ticket-sales-details");
      await expect(discountedCardDetails.getByText("Discount code", { exact: true })).toBeVisible();
      await expect(discountedCardDetails).toContainText("SPRING10");
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
    await page.route("**/api/organization/ticket-confirmation-settings", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          pendingMessage: "Your order is pending.",
          qrCodeInstructions: "Show this code at the door.",
          requestId,
          successMessage: "Your order is confirmed.",
          willCallInstructions: "Pick up tickets at will call.",
        }),
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

  test("shows compact expandable bundle orders without pills or page overflow", async ({
    page,
  }) => {
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
      "Order details",
      "Buyer name ↕",
      "Email ↕",
      "Sale date ↓",
      "Qty ↕",
      "Amount paid ↕",
      "Status ↕",
      "Actions",
    ]);
    for (const header of ["Buyer name", "Email", "Sale date", "Qty", "Amount paid", "Status"]) {
      await expect(orderTable.getByRole("button", { name: `Sort by ${header}` })).toBeVisible();
    }
    await expect(orderTable.getByRole("button", { name: "Sort by Actions" })).toHaveCount(0);

    const orderRows = orderTable.locator("tbody tr");
    await expect(orderRows).toHaveCount(2);
    await expect(orderRows.first().locator("td").nth(1)).toContainText("Zara Anderson");
    await expect(orderTable.locator("thead th").nth(3)).toHaveAttribute("aria-sort", "descending");

    const bundleRow = orderRows.filter({ hasText: "Alex Zulu" });
    const archivedRow = orderRows.filter({ hasText: "Zara Anderson" });
    await expect(bundleRow.locator("td")).toHaveCount(8);
    await expect(bundleRow.locator("td").nth(1)).toContainText("Alex Zulu");
    await expect(bundleRow.locator(".ticketing-bundle-order-pill")).toHaveCount(0);
    await bundleRow.getByRole("button", { name: "Show details for Alex Zulu" }).click();
    await expect(orderTable.getByText("Season Pass", { exact: true })).toBeVisible();
    await bundleRow.getByRole("button", { name: "Hide details for Alex Zulu" }).click();
    await expect(bundleRow.locator("td").nth(6)).toContainText("Paid (simulation)");
    await expect(archivedRow.locator("td").nth(6)).toContainText("pending (simulation)");

    await orderTable.getByRole("button", { name: "Sort by Buyer name" }).click();
    await expect(orderTable.locator("thead th").nth(1)).toHaveAttribute("aria-sort", "ascending");
    await expect(orderRows.first().locator("td").nth(1)).toContainText("Zara Anderson");

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
    await expect(currentBundleCard.locator(".ticketing-bundle-order-pill")).toHaveCount(0);
    await currentBundleCard.getByRole("button", { name: "Show details for Alex Zulu" }).click();
    await expect(currentBundleCard.getByRole("button", { name: "Resend" })).toBeVisible();
    await expect(
      bundleOrdersPanel
        .locator(".data-table-cards")
        .getByRole("button", { name: "Refund order", exact: true }),
    ).toBeVisible();
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

    await visibleOrders.getByRole("button", { name: /^Show details for/ }).click();
    await visibleOrders.getByRole("button", { name: "Refund order", exact: true }).click();
    const refundDialog = page.getByRole("dialog");
    await expect(refundDialog).toBeVisible();
    await expect(refundDialog.getByText("Refund bundle order?")).toBeVisible();
    await refundDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(refundDialog).not.toBeVisible();

    await visibleOrders.getByRole("button", { name: "Refund order", exact: true }).click();
    await expect(refundDialog).toBeVisible();
    await refundDialog.getByRole("button", { name: "Refund order" }).click();

    await expect(page.getByText("Ticket order refunded.")).toBeVisible();
    await expect(visibleOrders.getByText("Refunded (simulation)", { exact: true })).toHaveCount(0);
    await bundleOrdersPanel.getByRole("checkbox", { name: "Show refunded" }).check();
    await expect(
      visibleOrders.locator(".status-pill").filter({ hasText: "Refunded (simulation)" }),
    ).toBeVisible();
    expect(refundCalled).toBe(true);
  });

  test("auto-selects today through local midnight and shows event artwork", async ({
    page,
  }, testInfo) => {
    await page.clock.setFixedTime(new Date("2026-09-21T03:59:00Z"));
    await page.route("**/api/organization/calendar-settings", (route) =>
      route.fulfill({ json: { timezone: "America/New_York", requestId } }),
    );
    await page.route("**/api/organization/files/55555555-5555-4555-8555-555555555555", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160"><rect width="120" height="160" fill="#203b60"/><text x="15" y="80" fill="white">Concert</text></svg>',
      }),
    );
    const nearEvent = {
      ...adminEvent,
      id: "33333333-3333-4333-8333-333333333333",
      startsAt: "2026-09-20T23:00:00Z",
      publicGraphicFileId: "55555555-5555-4555-8555-555555555555",
      title: "Nearest Concert",
    };
    const farEvent = {
      ...adminEvent,
      id: "44444444-4444-4444-8444-444444444444",
      startsAt: "2026-09-21T05:00:00Z",
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
    const artwork = page.getByRole("img", { name: "Event artwork for Nearest Concert" });
    await expect(artwork).toBeVisible();
    await expect(artwork).toHaveJSProperty("naturalWidth", 120);
    for (const theme of ["light", "dark"]) {
      const themeButton = page.getByRole("button", { name: `Switch to ${theme} theme` });
      if (await themeButton.count()) await themeButton.click();
      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath(`performance-summary-${theme}.png`),
      });
    }

    await expect(
      page.locator(".ticket-dashboard__metric--sold").getByText("Nearest Concert", { exact: true }),
    ).toBeVisible();
    const selectBox = await performanceSelect.boundingBox();
    expect(selectBox?.height).toBeLessThan(80);
    await page.clock.setFixedTime(new Date("2026-09-21T04:00:00Z"));
    await page.reload();
    await expect(performanceSelect).toHaveValue(farEvent.id);
    await expect(page.getByRole("img", { name: "Event artwork for Nearest Concert" })).toHaveCount(
      0,
    );
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
    await visibleOrders.getByRole("button", { name: "Show details for Jane Buyer" }).click();
    const orderDetails = visibleOrders.locator(".ticket-sales-details");
    await orderDetails.getByRole("button", { name: "Refund order" }).click();
    const refundDialog = page.getByRole("dialog");
    await expect(refundDialog).toBeVisible();
    await expect(refundDialog.getByText("Refund ticket order?")).toBeVisible();
    await refundDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(refundDialog).not.toBeVisible();

    await orderDetails.getByRole("button", { name: "Refund order" }).click();
    await expect(refundDialog).toBeVisible();
    await refundDialog.getByRole("button", { name: "Refund order" }).click();

    await expect(page.getByText("Ticket order refunded.")).toBeVisible();
    await expect(visibleOrders.getByText("Refunded (simulation)", { exact: true })).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Show refunded and expired" }).check();
    await expect(
      visibleOrders.locator(".ticket-sales-table__status").getByText("Refunded (simulation)", {
        exact: true,
      }),
    ).toBeVisible();
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

  test("aligns KPI value baselines and secondary copy across desktop, tablet, and mobile breakpoints", async ({
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

    // 1. Desktop: all 6 cards on one visual row
    await page.setViewportSize({ width: 1280, height: 800 });
    const strongLocators = page.locator(".ticket-dashboard__metric strong");
    await expect(strongLocators).toHaveCount(6);

    const desktopStrongTops = await strongLocators.evaluateAll((elements) =>
      elements.map((el) => Math.round(el.getBoundingClientRect().top)),
    );
    const desktopSmallTops = await page
      .locator(".ticket-dashboard__metric small")
      .evaluateAll((elements) => elements.map((el) => Math.round(el.getBoundingClientRect().top)));

    // All 6 strong and small tops must align within <= 2 CSS pixels
    expect(Math.max(...desktopStrongTops) - Math.min(...desktopStrongTops)).toBeLessThanOrEqual(2);
    expect(Math.max(...desktopSmallTops) - Math.min(...desktopSmallTops)).toBeLessThanOrEqual(2);

    // 2. Tablet: 3 cards per row (width <= 64rem = 1024px)
    await page.setViewportSize({ width: 900, height: 800 });
    const tabletStrongTops = await strongLocators.evaluateAll((elements) =>
      elements.map((el) => Math.round(el.getBoundingClientRect().top)),
    );
    const tabletSmallTops = await page
      .locator(".ticket-dashboard__metric small")
      .evaluateAll((elements) => elements.map((el) => Math.round(el.getBoundingClientRect().top)));

    // Row 1 (cards 0, 1, 2)
    const tabletRow1Strong = tabletStrongTops.slice(0, 3);
    const tabletRow1Small = tabletSmallTops.slice(0, 3);
    expect(Math.max(...tabletRow1Strong) - Math.min(...tabletRow1Strong)).toBeLessThanOrEqual(2);
    expect(Math.max(...tabletRow1Small) - Math.min(...tabletRow1Small)).toBeLessThanOrEqual(2);

    // Row 2 (cards 3, 4, 5)
    const tabletRow2Strong = tabletStrongTops.slice(3, 6);
    const tabletRow2Small = tabletSmallTops.slice(3, 6);
    expect(Math.max(...tabletRow2Strong) - Math.min(...tabletRow2Strong)).toBeLessThanOrEqual(2);
    expect(Math.max(...tabletRow2Small) - Math.min(...tabletRow2Small)).toBeLessThanOrEqual(2);

    // 3. Mobile: 2 cards per row (width <= 40rem = 640px)
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileStrongTops = await strongLocators.evaluateAll((elements) =>
      elements.map((el) => Math.round(el.getBoundingClientRect().top)),
    );
    const mobileSmallTops = await page
      .locator(".ticket-dashboard__metric small")
      .evaluateAll((elements) => elements.map((el) => Math.round(el.getBoundingClientRect().top)));

    // Row 1 (cards 0, 1)
    const mobileRow1Strong = mobileStrongTops.slice(0, 2);
    const mobileRow1Small = mobileSmallTops.slice(0, 2);
    expect(Math.max(...mobileRow1Strong) - Math.min(...mobileRow1Strong)).toBeLessThanOrEqual(2);
    expect(Math.max(...mobileRow1Small) - Math.min(...mobileRow1Small)).toBeLessThanOrEqual(2);

    // Row 2 (cards 2, 3)
    const mobileRow2Strong = mobileStrongTops.slice(2, 4);
    const mobileRow2Small = mobileSmallTops.slice(2, 4);
    expect(Math.max(...mobileRow2Strong) - Math.min(...mobileRow2Strong)).toBeLessThanOrEqual(2);
    expect(Math.max(...mobileRow2Small) - Math.min(...mobileRow2Small)).toBeLessThanOrEqual(2);

    // Row 3 (cards 4, 5)
    const mobileRow3Strong = mobileStrongTops.slice(4, 6);
    const mobileRow3Small = mobileSmallTops.slice(4, 6);
    expect(Math.max(...mobileRow3Strong) - Math.min(...mobileRow3Strong)).toBeLessThanOrEqual(2);
    expect(Math.max(...mobileRow3Small) - Math.min(...mobileRow3Small)).toBeLessThanOrEqual(2);

    // 4. Large font/zoom at 1280px desktop width: no overflow or clipped content
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "150%";
    });
    const zoomedStrongTops = await strongLocators.evaluateAll((elements) =>
      elements.map((el) => Math.round(el.getBoundingClientRect().top)),
    );
    expect(Math.max(...zoomedStrongTops) - Math.min(...zoomedStrongTops)).toBeLessThanOrEqual(3);
  });
});
