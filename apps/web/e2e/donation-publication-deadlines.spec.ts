import { test, expect } from "@playwright/test";
import { publicDonationProjection } from "./support/donationFixtures";
import { mockHealth } from "./support/testWorld";
import { futureDateString, pastIsoDate } from "@choir/testkit";
const id = "11111111-1111-4111-8111-111111111111";
const pastDate = pastIsoDate({ days: 3 }).slice(0, 10);
for (const state of ["open", "artwork", "both", "unset"] as const) {
  test(`donation publication ${state}: clear expectations and uploads remain available`, async ({
    page,
  }) => {
    await mockHealth(page);
    await page.route("**/api/public/projection*", (route) =>
      route.fulfill({ json: publicDonationProjection }),
    );
    await page.route("**/api/public/donation-settings*", (route) =>
      route.fulfill({
        json: {
          requestId: id,
          buttonText: "Support our Music",
          description: "Your gift supports our music.",
          levels: [
            {
              id: "sponsor",
              label: "Program sponsor",
              amountCents: 50000,
              benefit: "Includes program ad",
              includesProgramAd: true,
            },
          ],
          publication: {
            id,
            name: "Holiday program",
            recognitionDate:
              state === "unset"
                ? null
                : state === "both"
                  ? pastDate
                  : futureDateString({ days: 3 }),
            artworkDate:
              state === "unset"
                ? null
                : state === "open"
                  ? futureDateString({ days: 2 })
                  : pastDate,
            timezone: "America/New_York",
            revision: 1,
          },
        },
      }),
    );
    await page.route("**/api/public/transaction-fee-settings*", (route) =>
      route.fulfill({
        json: { requestId: id, fixedCents: 30, percentage: 2.9, passFeeToDonor: false },
      }),
    );
    let payload: unknown = null;
    await page.route("**/api/public/donations/checkout", (route) => {
      payload = route.request().postDataJSON();
      return route.fulfill({
        status: 503,
        json: { code: "preview_unavailable", message: "Test checkout recorded.", requestId: id },
      });
    });
    await page.goto("/donate");
    await expect(page.getByRole("heading", { name: "Support our Music" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete donation" })).toBeEnabled();
    await expect(page.locator('input[type="file"]')).toBeEnabled();
    const grid = page.locator(".donation-level-grid");
    await expect(grid).not.toContainText(/deadline|cutoff|November|December/);
    if (state === "both")
      await expect(
        page.getByText(/inclusion of your name in Holiday program is no longer guaranteed/).first(),
      ).toBeVisible();
    if (state === "both" || state === "artwork")
      await expect(
        page
          .getByText(
            /You can still submit artwork, but inclusion in Holiday program is no longer guaranteed/,
          )
          .first(),
      ).toBeVisible();
    if (state === "unset") await expect(page.getByText(/no longer guaranteed/)).toHaveCount(0);
    await page.getByLabel("Name", { exact: true }).fill("Example Donor");
    await page.getByLabel("Email", { exact: true }).fill("donor@example.test");
    await page.getByLabel("Confirm email", { exact: true }).fill("donor@example.test");
    await page.getByRole("button", { name: "Complete donation" }).click();
    await expect.poll(() => payload).toMatchObject({ publicationId: id, publicationRevision: 1 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}
