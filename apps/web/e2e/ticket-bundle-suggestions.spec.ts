import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { publishedOrganizationProjectionSchema } from "@choir/contracts";
import { futureIsoDate, pastIsoDate } from "@choir/testkit";
import {
  routePublicBasics,
  ticketingProjection,
  eventId,
  bundleId,
} from "./support/ticketingFixtures";

const projection = publishedOrganizationProjectionSchema.parse(ticketingProjection);
const bundle = projection.payload.ticketBundles[0];
if (!bundle) throw new Error("Missing bundle fixture");
const offered = {
  ...bundle,
  title: "LCC 2026–2027 Season",
  ticketSlug: "lcc-2026-2027-season",
  priceCents: 3000,
};
const published = { ...projection, payload: { ...projection.payload, ticketBundles: [offered] } };

for (const theme of ["light", "dark"] as const) {
  test(`suggests only matching on-sale season passes in ${theme} theme`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await routePublicBasics(page);
    await page.route("**/api/public/projection", (route) => route.fulfill({ json: published }));
    let live: typeof projection.payload.ticketBundles = [offered];
    await page.route("**/api/public/commerce-projection", (route) =>
      route.fulfill({
        json: { ...published, payload: { ...published.payload, ticketBundles: live } },
      }),
    );
    await page.route("**/api/public/transaction-fee-settings", (route) =>
      route.fulfill({ status: 404 }),
    );
    await page.route("**/api/public/tickets/discount-availability*", (route) =>
      route.fulfill({ json: { hasRedeemableCode: false } }),
    );
    await page.goto(`/tickets/${eventId}`);
    const suggestion = page.getByRole("complementary", {
      name: "Coming to more than one concert?",
    });
    await expect(suggestion).toBeVisible();
    await expect(suggestion).toContainText("LCC 2026–2027 Season");
    await expect(suggestion).toContainText("$30.00 per pass");
    const orderName = page.getByLabel("Name on order", { exact: true });
    await orderName.fill("Taylor Singer");
    await expect(orderName).toHaveValue("Taylor Singer");
    const offerBox = await suggestion.boundingBox();
    const orderBox = await page.locator("form").boundingBox();
    if (!offerBox || !orderBox) throw new Error("Missing suggestion or form bounds");
    expect(offerBox.y + offerBox.height).toBeLessThanOrEqual(orderBox.y);
    const passLink = suggestion.getByRole("link", {
      name: "View season pass: LCC 2026–2027 Season",
    });
    await passLink.focus();
    await expect(passLink).toBeFocused();
    await suggestion.screenshot({ path: testInfo.outputPath("compact-season-pass.png") });
    const accessibility = await new AxeBuilder({ page })
      .include(".ticket-bundle-suggestions")
      .analyze();
    expect(accessibility.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/tickets\/bundles\/lcc-2026-2027-season$/);
    await expect(
      page.getByRole("heading", { name: "LCC 2026–2027 Season", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".public-bundle-event-list")).toContainText("Spring Concert");
    for (const unavailable of [
      [],
      [{ ...offered, saleEndAt: pastIsoDate({ days: 1 }) }],
      [{ ...offered, eventIds: ["55555555-5555-4555-8555-555555555555"] }],
    ]) {
      live = unavailable;
      await page.goto(`/tickets/${eventId}`);
      await expect(
        page.getByRole("heading", { name: "Spring Concert", exact: true }),
      ).toBeVisible();
      await expect(suggestion).toHaveCount(0);
      await expect(orderName).toBeVisible();
    }
    live = [{ ...offered, ticketSlug: null, saleEndAt: futureIsoDate({ days: 10 }) }];
    await page.goto(`/tickets/${eventId}`);
    await expect(suggestion.getByRole("link")).toHaveAttribute(
      "href",
      `/tickets/bundles/${bundleId}`,
    );
    await suggestion.getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/tickets/bundles/${bundleId}$`));
  });
}
