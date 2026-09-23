import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { buildSingerDashboardResponse } from "./fixtures/builders";
import { fulfillJson } from "./fixtures/session";

const PIN_KEY_SUFFIX = "choir-sidebar-pinned";

test("pinned layout shares heading, marks one current link, and persists", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto("/admin/roster");
  await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible();

  const sidebar = page.locator(".signed-in-sidebar");
  await expect(sidebar).toBeVisible();
  await expect(page.locator(".mobile-nav-trigger")).toBeHidden();
  await expect(page.locator(".signed-in-shell")).toHaveAttribute("data-sidebar-pinned", "true");

  // Shared heading hierarchy in the pinned sidebar, no eyebrow kickers.
  const sidebarHeading = sidebar.getByRole("heading", { level: 2, name: "Organization Admin" });
  await expect(sidebarHeading).toBeVisible();
  await expect(page.locator(".eyebrow")).toHaveCount(0);
  await expect(sidebar.locator(".workspace-nav__dot")).toHaveCount(0);

  // Exactly one current-page link.
  const currentLinks = sidebar.locator('a[aria-current="page"]');
  await expect(currentLinks).toHaveCount(1);
  await expect(currentLinks).toHaveAttribute("href", "/admin/roster");

  // Main content stays interactive while pinned.
  await expect(page.getByRole("button", { name: "Add Profile" })).toBeEnabled();

  await page.reload();
  await expect(page.locator(".signed-in-sidebar")).toBeVisible();
  await expect(page.locator(".signed-in-sidebar a[aria-current='page']")).toHaveAttribute(
    "href",
    "/admin/roster",
  );
  api.assertNoUnexpectedRequests();
});

test("pin, unpin, and collapse move focus to a visible control", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto("/admin/roster");
  const collapse = page.getByRole("button", { name: "Collapse navigation" });
  await expect(collapse).toBeVisible();

  await collapse.click();
  await expect(page.locator(".signed-in-sidebar")).toHaveCount(0);
  const trigger = page.getByRole("button", { name: "Open workspace navigation" });
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeFocused();

  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(drawer).toBeVisible();
  const pin = drawer.getByRole("button", { name: "Keep sidebar open" });
  await expect(pin).toBeVisible();
  await pin.click();
  await expect(drawer).toHaveCount(0);
  await expect(page.locator(".signed-in-sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Collapse navigation" })).toBeFocused();

  // Reload persists the pinned preference.
  await page.reload();
  await expect(page.locator(".signed-in-sidebar")).toBeVisible();

  // Unpin keeps navigation available in the drawer.
  await page.getByRole("button", { name: "Unpin sidebar" }).click();
  await expect(page.locator(".signed-in-sidebar")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Workspace navigation" })).toBeVisible();
  api.assertNoUnexpectedRequests();
});

test("drawer closes by escape, backdrop, and button with focus restoration", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto("/admin/roster");
  await page.getByRole("button", { name: "Unpin sidebar" }).click();
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  const trigger = page.getByRole("button", { name: "Open workspace navigation" });

  // Focus containment: tabbing from the close button stays inside the modal.
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Organization Admin");
  await page.getByRole("button", { name: "Close Workspace navigation" }).focus();
  await page.keyboard.press("Tab");
  expect(await drawer.evaluate((node) => node.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(drawer).toBeVisible();
  await page.getByRole("button", { name: "Close Workspace navigation" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(drawer).toBeVisible();
  // Backdrop click dismisses without navigating.
  await page.locator(".dialog__overlay").click({ position: { x: 700, y: 400 } });
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\/roster$/);
  await expect(trigger).toBeFocused();
  api.assertNoUnexpectedRequests();
});

test("narrow viewports use drawer only and never overwrite the desktop preference", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto("/admin/roster");
  await expect(page.locator(".signed-in-sidebar")).toBeVisible();

  await page.setViewportSize({ height: 800, width: 390 });
  // Narrow CSS hides the pinned sidebar; the drawer is the only navigation.
  await expect(page.locator(".signed-in-sidebar")).toBeHidden();
  const trigger = page.getByRole("button", { name: "Open workspace navigation" });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(drawer).toBeVisible();
  // Pin control stays hidden on narrow viewports even when rendered.
  await expect(drawer.getByRole("button", { name: "Keep sidebar open" })).toHaveCount(0);

  // Resizing back to desktop restores the saved pinned layout and cleans up.
  await page.keyboard.press("Escape");
  await page.setViewportSize({ height: 800, width: 1280 });
  await expect(page.locator(".signed-in-sidebar")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Workspace navigation" })).toHaveCount(0);
  const persisted = await page.evaluate(
    (suffix) => window.localStorage.getItem(`${suffix}:${window.location.hostname}`),
    PIN_KEY_SUFFIX,
  );
  expect(persisted).not.toBe("false");
  api.assertNoUnexpectedRequests();
});

test("navigation works when storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => {
          throw new Error("storage unavailable");
        },
        getItem: () => {
          throw new Error("storage unavailable");
        },
        key: () => null,
        removeItem: () => {
          throw new Error("storage unavailable");
        },
        setItem: () => {
          throw new Error("storage unavailable");
        },
        get length() {
          return 0;
        },
      },
    });
  });
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.setViewportSize({ height: 800, width: 1280 });
  await page.goto("/admin/roster");
  await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible();
  // Defaults to pinned when the preference cannot be read.
  await expect(page.locator(".signed-in-sidebar")).toBeVisible();

  // Narrow viewport does not crash and does not persist a new preference.
  await page.setViewportSize({ height: 800, width: 390 });
  await expect(page.locator(".signed-in-sidebar")).toBeHidden();
  await page.getByRole("button", { name: "Open workspace navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Workspace navigation" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.setViewportSize({ height: 800, width: 1280 });
  await expect(page.locator(".signed-in-sidebar")).toBeVisible();
  api.assertNoUnexpectedRequests();
});

test("dirty form cancel keeps route and drawer; accept navigates", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.route("**/api/organization/transaction-fee-settings", async (route) => {
    await fulfillJson(route, {
      fixedCents: 30,
      passFeeToDonor: false,
      percentage: 2.9,
      requestId: "77777777-7777-4777-8777-777777777777",
    });
  });
  await page.route("**/api/organization/payment-settings", async (route) => {
    await fulfillJson(route, {
      activations: { donations: false, dues: false, tickets: false },
      environment: "local",
      externalEffectsMode: "fake",
      globalPaymentsEnabled: true,
      organizationName: "Alpha Choir",
      readiness: {
        brevoConfigured: true,
        stripeAccountReady: false,
        stripeConfigured: true,
        webhookConfigured: true,
      },
      requestId: "77777777-7777-4777-8777-777777777777",
      stripe: {
        accountId: null,
        chargesEnabled: false,
        detailsSubmitted: false,
        payoutsEnabled: false,
        requirementsDue: [],
        status: "not_started",
      },
    });
  });
  await page.route("**/api/organization/email-settings", async (route) => {
    await fulfillJson(route, {
      requestId: "77777777-7777-4777-8777-777777777777",
      settings: {
        customDomain: null,
        customDomainStatus: "none",
        dnsRecords: [],
        fromName: null,
        lastCheckedAt: null,
        replyToEmail: null,
        verifiedAt: null,
      },
    });
  });
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto("/admin/settings");
  const timezone = page.getByLabel("IANA timezone");
  await expect(timezone).toBeVisible();
  await timezone.selectOption("America/Chicago");
  await expect(page.getByRole("region", { name: "Unsaved changes" })).toBeVisible();

  // Pinned: cancel keeps the route, accept navigates.
  await page.locator(".signed-in-sidebar").getByRole("link", { name: "Roster" }).click();
  const confirm = page.getByRole("dialog", { name: "Leave with unsaved changes?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/admin\/settings$/);
  await expect(page.getByRole("region", { name: "Unsaved changes" })).toBeVisible();

  await page.locator(".signed-in-sidebar").getByRole("link", { name: "Roster" }).click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(/\/admin\/roster$/);
  api.assertNoUnexpectedRequests();
});

test("drawer dirty cancel keeps drawer open; accept closes it", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.route("**/api/organization/transaction-fee-settings", async (route) => {
    await fulfillJson(route, {
      fixedCents: 30,
      passFeeToDonor: false,
      percentage: 2.9,
      requestId: "77777777-7777-4777-8777-777777777777",
    });
  });
  await page.route("**/api/organization/payment-settings", async (route) => {
    await fulfillJson(route, {
      activations: { donations: false, dues: false, tickets: false },
      environment: "local",
      externalEffectsMode: "fake",
      globalPaymentsEnabled: true,
      organizationName: "Alpha Choir",
      readiness: {
        brevoConfigured: true,
        stripeAccountReady: false,
        stripeConfigured: true,
        webhookConfigured: true,
      },
      requestId: "77777777-7777-4777-8777-777777777777",
      stripe: {
        accountId: null,
        chargesEnabled: false,
        detailsSubmitted: false,
        payoutsEnabled: false,
        requirementsDue: [],
        status: "not_started",
      },
    });
  });
  await page.route("**/api/organization/email-settings", async (route) => {
    await fulfillJson(route, {
      requestId: "77777777-7777-4777-8777-777777777777",
      settings: {
        customDomain: null,
        customDomainStatus: "none",
        dnsRecords: [],
        fromName: null,
        lastCheckedAt: null,
        replyToEmail: null,
        verifiedAt: null,
      },
    });
  });
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto("/admin/settings");
  await expect(page.getByLabel("IANA timezone")).toBeVisible();
  await page.getByLabel("IANA timezone").selectOption("America/Chicago");
  await expect(page.getByRole("region", { name: "Unsaved changes" })).toBeVisible();

  await page.getByRole("button", { name: "Unpin sidebar" }).click();
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "Roster" }).click();
  const confirm = page.getByRole("dialog", { name: "Leave with unsaved changes?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/admin\/settings$/);
  await expect(drawer).toBeVisible();

  await drawer.getByRole("link", { name: "Roster" }).click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(/\/admin\/roster$/);
  await expect(drawer).toHaveCount(0);
  api.assertNoUnexpectedRequests();
});

test("search works from pinned and drawer with shortcut and focus restoration", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto("/admin/roster");

  // Pinned sidebar trigger opens the palette; Escape restores focus.
  const sidebarSearch = page.locator(".signed-in-sidebar").getByRole("button", {
    name: "Quick search",
  });
  await expect(sidebarSearch).toBeVisible();
  await sidebarSearch.click();
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  await expect(palette).toBeVisible();
  await expect(page.locator("#admin-command-palette-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(sidebarSearch).toBeFocused();

  // Keyboard shortcut toggles from the header; closing restores a visible control.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);

  // Drawer-to-palette handoff closes the drawer and restores the trigger.
  await page.getByRole("button", { name: "Unpin sidebar" }).click();
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Quick search" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open workspace navigation" })).toBeFocused();
  api.assertNoUnexpectedRequests();
});

test("exactly one current link on nested routes; modified click stays put", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto("/admin/settings/modules");
  const sidebar = page.locator(".signed-in-sidebar");
  await expect(sidebar.locator('a[aria-current="page"]')).toHaveCount(1);
  await expect(sidebar.locator('a[aria-current="page"]')).toHaveAttribute(
    "href",
    "/admin/settings/modules",
  );

  await page.getByRole("button", { name: "Unpin sidebar" }).click();
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  const eventsLink = drawer.getByRole("link", { name: "Events" });
  await expect(eventsLink).toBeVisible();
  await eventsLink.click({ modifiers: ["Meta"] });
  await expect(page).toHaveURL(/\/admin\/settings\/modules$/);
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('a[aria-current="page"]')).toHaveCount(1);
  api.assertNoUnexpectedRequests();
});

test("long list keeps header fixed, reveals active, and reaches the last destination", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.setViewportSize({ height: 600, width: 1280 });
  await page.goto("/admin/roster");
  const scrollRegion = page.locator(".signed-in-sidebar .sidebar-nav-scroll");
  await expect(scrollRegion).toBeVisible();
  const scrollable = await scrollRegion.evaluate(
    (node) => node.scrollHeight > node.clientHeight + 20,
  );
  expect(scrollable).toBe(true);

  // Header and search stay stationary while the list scrolls.
  const headerTopBefore = await page
    .locator(".signed-in-sidebar .sidebar-header")
    .evaluate((node) => node.getBoundingClientRect().top);
  await scrollRegion.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const headerTopAfter = await page
    .locator(".signed-in-sidebar .sidebar-header")
    .evaluate((node) => node.getBoundingClientRect().top);
  expect(Math.abs(headerTopAfter - headerTopBefore)).toBeLessThanOrEqual(2);

  // The last destination is reachable by keyboard and navigates.
  const lastLink = page
    .locator(".signed-in-sidebar")
    .getByRole("link", { name: "Organization security" });
  await lastLink.scrollIntoViewIfNeeded();
  await expect(lastLink).toBeVisible();
  await lastLink.focus();
  await expect(lastLink).toBeFocused();
  await lastLink.press("Enter");
  await expect(page).toHaveURL(/\/admin\/settings\/security$/);
  await expect(
    page.locator(".signed-in-sidebar").locator('a[aria-current="page"]'),
  ).toHaveAttribute("href", "/admin/settings/security");
  api.assertNoUnexpectedRequests();
});

test("workspace roles gate destinations without adding routes", async ({ page }) => {
  const memberApi = await installOrganizationApi(page, { role: "member", strict: true });
  memberApi.setSingerDashboard(buildSingerDashboardResponse({ organizationName: "Alpha Choir" }));
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Dashboard|Welcome back/ })).toBeVisible();
  // Member workspace exposes no Organization admin destinations.
  await expect(
    page.locator(".signed-in-sidebar").getByRole("link", { name: "Roster" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".signed-in-sidebar").getByRole("link", { name: "Dashboard" }),
  ).toBeVisible();
  memberApi.assertNoUnexpectedRequests();
});

test("disabled modules hide destinations without exposing new routes", async ({ page }) => {
  const api = await installOrganizationApi(page, {
    modules: ["roster"],
    role: "administrator",
    strict: true,
  });
  // Missing modules default to visible, so explicitly disable events to
  // exercise the module gate. Later routes shadow the strict guard.
  await page.route("**/api/organization/module-state", async (route) => {
    await fulfillJson(route, {
      modules: [
        { enabled: true, id: "roster" },
        { enabled: false, id: "events" },
      ],
    });
  });
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto("/admin/roster");
  const sidebar = page.locator(".signed-in-sidebar");
  await expect(sidebar.getByRole("link", { name: "Roster" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Events" })).toHaveCount(0);
  const hrefs = await sidebar
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(new Set(hrefs).size).toBe(hrefs.length);
  api.assertNoUnexpectedRequests();
});

test("breakpoints, long labels, zoom, keyboard, and reduced motion", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  const longOrgName =
    "Dr. Alexander Montgomery-Wellington III Memorial Choir Society of the Extended Valley";
  await page.route("**/api/organization/branding", async (route) => {
    await fulfillJson(route, { logoFileId: null, organizationName: longOrgName });
  });
  await page.route("**/api/setup/status", async (route) => {
    await fulfillJson(route, {
      allModulesConfigured: true,
      completedSteps: [],
      currentStep: null,
      launched: true,
      organizationId: "organization-alpha",
      organizationName: longOrgName,
    });
  });
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto("/admin/roster");

  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ height: 900, width });
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(overflow.scrollWidth, `horizontal overflow at ${String(width)}px`).toBeLessThanOrEqual(
      overflow.viewport + 1,
    );
  }

  // Breakpoint boundaries: 768px and below use drawer-only navigation.
  await page.setViewportSize({ height: 900, width: 767 });
  await expect(page.locator(".signed-in-sidebar")).toBeHidden();
  await page.setViewportSize({ height: 900, width: 769 });
  await expect(page.locator(".signed-in-sidebar")).toBeVisible();

  // Long organization names wrap without clipping the controls.
  await page.setViewportSize({ height: 900, width: 1280 });
  const orgLabel = page.locator(".signed-in-sidebar .sidebar-context__org");
  await expect(orgLabel).toContainText("Montgomery-Wellington");
  const labelBox = await orgLabel.boundingBox();
  const headerBox = await page.locator(".signed-in-sidebar .sidebar-header").boundingBox();
  expect(labelBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  if (labelBox && headerBox) {
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 1);
  }

  // 200% zoom keeps navigation usable without horizontal overflow.
  await page.evaluate(() => {
    document.body.style.zoom = "200%";
  });
  await page.waitForTimeout(150);
  const zoomed = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(zoomed.scrollWidth).toBeLessThanOrEqual(zoomed.viewport + 2);
  await page.evaluate(() => {
    document.body.style.zoom = "";
  });

  // Keyboard-only: trigger opens the drawer and Escape returns focus.
  await page.getByRole("button", { name: "Unpin sidebar" }).click();
  await expect(page.getByRole("dialog", { name: "Workspace navigation" })).toBeVisible();
  await page.keyboard.press("Escape");
  const trigger = page.getByRole("button", { name: "Open workspace navigation" });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Workspace navigation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  // Reduced motion disables sidebar and palette transitions.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await trigger.click();
  const sheet = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(sheet).toBeVisible();
  const transition = await page.locator(".sheet").evaluate((node) => {
    const style = window.getComputedStyle(node);
    return { animation: style.animationName, transition: style.transitionDuration };
  });
  expect(["none", "0s"]).toContain(transition.transition);
  await page.keyboard.press("Escape");
  api.assertNoUnexpectedRequests();
});

test("light and dark themes keep navigation readable", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto("/admin/roster");
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((next) => {
      document.documentElement.dataset.theme = next;
      document.querySelector(".signed-in-shell")?.setAttribute("data-theme", next);
    }, theme);
    await page.waitForTimeout(100);
    await expect(page.locator(".signed-in-sidebar")).toBeVisible();
    await expect(page.locator(".signed-in-sidebar a[aria-current='page']")).toBeVisible();
    const colors = await page
      .locator(".signed-in-sidebar .workspace-nav__items a")
      .first()
      .evaluate((node) => {
        const style = window.getComputedStyle(node);
        return { background: style.backgroundColor, color: style.color };
      });
    expect(colors.color).not.toBe(colors.background);
  }
  api.assertNoUnexpectedRequests();
});
