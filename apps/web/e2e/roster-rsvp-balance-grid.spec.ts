import { expect, test, type Page } from "@playwright/test";

import { installOrganizationApi } from "./fixtures/apiMocks";
import { buildOrganizationEvent, buildOrganizationProfile } from "./fixtures/builders";

async function setupRosterConfig(
  page: Page,
  sections: readonly { code: string; color: string; name: string; trackOnly: boolean }[],
  voiceParts: readonly { fullName: string; label: string; sectionCode: string }[],
) {
  await page.route("**/api/organization/members", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        memberships: [
          {
            email: "browser.singer@example.test",
            id: "membership-1",
            name: "Browser Singer",
            profileId: "11111111-1111-4111-8111-111111111111",
            role: "member",
          },
        ],
        requestId: "99999999-9999-4999-8999-999999999999",
        truncated: false,
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.route("**/api/organization/roster-configuration", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        attendanceReportWarningThreshold: 1,
        onBreakTimeoutDays: 365,
        onBreakTimeoutEnabled: true,
        performerLabel: "Performer",
        requestId: "99999999-9999-4999-8999-999999999999",
        rsvpExpiryEnabled: true,
        rsvpFollowUpEnabled: true,
        rsvpFollowUpLeadHours: 48,
        sections,
        statusAutomationEnabled: true,
        statusAutomationMissThreshold: 3,
        statusAutomationRecoveryEnabled: true,
        voiceParts,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
}

test.describe("Section-to-Part Balance Grid Geometry", () => {
  test.use({ viewport: { height: 900, width: 1280 } });

  const config2x2 = {
    sections: [
      { code: "T", color: "#1b4d3e", name: "Tenors", trackOnly: false },
      { code: "B", color: "#2d3748", name: "Basses", trackOnly: false },
    ],
    voiceParts: [
      { fullName: "Tenor 1", label: "T1", sectionCode: "T" },
      { fullName: "Tenor 2", label: "T2", sectionCode: "T" },
      { fullName: "Bass 1", label: "B1", sectionCode: "B" },
      { fullName: "Bass 2", label: "B2", sectionCode: "B" },
    ],
  };

  const config1x3 = {
    sections: [
      { code: "T", color: "#1b4d3e", name: "Tenors", trackOnly: false },
      { code: "B", color: "#2d3748", name: "Basses", trackOnly: false },
    ],
    voiceParts: [
      { fullName: "Tenor 1", label: "T1", sectionCode: "T" },
      { fullName: "Bass 1", label: "B1", sectionCode: "B" },
      { fullName: "Bass 2", label: "B2", sectionCode: "B" },
      { fullName: "Bass 3", label: "B3", sectionCode: "B" },
    ],
  };

  test("aligns 2+2 section cards exactly to child part columns on Roster page", async ({
    page,
  }) => {
    const api = await installOrganizationApi(page, { role: "administrator" });
    api.profiles.set([buildOrganizationProfile({ voicePart: "T1" })]);
    await setupRosterConfig(page, config2x2.sections, config2x2.voiceParts);

    await page.goto("/admin/roster");
    await expect(page.getByRole("heading", { name: "Roster", level: 1 })).toBeVisible();

    const tenors = page.locator(".roster-balance__section").filter({ hasText: "Tenors" });
    const basses = page.locator(".roster-balance__section").filter({ hasText: "Basses" });
    const t1 = page.locator(".roster-balance__part").filter({ hasText: "T1" });
    const t2 = page.locator(".roster-balance__part").filter({ hasText: "T2" });
    const b1 = page.locator(".roster-balance__part").filter({ hasText: "B1" });
    const b2 = page.locator(".roster-balance__part").filter({ hasText: "B2" });

    await expect(tenors).toBeVisible();
    await expect(basses).toBeVisible();
    await expect(t1).toBeVisible();
    await expect(b2).toBeVisible();

    const [tenorsBox, bassesBox, t1Box, t2Box, b1Box, b2Box] = await Promise.all([
      tenors.boundingBox(),
      basses.boundingBox(),
      t1.boundingBox(),
      t2.boundingBox(),
      b1.boundingBox(),
      b2.boundingBox(),
    ]);

    expect(tenorsBox).not.toBeNull();
    expect(bassesBox).not.toBeNull();
    expect(t1Box).not.toBeNull();
    expect(t2Box).not.toBeNull();
    expect(b1Box).not.toBeNull();
    expect(b2Box).not.toBeNull();

    if (tenorsBox && bassesBox && t1Box && t2Box && b1Box && b2Box) {
      // Tenors left aligns to T1 left
      expect(Math.abs(tenorsBox.x - t1Box.x)).toBeLessThanOrEqual(2);
      // Tenors right aligns to T2 right
      expect(Math.abs(tenorsBox.x + tenorsBox.width - (t2Box.x + t2Box.width))).toBeLessThanOrEqual(
        2,
      );

      // Basses left aligns to B1 left
      expect(Math.abs(bassesBox.x - b1Box.x)).toBeLessThanOrEqual(2);
      // Basses right aligns to B2 right
      expect(Math.abs(bassesBox.x + bassesBox.width - (b2Box.x + b2Box.width))).toBeLessThanOrEqual(
        2,
      );

      // Equal-width part tracks
      expect(Math.abs(t1Box.width - t2Box.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(t2Box.width - b1Box.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(b1Box.width - b2Box.width)).toBeLessThanOrEqual(2);
    }

    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow).toBe(false);
  });

  test("aligns 2+2 section cards exactly to child part columns on Event RSVPs page", async ({
    page,
  }) => {
    const api = await installOrganizationApi(page, { role: "administrator" });
    const event = buildOrganizationEvent({ type: "Performance" });
    api.events.set([event]);
    api.profiles.set([buildOrganizationProfile({ voicePart: "T1" })]);
    await setupRosterConfig(page, config2x2.sections, config2x2.voiceParts);

    await page.goto("/admin/rsvp");
    await expect(page.getByRole("heading", { name: "Event RSVPs", level: 1 })).toBeVisible();

    const tenors = page.locator(".roster-balance__section").filter({ hasText: "Tenors" });
    const basses = page.locator(".roster-balance__section").filter({ hasText: "Basses" });
    const t1 = page.locator(".roster-balance__part").filter({ hasText: "T1" });
    const t2 = page.locator(".roster-balance__part").filter({ hasText: "T2" });
    const b1 = page.locator(".roster-balance__part").filter({ hasText: "B1" });
    const b2 = page.locator(".roster-balance__part").filter({ hasText: "B2" });

    await expect(tenors).toBeVisible();
    await expect(basses).toBeVisible();
    await expect(t1).toBeVisible();
    await expect(b2).toBeVisible();

    const [tenorsBox, bassesBox, t1Box, t2Box, b1Box, b2Box] = await Promise.all([
      tenors.boundingBox(),
      basses.boundingBox(),
      t1.boundingBox(),
      t2.boundingBox(),
      b1.boundingBox(),
      b2.boundingBox(),
    ]);

    expect(tenorsBox).not.toBeNull();
    expect(bassesBox).not.toBeNull();
    expect(t1Box).not.toBeNull();
    expect(t2Box).not.toBeNull();
    expect(b1Box).not.toBeNull();
    expect(b2Box).not.toBeNull();

    if (tenorsBox && bassesBox && t1Box && t2Box && b1Box && b2Box) {
      // Tenors left aligns to T1 left
      expect(Math.abs(tenorsBox.x - t1Box.x)).toBeLessThanOrEqual(2);
      // Tenors right aligns to T2 right
      expect(Math.abs(tenorsBox.x + tenorsBox.width - (t2Box.x + t2Box.width))).toBeLessThanOrEqual(
        2,
      );

      // Basses left aligns to B1 left
      expect(Math.abs(bassesBox.x - b1Box.x)).toBeLessThanOrEqual(2);
      // Basses right aligns to B2 right
      expect(Math.abs(bassesBox.x + bassesBox.width - (b2Box.x + b2Box.width))).toBeLessThanOrEqual(
        2,
      );

      // Equal-width part tracks
      expect(Math.abs(t1Box.width - t2Box.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(t2Box.width - b1Box.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(b1Box.width - b2Box.width)).toBeLessThanOrEqual(2);
    }

    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow).toBe(false);
  });

  test("aligns uneven 1+3 section cards correctly on both pages", async ({ page }) => {
    const api = await installOrganizationApi(page, { role: "administrator" });
    const event = buildOrganizationEvent({ type: "Performance" });
    api.events.set([event]);
    api.profiles.set([buildOrganizationProfile({ voicePart: "T1" })]);
    await setupRosterConfig(page, config1x3.sections, config1x3.voiceParts);

    // Test on Roster
    await page.goto("/admin/roster");
    await expect(page.getByRole("heading", { name: "Roster", level: 1 })).toBeVisible();

    const tenors = page.locator(".roster-balance__section").filter({ hasText: "Tenors" });
    const basses = page.locator(".roster-balance__section").filter({ hasText: "Basses" });
    const t1 = page.locator(".roster-balance__part").filter({ hasText: "T1" });
    const b1 = page.locator(".roster-balance__part").filter({ hasText: "B1" });
    const b3 = page.locator(".roster-balance__part").filter({ hasText: "B3" });

    await expect(tenors).toBeVisible();
    await expect(basses).toBeVisible();
    await expect(t1).toBeVisible();
    await expect(b3).toBeVisible();

    const [tenorsBox, bassesBox, t1Box, b1Box, b3Box] = await Promise.all([
      tenors.boundingBox(),
      basses.boundingBox(),
      t1.boundingBox(),
      b1.boundingBox(),
      b3.boundingBox(),
    ]);

    expect(tenorsBox).not.toBeNull();
    expect(bassesBox).not.toBeNull();
    expect(t1Box).not.toBeNull();
    expect(b1Box).not.toBeNull();
    expect(b3Box).not.toBeNull();

    if (tenorsBox && bassesBox && t1Box && b1Box && b3Box) {
      // Tenors span = 1 (covers T1 exactly)
      expect(Math.abs(tenorsBox.x - t1Box.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(tenorsBox.x + tenorsBox.width - (t1Box.x + t1Box.width))).toBeLessThanOrEqual(
        2,
      );

      // Basses span = 3 (covers B1 through B3)
      expect(Math.abs(bassesBox.x - b1Box.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(bassesBox.x + bassesBox.width - (b3Box.x + b3Box.width))).toBeLessThanOrEqual(
        2,
      );

      // Equal-width part tracks
      expect(Math.abs(t1Box.width - b1Box.width)).toBeLessThanOrEqual(2);
    }

    // Test on Event RSVPs
    await page.goto("/admin/rsvp");
    await expect(page.getByRole("heading", { name: "Event RSVPs", level: 1 })).toBeVisible();

    const rsvpTenors = page.locator(".roster-balance__section").filter({ hasText: "Tenors" });
    const rsvpBasses = page.locator(".roster-balance__section").filter({ hasText: "Basses" });
    const rsvpT1 = page.locator(".roster-balance__part").filter({ hasText: "T1" });
    const rsvpB1 = page.locator(".roster-balance__part").filter({ hasText: "B1" });
    const rsvpB3 = page.locator(".roster-balance__part").filter({ hasText: "B3" });

    await expect(rsvpTenors).toBeVisible();
    await expect(rsvpBasses).toBeVisible();
    await expect(rsvpT1).toBeVisible();
    await expect(rsvpB3).toBeVisible();

    const [rTenorsBox, rBassesBox, rT1Box, rB1Box, rB3Box] = await Promise.all([
      rsvpTenors.boundingBox(),
      rsvpBasses.boundingBox(),
      rsvpT1.boundingBox(),
      rsvpB1.boundingBox(),
      rsvpB3.boundingBox(),
    ]);

    expect(rTenorsBox).not.toBeNull();
    expect(rBassesBox).not.toBeNull();
    expect(rT1Box).not.toBeNull();
    expect(rB1Box).not.toBeNull();
    expect(rB3Box).not.toBeNull();

    if (rTenorsBox && rBassesBox && rT1Box && rB1Box && rB3Box) {
      expect(Math.abs(rTenorsBox.x - rT1Box.x)).toBeLessThanOrEqual(2);
      expect(
        Math.abs(rTenorsBox.x + rTenorsBox.width - (rT1Box.x + rT1Box.width)),
      ).toBeLessThanOrEqual(2);

      expect(Math.abs(rBassesBox.x - rB1Box.x)).toBeLessThanOrEqual(2);
      expect(
        Math.abs(rBassesBox.x + rBassesBox.width - (rB3Box.x + rB3Box.width)),
      ).toBeLessThanOrEqual(2);

      expect(Math.abs(rT1Box.width - rB1Box.width)).toBeLessThanOrEqual(2);
    }
  });

  test("disables desktop spans and wraps cleanly on mobile viewport (<= 40rem)", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 800, width: 375 });

    const api = await installOrganizationApi(page, { role: "administrator" });
    api.profiles.set([buildOrganizationProfile({ voicePart: "T1" })]);
    await setupRosterConfig(page, config2x2.sections, config2x2.voiceParts);

    await page.goto("/admin/roster");
    await expect(page.getByRole("heading", { name: "Roster", level: 1 })).toBeVisible();

    const sectionsContainer = page.locator(".roster-balance__sections");
    await expect(sectionsContainer).toBeVisible();

    // In mobile, sections use 2-column grid and grid-column is auto
    const sectionColumns = await sectionsContainer.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
    expect(sectionColumns).toBe(2);

    const tenorSection = page.locator(".roster-balance__section").filter({ hasText: "Tenors" });
    const gridColumn = await tenorSection.evaluate((el) => getComputedStyle(el).gridColumn);
    expect(gridColumn).toContain("auto");

    // No horizontal page overflow
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow).toBe(false);
  });

  test("maintains geometry across theme changes (dark to light)", async ({ page }) => {
    const api = await installOrganizationApi(page, { role: "administrator" });
    api.profiles.set([buildOrganizationProfile({ voicePart: "T1" })]);
    await setupRosterConfig(page, config2x2.sections, config2x2.voiceParts);

    await page.goto("/admin/roster");
    await expect(page.getByRole("heading", { name: "Roster", level: 1 })).toBeVisible();

    const themeToggle = page.getByRole("button", { name: /Switch to light theme/i });
    if (await themeToggle.isVisible()) {
      await themeToggle.click();
      await expect(page.getByRole("button", { name: /Switch to dark theme/i })).toBeVisible();
    }

    const tenors = page.locator(".roster-balance__section").filter({ hasText: "Tenors" });
    const basses = page.locator(".roster-balance__section").filter({ hasText: "Basses" });
    const t1 = page.locator(".roster-balance__part").filter({ hasText: "T1" });
    const t2 = page.locator(".roster-balance__part").filter({ hasText: "T2" });
    const b1 = page.locator(".roster-balance__part").filter({ hasText: "B1" });
    const b2 = page.locator(".roster-balance__part").filter({ hasText: "B2" });

    const [tenorsBox, bassesBox, t1Box, t2Box, b1Box, b2Box] = await Promise.all([
      tenors.boundingBox(),
      basses.boundingBox(),
      t1.boundingBox(),
      t2.boundingBox(),
      b1.boundingBox(),
      b2.boundingBox(),
    ]);

    expect(tenorsBox).not.toBeNull();
    expect(bassesBox).not.toBeNull();
    expect(t1Box).not.toBeNull();
    expect(t2Box).not.toBeNull();
    expect(b1Box).not.toBeNull();
    expect(b2Box).not.toBeNull();

    if (tenorsBox && bassesBox && t1Box && t2Box && b1Box && b2Box) {
      expect(Math.abs(tenorsBox.x - t1Box.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(tenorsBox.x + tenorsBox.width - (t2Box.x + t2Box.width))).toBeLessThanOrEqual(
        2,
      );
      expect(Math.abs(bassesBox.x - b1Box.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(bassesBox.x + bassesBox.width - (b2Box.x + b2Box.width))).toBeLessThanOrEqual(
        2,
      );
    }
  });
});
