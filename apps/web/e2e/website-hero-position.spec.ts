import { expect, test } from "@playwright/test";
import { publicWebsiteSettingsResponseSchema } from "@choir/contracts";
import { installOrganizationApi } from "./fixtures/apiMocks";

const fileId = "77777777-7777-4777-8777-777777777777";
const requestId = "11111111-1111-4111-8111-111111111111";
for (const image of [
  { name: "square", width: 1000, height: 1000 },
  { name: "landscape", width: 2000, height: 500 },
]) {
  test(`repositions ${image.name} hero and matches preview/public crops`, async ({
    page,
  }, testInfo) => {
    const api = await installOrganizationApi(page, { role: "administrator", strict: true });
    let saved = publicWebsiteSettingsResponseSchema.parse({
      organizationName: "Community Chorus",
      heroHeadline: "",
      heroSubtitle: "",
      heroFileId: fileId,
      heroPosition: { x: 50, y: 50 },
      publicationVersion: 4,
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      requestId,
    });
    let published = saved;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(image.width)}" height="${String(image.height)}"><rect width="100%" height="100%" fill="#42848c"/><rect width="100%" height="25%" fill="#dbb04a"/><rect y="75%" width="100%" height="25%" fill="#394783"/></svg>`;
    await page.route(`**/api/organization/files/${fileId}`, (route) =>
      route.fulfill({ contentType: "image/svg+xml", body: svg }),
    );
    await page.route(`**/api/public/media/*/${fileId}`, (route) =>
      route.fulfill({ contentType: "image/svg+xml", body: svg }),
    );
    await page.route("**/api/organization/website", async (route) => {
      if (route.request().method() === "PUT")
        saved = publicWebsiteSettingsResponseSchema.parse({
          ...saved,
          ...route.request().postDataJSON(),
        });
      await route.fulfill({ json: saved });
    });
    await page.route("**/api/organization/website/publish", async (route) => {
      published = saved;
      await route.fulfill({
        json: { version: 5, publishedAt: new Date().toISOString(), requestId },
      });
    });
    await page.route("**/api/public/projection*", (route) =>
      route.fulfill({
        json: {
          version: 5,
          generatedAt: new Date().toISOString(),
          organizationId: "organization-alpha",
          payload: {
            settings: published,
            organizationName: published.organizationName,
            timezone: "America/New_York",
            performances: [],
            ticketBundles: [],
            mediaFileIds: [fileId],
          },
        },
      }),
    );
    await page.goto("/admin/website");
    const editor = page.getByRole("button", { name: "Reposition hero image", exact: true });
    await expect(editor).toBeVisible();
    await expect
      .poll(() =>
        editor
          .locator("img")
          .evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth > 0),
      )
      .toBe(true);
    if (image.name === "landscape")
      await page.getByRole("button", { name: "Mobile crop", exact: true }).click();
    await editor.scrollIntoViewIfNeeded();
    const box = await editor.boundingBox();
    if (!box) throw new Error("Missing image position editor");
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    const end = {
      x: x + (image.name === "landscape" ? 30 : 0),
      y: y + (image.name === "square" ? 30 : 0),
    };
    if (testInfo.project.name === "mobile-chromium") {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [end] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 5 });
      await page.mouse.up();
    }
    await expect(editor).not.toHaveCSS("background-position", "50% 50%");
    await expect(
      page.getByRole("button", { name: "Publish saved draft", exact: true }),
    ).toBeDisabled();
    expect(published.heroPosition).toEqual({ x: 50, y: 50 });
    await editor.focus();
    await page.keyboard.press("ArrowDown");
    const horizontal = page.getByRole("slider", { name: /Horizontal focal point/ });
    const vertical = page.getByRole("slider", { name: /Vertical focal point/ });
    await horizontal.focus();
    await page.keyboard.press("Home");
    await vertical.focus();
    await page.keyboard.press("End");
    await expect(editor).toHaveCSS("background-position", "0% 100%");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Publish saved draft", exact: true }),
    ).toBeEnabled();
    expect(saved.heroPosition).toEqual({ x: 0, y: 100 });
    await page.reload();
    await expect(editor).toHaveCSS("background-position", "0% 100%");
    const previewToggle = page.getByRole("button", { name: "Preview", exact: true });
    if (await previewToggle.isVisible()) await previewToggle.click();
    const preview = page.getByRole("region", { name: "Public website draft preview" });
    for (const device of ["Desktop", "Mobile"]) {
      await page
        .getByRole("group", { name: "Preview device" })
        .getByRole("button", { name: device, exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(1);
      const hero = preview.locator(".public-hero");
      await expect(hero).toHaveCSS("background-position", "0% 100%");
      const expected = 1152 / 416;
      await expect
        .poll(() =>
          hero.evaluate((element) => {
            const b = element.getBoundingClientRect();
            return b.width / b.height;
          }),
        )
        .toBeCloseTo(expected, 1);
      await hero.screenshot({ path: testInfo.outputPath(`${device.toLowerCase()}-crop.png`) });
    }
    const editToggle = page.getByRole("button", { name: "Edit", exact: true });
    if (await editToggle.isVisible()) await editToggle.click();
    await page.getByRole("button", { name: "Publish saved draft", exact: true }).click();
    await expect(page.getByText("Version 5 is live.", { exact: true })).toBeVisible();
    await page.goto("/");
    await expect(page.locator(".public-hero")).toHaveCSS("background-position", "0% 100%");
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const ratio = await page.locator(".public-hero").evaluate((element) => {
        const b = element.getBoundingClientRect();
        return b.width / b.height;
      });
      expect(ratio).toBeCloseTo(1152 / 416, 1);
    }
    api.assertNoUnexpectedRequests();
  });
}
