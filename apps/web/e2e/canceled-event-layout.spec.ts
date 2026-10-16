import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";

for (const theme of ["light", "dark"] as const) {
  test(`canceled event badge stays clear of event text in ${theme} theme`, async ({
    page,
  }, testInfo) => {
    const api = await installOrganizationApi(page, { role: "administrator", strict: true });
    api.events.set(api.events.get().map((event) => ({ ...event, isCanceled: true })));
    await page.addInitScript((value) => {
      window.localStorage.setItem(`choir-theme:${window.location.hostname}`, value);
    }, theme);
    if (!testInfo.project.name.includes("mobile"))
      await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/admin/events");
    const identity = page.locator(".event-list__identity").filter({ visible: true }).first();
    const text = identity.locator("div");
    const badge = identity.getByText("Canceled", { exact: true });
    await expect(badge).toBeVisible();
    const textBox = await text.boundingBox();
    const badgeBox = await badge.boundingBox();
    if (!textBox || !badgeBox) throw new Error("Missing event text or cancellation badge");
    expect(
      badgeBox.x >= textBox.x + textBox.width - 1 || badgeBox.y >= textBox.y + textBox.height - 1,
    ).toBe(true);
    if (!testInfo.project.name.includes("mobile"))
      expect(badgeBox.x).toBeGreaterThan(textBox.x + textBox.width - 1);
    await expect(page.locator("body")).toHaveJSProperty(
      "scrollWidth",
      await page.locator("body").evaluate((node) => node.clientWidth),
    );
    await page.screenshot({ path: testInfo.outputPath(`canceled-event-${theme}.png`) });
    api.assertNoUnexpectedRequests();
  });
}
