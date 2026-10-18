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
      await page.getByRole("searchbox", { name: "Search directory" }).fill("Alexandria");
      await expect(
        page.getByRole("listitem", {
          name: "Directory Profile: Alexandria MontgomeryWellingtonJacksonWilliams",
        }),
      ).toBeVisible();
    });
  }
}
