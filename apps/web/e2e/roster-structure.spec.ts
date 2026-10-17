import { expect, test } from "@playwright/test";
import { organizationRosterConfigurationRequestSchema } from "@choir/contracts";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { buildOrganizationProfile } from "./fixtures/builders";

test("section-only structure saves from Roster Settings and drives member assignments", async ({
  page,
}, testInfo) => {
  const api = await installOrganizationApi(page);
  await page.route("**/api/organization/members", async (route) => {
    await route.fulfill({
      json: {
        memberships: [],
        truncated: false,
        requestId: "11111111-1111-4111-8111-111111111111",
      },
    });
  });
  api.profiles.set([buildOrganizationProfile({ displayName: "Flute Member", voicePart: "F1" })]);
  let configuration = organizationRosterConfigurationRequestSchema.parse({
    sections: [
      { code: "F", name: "Flute", color: "#123456" },
      { code: "TR", name: "Trumpet", color: "#654321" },
    ],
    voiceParts: [{ label: "F1", fullName: "Flute 1", sectionCode: "F" }],
  });
  await page.route("**/api/organization/roster-configuration", async (route) => {
    if (route.request().method() === "PUT") {
      configuration = organizationRosterConfigurationRequestSchema.parse(
        route.request().postDataJSON(),
      );
      if (configuration.rosterStructure === "sections_only") {
        api.profiles.set(
          api.profiles.get().map((profile) => ({
            ...profile,
            voicePart: profile.voicePart === "F1" ? "F" : profile.voicePart,
          })),
        );
      }
    }
    await route.fulfill({
      json: { ...configuration, requestId: "11111111-1111-4111-8111-111111111111" },
    });
  });
  await page.goto("/admin/roster");
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByLabel("Assign members by").selectOption("sections_only");
  await expect(page.getByRole("group", { name: "Parts", exact: true })).not.toBeVisible();
  await expect(page.getByText(/On save, members assigned to parts/)).toBeVisible();
  await page.locator(".floating-save-bar").getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".floating-save-bar")).not.toBeVisible();
  await expect(page.getByLabel("Assign members by")).toHaveValue("sections_only");
  await expect(page.getByRole("button", { name: "Add part", exact: true })).not.toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.setAttribute("data-theme", value);
    }, theme);
    await page.screenshot({
      path: testInfo.outputPath(`roster-sections-${theme}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("tab", { name: "Roster", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Edit Profile" });
  await expect(dialog.getByLabel("Section", { exact: true })).toHaveValue("F");
  await expect(dialog.getByLabel("Section", { exact: true }).locator("option")).toHaveText([
    "No section",
    "Flute (F)",
    "Trumpet (TR)",
  ]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByLabel("Assign members by").selectOption("sections_with_parts");
  await expect(page.getByRole("group", { name: "Parts", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add part", exact: true })).toBeVisible();
  await page.locator(".floating-save-bar").getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".floating-save-bar")).not.toBeVisible();
  await page.getByRole("tab", { name: "Roster", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(dialog.getByLabel("Part", { exact: true })).toHaveValue("F");
  await expect(dialog.getByLabel("Part", { exact: true }).locator("option")).toHaveText([
    "No part",
    "Flute (F)",
    "Trumpet (TR)",
  ]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(dialog.getByLabel("Part", { exact: true })).toHaveValue("F");
});

test("the final unassigned part offers a direct switch to sections only", async ({ page }) => {
  const api = await installOrganizationApi(page);
  api.profiles.set([]);
  let configuration = organizationRosterConfigurationRequestSchema.parse({
    sections: [{ code: "F", name: "Flute", color: "#123456" }],
    voiceParts: [{ label: "F1", fullName: "Flute 1", sectionCode: "F" }],
  });
  await page.route("**/api/organization/roster-configuration", async (route) => {
    if (route.request().method() === "PUT") {
      configuration = organizationRosterConfigurationRequestSchema.parse(
        route.request().postDataJSON(),
      );
    }
    await route.fulfill({
      json: { ...configuration, requestId: "11111111-1111-4111-8111-111111111111" },
    });
  });

  await page.goto("/admin/roster");
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await expect(
    page.getByText("This is the last part. Switch to Sections only to remove the final part."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use sections only", exact: true }).click();

  await expect(page.getByRole("group", { name: "Parts", exact: true })).not.toBeVisible();
  await expect(page.getByText(/On save, members assigned to parts/)).toBeVisible();
});
