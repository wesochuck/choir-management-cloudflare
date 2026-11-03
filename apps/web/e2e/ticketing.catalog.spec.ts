import { futureDateString } from "@choir/testkit";
import { expect, test } from "@playwright/test";
import { buildRosterConfigurationResponse } from "./fixtures/builders";
import { selectEventEditorSection } from "./support/eventEditor";
import {
  adminBundle,
  adminDiscountCode,
  adminEvent,
  adminOrder,
  bundleId,
  eventId,
  newBundleId,
  requestId,
  routeAdminAuth,
  routeHealth,
  saleEndDate,
  saleEndInputValue,
  secondPerformanceId,
} from "./support/ticketingFixtures";

test.describe("admin ticket management", () => {
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
    await page.getByLabel("Sale ends").blur();
    await page.getByRole("button", { name: "Keep time", exact: true }).click();
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
    const bundle = page.getByRole("article", { name: "Season Pass", exact: true });
    await expect(bundle).toBeVisible();
    await bundle.getByRole("button", { name: "Delete Season Pass", exact: true }).click();

    const confirmation = page.getByRole("dialog", { name: "Delete Season Pass?", exact: true });
    await expect(confirmation).toBeVisible();
    expect(deleteCalled).toBe(false);
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(bundle).toBeVisible();
    expect(deleteCalled).toBe(false);

    await bundle.getByRole("button", { name: "Delete Season Pass", exact: true }).click();
    await confirmation.getByRole("button", { name: "Delete bundle", exact: true }).click();

    await expect(page.getByText("Ticket bundle deleted.")).toBeVisible();
    await expect(bundle).not.toBeVisible();
    expect(deleteCalled).toBe(true);
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
    const bundles = page.getByRole("tabpanel", { name: "Season Bundles", exact: true });
    await expect(bundles.getByRole("heading", { name: "Your season starts here" })).toBeVisible();
    await expect(bundles.getByRole("button", { name: "New ticket bundle" })).toBeEnabled();
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
