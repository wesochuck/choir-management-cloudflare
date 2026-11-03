import { test, expect } from "@playwright/test";
import { mockHealth } from "./support/testWorld";
import { publicDonationProjection } from "./support/donationFixtures";
const id = "11111111-1111-4111-8111-111111111111";
for (const theme of ["light", "dark"] as const) {
  test(`checkout reminder opt-out requires confirmation in ${theme}`, async ({ page }) => {
    await mockHealth(page);
    await page.emulateMedia({ colorScheme: theme });
    let stops = 0;
    await page.route("**/api/public/projection*", (route) =>
      route.fulfill({ json: publicDonationProjection }),
    );
    await page.route("**/api/public/checkout-reminders/stop", (route) => {
      stops += 1;
      return route.fulfill({ json: { success: true } });
    });
    await page.goto("/checkout/reminders/stop?token=sample-private-credential");
    await expect(page.getByRole("heading", { name: "Stop checkout reminders" })).toBeVisible();
    expect(stops).toBe(0);
    await page.reload();
    expect(stops).toBe(0);
    await page.getByRole("button", { name: "Stop these reminders" }).click();
    await expect(page.getByRole("status")).toContainText("no longer receive");
    expect(stops).toBe(1);
    expect(new URL(page.url()).searchParams.get("token")).toBe("sample-private-credential");
  });
  test(`donation recovery restores email and current options in ${theme}`, async ({ page }) => {
    await mockHealth(page);
    await page.emulateMedia({ colorScheme: theme });
    await page.route("**/api/public/projection*", (route) =>
      route.fulfill({ json: publicDonationProjection }),
    );
    await page.route("**/api/public/checkout-reminders/recovery*", (route) =>
      route.fulfill({
        json: {
          kind: "donation",
          resourceId: id,
          bundleId: null,
          email: "donor@example.org",
          eventIds: [],
          quantity: null,
          amountCents: 5000,
          levelId: "supporter",
          discountCode: null,
        },
      }),
    );
    await page.route("**/api/public/donation-settings*", (route) =>
      route.fulfill({
        json: {
          requestId: id,
          buttonText: "Support our Music",
          description: "Support our choir.",
          thankYouMessage: "Thank you.",
          levels: [
            {
              id: "supporter",
              label: "Supporter",
              amountCents: 6000,
              benefit: "Supports our music",
            },
          ],
        },
      }),
    );
    await page.route("**/api/public/transaction-fee-settings*", (route) =>
      route.fulfill({
        json: { requestId: id, fixedCents: 0, percentage: 0, passFeeToDonor: false },
      }),
    );
    let checkouts = 0;
    await page.route("**/api/public/donations/checkout", (route) => {
      checkouts += 1;
      return route.fulfill({
        status: 503,
        json: { code: "test_stop", message: "Test checkout", requestId: id },
      });
    });
    await page.goto("/checkout/return?token=sample-private-credential");
    await expect(
      page.getByRole("heading", { name: "Review your unfinished checkout" }),
    ).toBeVisible();
    await expect(page.locator('input[type="email"]').first()).toHaveValue("donor@example.org");
    await expect(page.getByRole("button", { name: "Complete donation" })).toBeVisible();
    expect(checkouts).toBe(0);
    await page.reload();
    await expect(page.locator('input[type="email"]').first()).toHaveValue("donor@example.org");
    expect(checkouts).toBe(0);
    expect(new URL(page.url()).searchParams.get("token")).toBe("sample-private-credential");
  });
}

for (const kind of ["ticket", "bundle"] as const) {
  test(`ticket recovery restores ${kind} choices without creating payment`, async ({ page }) => {
    const fixtures = await import("./support/ticketingFixtures");
    await fixtures.routePublicBasics(page);
    await page.route("**/api/public/commerce-projection*", (route) =>
      route.fulfill({ json: fixtures.ticketingProjection }),
    );
    await page.route("**/api/public/checkout-reminders/recovery*", (route) =>
      route.fulfill({
        json: {
          kind: "ticket",
          resourceId: fixtures.purchaseId,
          bundleId: kind === "bundle" ? fixtures.bundleId : null,
          email: "buyer@example.org",
          eventIds: [fixtures.eventId],
          quantity: 2,
          amountCents: 1,
          levelId: null,
          discountCode: "OLD-CODE",
        },
      }),
    );
    await page.route("**/api/public/transaction-fee-settings*", (route) =>
      route.fulfill({
        json: { requestId: id, fixedCents: 0, percentage: 0, passFeeToDonor: false },
      }),
    );
    await page.route("**/api/public/tickets/discount-availability*", (route) =>
      route.fulfill({ json: { requestId: id, hasRedeemableCode: false } }),
    );
    let checkouts = 0;
    await page.route("**/api/public/tickets/checkout", (route) => {
      checkouts += 1;
      return route.fulfill({
        status: 503,
        json: { code: "test_stop", message: "Test checkout", requestId: id },
      });
    });
    await page.goto("/checkout/return?token=sample-private-credential");
    await expect(page.locator('input[type="email"]').first()).toHaveValue("buyer@example.org");
    await expect(page.getByLabel("Discount code (optional)")).toHaveValue("OLD-CODE");
    await expect(
      page.getByText("Your checkout total has changed.", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("main")).toHaveCount(1);
    expect(checkouts).toBe(0);
  });
}

test("expired recovery offers current public pages without revealing saved details", async ({
  page,
}) => {
  await mockHealth(page);
  await page.route("**/api/public/projection*", (route) =>
    route.fulfill({ json: publicDonationProjection }),
  );
  await page.route("**/api/public/checkout-reminders/recovery*", (route) =>
    route.fulfill({ status: 404, json: { code: "recovery_unavailable" } }),
  );
  await page.goto("/checkout/return?token=expired-sample");
  await expect(page.getByRole("alert")).toContainText("unavailable or expired");
  await expect(page.getByRole("link", { name: "View tickets" })).toHaveAttribute(
    "href",
    "/tickets",
  );
  await expect(page.getByRole("link", { name: "Make a donation" })).toHaveAttribute(
    "href",
    "/donate",
  );
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
});
