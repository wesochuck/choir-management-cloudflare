import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { buildDirectoryAltoProfile } from "./fixtures/builders";

test.use({ serviceWorkers: "block" });

for (const theme of ["light", "dark"] as const) {
  for (const width of [320, 375, 390, 430]) {
    test(`@webkit-smoke member directory fits a ${String(width)}px mobile screen in ${theme} theme`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: 844 });
      await installOrganizationApi(page, { role: "member" });
      await page.route("**/api/organization/branding", (route) =>
        route.fulfill({
          json: {
            organizationId: "organization-alpha",
            organizationName: "Lancaster Community Chorus",
            logoFileId: "22222222-2222-4222-8222-222222222222",
          },
        }),
      );
      await page.route("**/api/organization/files/22222222-2222-4222-8222-222222222222", (route) =>
        route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#456789"/></svg>',
        }),
      );
      await page.route("**/api/singer/directory", (route) =>
        route.fulfill({
          json: {
            profiles: [
              {
                ...buildDirectoryAltoProfile(),
                displayName: "Alexandria MontgomeryWellingtonJacksonWilliams",
                email: "alexandria.montgomery.wellington@communitychorus.example.org",
                voicePart: "First Alto Section – community choir and seasonal performers",
              },
              {
                ...buildDirectoryAltoProfile(),
                id: "22222222-3333-4444-8555-666666666666",
                displayName: "Casey Singer",
                voicePart: "T1",
                email: "",
                phone: "",
                photoFileId: null,
              },
            ],
            requestId: "11111111-1111-4111-8111-111111111111",
          },
        }),
      );
      await page.goto("/directory");
      await expect(
        page.getByRole("listitem", {
          name: "Directory Profile: Alexandria MontgomeryWellingtonJacksonWilliams",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("banner").getByRole("link", { name: "Lancaster Community Chorus" }),
      ).toBeVisible();
      const compactCard = page.getByRole("listitem", { name: "Directory Profile: Casey Singer" });
      const avatar = await compactCard.locator(".profile-photo--directory").boundingBox();
      const title = await compactCard.getByRole("heading", { name: "Casey Singer" }).boundingBox();
      const card = await compactCard.boundingBox();
      if (!avatar || !title || !card) throw new Error("Expected directory card layout bounds.");
      expect(title.x).toBeGreaterThanOrEqual(avatar.x + avatar.width);
      expect(Math.abs(title.y - avatar.y)).toBeLessThanOrEqual(1);
      expect(card.height).toBeLessThan(170);
      const overflow = await page.evaluate(() =>
        [...document.querySelectorAll("body *")].flatMap((element) => {
          const bounds = element.getBoundingClientRect();
          if (bounds.right <= innerWidth + 1 || bounds.width === 0) return [];
          const style = getComputedStyle(element);
          if (style.position === "fixed" || element.closest('[role="dialog"]')) return [];
          return [
            {
              tag: element.tagName,
              className: element.className,
              right: bounds.right,
              width: bounds.width,
            },
          ];
        }),
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        JSON.stringify(overflow),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath("directory-mobile.png"), fullPage: true });
      await page.getByRole("searchbox", { name: "Search directory" }).fill("Casey");
      await expect(compactCard).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath("directory-compact-mobile.png"),
        fullPage: true,
      });
      await page.getByRole("searchbox", { name: "Search directory" }).fill("Alexandria");
      await expect(
        page.getByRole("listitem", {
          name: "Directory Profile: Alexandria MontgomeryWellingtonJacksonWilliams",
        }),
      ).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 900 });
      const desktopCard = page.getByRole("listitem", {
        name: "Directory Profile: Alexandria MontgomeryWellingtonJacksonWilliams",
      });
      const desktopAvatar = await desktopCard.locator(".profile-photo--directory").boundingBox();
      const desktopTitle = await desktopCard.getByRole("heading").boundingBox();
      if (!desktopAvatar || !desktopTitle)
        throw new Error("Expected desktop directory layout bounds.");
      expect(desktopTitle.y).toBeGreaterThanOrEqual(desktopAvatar.y + desktopAvatar.height);
    });
  }
}

test("members independently control directory email and phone visibility", async ({
  page,
}, info) => {
  const api = await installOrganizationApi(page, { role: "member", strict: true });
  for (const theme of ["light", "dark"] as const) {
    await page.goto("/profile");
    const email = page.getByRole("checkbox", { name: "Show my email in the directory" });
    const phone = page.getByRole("checkbox", { name: "Show my phone number in the directory" });
    await expect(email).toBeChecked();
    await expect(phone).toBeChecked();
    const toggle = page.getByRole("button", { name: `Switch to ${theme} theme` });
    if (await toggle.isVisible()) await toggle.click();
    await email.uncheck();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Your Organization Profile was updated.")).toBeVisible();
    expect(api.memberProfile.get().showEmailInDirectory).toBe(false);
    expect(api.memberProfile.get().showPhoneInDirectory).toBe(true);
    await page.reload();
    await expect(email).not.toBeChecked();
    await expect(phone).toBeChecked();
    await phone.uncheck();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Your Organization Profile was updated.")).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`directory-preferences-${theme}.png`),
      fullPage: true,
    });
    await page.goto("/directory");
    const own = page.getByRole("listitem", { name: "Directory Profile: Browser Singer" });
    await expect(own).toBeVisible();
    await expect(own.locator('a[href^="mailto:"]')).toHaveCount(0);
    await expect(own.locator('a[href^="tel:"]')).toHaveCount(0);
    await page.goto("/profile");
    await email.check();
    await phone.check();
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Your Organization Profile was updated.")).toBeVisible();
  }
  api.assertNoUnexpectedRequests();
});
