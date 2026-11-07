import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { futureIsoDate, pastIsoDate } from "@choir/testkit";
import { installOrganizationApi } from "./fixtures/apiMocks";

test("notification disclosures stay readable and keyboard accessible in both themes", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !["127.0.0.1", "localhost"].includes(url.hostname)
    ) {
      externalRequests.push(url.origin);
      await route.abort();
      return;
    }
    await route.fallback();
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  api.setNotifications?.([
    {
      id: "22222222-2222-4222-8222-222222222222",
      kind: "rsvp_decline",
      title: "Rehearsal RSVP declined",
      body: "Wes Osborn (T2) declined the 2026 Christmas Concert rehearsal.",
      createdAt: pastIsoDate({ days: 1 }),
      expiresAt: futureIsoDate({ days: 30 }),
      readAt: pastIsoDate({ days: 1 }),
      destinationPath: "/admin/events",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      kind: "ticket_sale",
      title: "Robin Leach purchased 2 tickets for the 2026 Christmas Concert",
      body: "Robin Leach purchased 2 tickets ($20.91).",
      createdAt: pastIsoDate({ days: 2 }),
      expiresAt: futureIsoDate({ days: 30 }),
      readAt: pastIsoDate({ days: 1 }),
      destinationPath: "/admin/ticketing",
    },
  ]);
  await page.goto("/account/notifications");
  await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toHaveCount(1);
  const inbox = page.locator(".notification-inbox-page");
  const rows = inbox.locator("details");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute("open", "");
  await expect(rows.nth(1)).not.toHaveAttribute("open");
  const second = rows.nth(1).locator("summary");
  await second.focus();
  await page.keyboard.press("Enter");
  await expect(rows.nth(1)).toHaveAttribute("open", "");
  await expect(rows.nth(1).getByText("Robin Leach purchased 2 tickets ($20.91).")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(rows.nth(1)).not.toHaveAttribute("open");
  for (const theme of ["light", "dark"] as const) {
    const toggle = page.getByRole("button", { name: `Switch to ${theme} theme` });
    if (await toggle.isVisible()) await toggle.click();
    await expect(inbox.getByRole("combobox", { name: "Show notifications" })).toBeVisible();
    expect(
      await inbox.locator("h2").evaluateAll((headings) =>
        headings.every((heading) => {
          const style = getComputedStyle(heading);
          return style.whiteSpace !== "nowrap" && heading.scrollWidth <= heading.clientWidth + 1;
        }),
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const audit = await new AxeBuilder({ page }).include(".notification-inbox-page").analyze();
    expect(
      audit.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`notifications-${theme}.png`),
      fullPage: true,
    });
  }
  const filteredRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/api/notifications" && url.searchParams.get("filter") === "ticket_sale"
    );
  });
  await inbox.getByRole("combobox", { name: "Show notifications" }).selectOption("ticket_sale");
  await filteredRequest;
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(
    await page
      .locator("img")
      .evaluateAll((images) =>
        images.every(
          (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
        ),
      ),
  ).toBe(true);
  api.assertNoUnexpectedRequests();
});
