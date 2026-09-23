import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import {
  buildInvitationActionResponse,
  buildInvitationCreateResponse,
  buildInvitationSummary,
} from "./fixtures/builders";
import { fulfillJson } from "./fixtures/session";

const invitationRequestId = "55555555-5555-4555-8555-555555555555";

test("enrolls, verifies, and safely manages an Organization MFA policy", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "owner", strict: true });
  // This journey starts with an empty invitation list; the create/cancel request assertions
  // below are the differing behavior, the surrounding workspace comes from the fixtures.
  api.invitations.set([]);
  await page.route("**/api/organization/invitations", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        invitations: api.invitations.get(),
        requestId: invitationRequestId,
        truncated: false,
      });
      return;
    }
    expect(route.request().postDataJSON()).toEqual({
      email: "future.member@example.test",
      role: "administrator",
    });
    const created = buildInvitationSummary({});
    api.invitations.set([...api.invitations.get(), created]);
    await fulfillJson(route, buildInvitationCreateResponse(created.id, invitationRequestId), 201);
  });
  await page.route("**/api/organization/invitations/*", async (route) => {
    const invitationId =
      new URL(route.request().url()).pathname.split("/").filter(Boolean)[3] ?? "";
    const invitationIndex = api.invitations
      .get()
      .findIndex((invitation) => invitation.id === invitationId);
    expect(route.request().method()).toBe("DELETE");
    expect(invitationIndex).toBeGreaterThanOrEqual(0);
    api.invitations.set(
      api.invitations.get().filter((invitation) => invitation.id !== invitationId),
    );
    await fulfillJson(
      route,
      buildInvitationActionResponse(invitationId, "canceled", invitationRequestId),
    );
  });

  await page.goto("/admin/settings/security");
  const organizationSection = page.getByRole("region", { name: "Organization security" });
  await expect(organizationSection.getByText("MFA not required")).toBeVisible();
  const organizationPolicy = organizationSection.getByRole("group", {
    name: "Organization MFA policy",
  });
  await expect(organizationPolicy).toBeVisible();
  await expect(organizationPolicy.locator("legend")).toHaveText("Organization MFA policy");

  await page.goto("/admin/roster");
  const rosterPage = page.getByRole("main");
  await expect(rosterPage.getByRole("button", { name: "Add Profile" })).toBeVisible();
  await rosterPage.getByRole("button", { name: "Add Profile" }).click();
  const profileDialog = page.getByRole("dialog", { name: "Add Profile" });
  await expect(profileDialog).toBeVisible();
  await profileDialog.getByLabel("Display name").fill("Changed profile");
  const discardDialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await page.keyboard.press("Escape");
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(profileDialog).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(profileDialog).toHaveCount(0);
  await expect(rosterPage.getByRole("link", { name: "Export CSV" })).toHaveAttribute(
    "href",
    "/api/organization/profiles/export.csv",
  );

  await page.goto("/admin/events");
  const eventsPage = page.getByRole("main");
  await expect(eventsPage.getByRole("heading", { name: "Events" })).toBeVisible();
  await eventsPage.getByRole("checkbox", { name: "Show past events", exact: true }).check();
  const eventRsvpLink = eventsPage.getByRole("link", { name: "RSVP", exact: true }).first();
  await expect(eventRsvpLink).toHaveAttribute(
    "href",
    "/admin/rsvp?eventId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  await eventRsvpLink.click();
  await expect(page).toHaveURL(/\/admin\/rsvp\?eventId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa$/);
  const linkedRsvpPage = page.getByRole("main");
  await expect(
    linkedRsvpPage.locator(".rsvp-manager__balance").getByRole("combobox", { name: "Performance" }),
  ).toHaveValue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  await expect(linkedRsvpPage.getByRole("group", { name: "RSVP roster" })).toBeVisible();
  await expect(
    linkedRsvpPage.getByText(/Administrators can still override responses\./),
  ).toBeVisible();
  await expect(
    linkedRsvpPage.getByRole("link", { name: "Roster Settings", exact: true }),
  ).toHaveCount(0);
  const rsvpBalance = linkedRsvpPage.locator(".rsvp-manager__balance");
  const rsvpRoster = linkedRsvpPage.locator(".rsvp-manager__roster");
  const visibleRsvpContent = rsvpRoster.locator(".data-table:visible, .data-table-cards:visible");
  const expectVisibleRsvpName = async (name: string) => {
    const nameLocator = visibleRsvpContent.getByText(name, { exact: true });
    await nameLocator.scrollIntoViewIfNeeded();
    await expect(nameLocator).toBeVisible();
  };
  await rsvpBalance.getByRole("button", { name: "Sopranos 1", exact: true }).click();
  await expectVisibleRsvpName("Browser Singer");
  await expect(visibleRsvpContent.getByText("Unexpected Singer", { exact: true })).toHaveCount(0);
  await expect(
    rsvpBalance.getByRole("button", { name: "Sopranos 1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await rsvpBalance.getByRole("button", { name: "S2 1", exact: true }).click();
  await expectVisibleRsvpName("Browser Singer");
  await expect(visibleRsvpContent.getByText("Unexpected Singer", { exact: true })).toHaveCount(0);
  await rsvpBalance.getByRole("button", { name: "A1 1", exact: true }).click();
  await expectVisibleRsvpName("Unexpected Singer");
  await expect(visibleRsvpContent.getByText("Browser Singer", { exact: true })).toHaveCount(0);
  await rsvpBalance.getByRole("button", { name: "A1 1", exact: true }).click();
  await expectVisibleRsvpName("Browser Singer");
  await expectVisibleRsvpName("Unexpected Singer");
  await expectVisibleRsvpName("Unassigned Singer");
  const unassignedRsvpEntry = visibleRsvpContent
    .locator("tr, .data-table-card")
    .filter({ hasText: "Unassigned Singer" });
  await expect(unassignedRsvpEntry).toContainText("Assign a part before managing RSVP.");
  await expect(unassignedRsvpEntry.getByRole("button")).toHaveCount(0);
  await page.goto("/admin/events");
  const eventsPageAfterRsvp = page.getByRole("main");
  await expect(eventsPageAfterRsvp.getByRole("heading", { name: "Events" })).toBeVisible();
  await eventsPageAfterRsvp
    .getByRole("checkbox", { name: "Show past events", exact: true })
    .check();
  await eventsPage.getByRole("button", { name: "Bulk add rehearsals" }).click();
  const bulkRehearsalDialog = page.getByRole("dialog", { name: "Bulk add rehearsals" });
  await expect(bulkRehearsalDialog.getByRole("combobox", { name: "Day of week" })).toHaveValue("");
  await bulkRehearsalDialog
    .getByRole("combobox", { name: "Day of week" })
    .selectOption({ label: "Wednesday" });
  await bulkRehearsalDialog.getByRole("button", { name: "Cancel" }).click();
  const browserConcertEdit = eventsPage.locator(
    '[aria-label="Edit event Browser Concert"]:visible',
  );
  await expect(browserConcertEdit).toBeVisible();
  await expect(browserConcertEdit.getByRole("link", { name: "RSVP", exact: true })).toBeVisible();
  await expect(browserConcertEdit.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(
    browserConcertEdit.getByRole("button", { name: "More actions for Browser Concert" }),
  ).toBeVisible();
  await expect(browserConcertEdit.getByRole("button", { name: "Clone", exact: true })).toHaveCount(
    0,
  );
  await browserConcertEdit.getByRole("button", { name: "Edit", exact: true }).click();
  const eventEditor = page.getByRole("dialog", { name: "Edit event" });
  await expect(eventEditor.getByLabel("Member RSVP deadline")).toHaveValue("2027-08-13");
  await expect(eventEditor.getByText("Ticket page and QR code")).toBeVisible();
  const ticketPageLink = eventEditor.locator(
    'a[href$="/tickets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]',
  );
  await expect(ticketPageLink).toBeVisible();
  await expect(ticketPageLink).toHaveAttribute("target", "_blank");
  await expect(eventEditor.getByRole("button", { name: "Download QR code" })).toBeVisible();
  await expect(eventEditor.locator(".event-graphic-dropzone")).toContainText(
    "Drag and drop an image here",
  );
  await eventEditor.locator("#events-page-graphic").setInputFiles({
    buffer: Buffer.from("browser concert graphic"),
    mimeType: "image/png",
    name: "browser-concert.png",
  });
  await expect(eventEditor.getByText("Selected: browser-concert.png")).toBeVisible();
  await eventEditor.getByRole("button", { name: "Remove selected image" }).click();
  await eventEditor.locator(".event-graphic-dropzone").evaluate((dropzone) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File(["dropped graphic"], "dropped-concert.png", { type: "image/png" }),
    );
    dropzone.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
    );
  });
  await expect(eventEditor.getByText("Selected: dropped-concert.png")).toBeVisible();
  await eventEditor.getByRole("button", { name: "Remove selected image" }).click();
  await expect(eventEditor.getByRole("region", { name: "Unsaved event changes" })).toHaveCount(0);
  await eventEditor.getByLabel("Title").fill("Browser Concert draft");
  const eventSaveBar = eventEditor.getByRole("region", { name: "Unsaved event changes" });
  await expect(eventSaveBar).toBeVisible();
  await expect(eventSaveBar.getByText("Unsaved changes")).toBeVisible();
  await expect(eventSaveBar.getByRole("button", { name: "Save event", exact: true })).toBeVisible();
  await eventEditor.getByLabel("Title").fill("Browser Concert");
  await expect(eventSaveBar).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(eventEditor).toHaveCount(0);
  await page.goto("/admin/attendance");
  const attendancePage = page.getByRole("main");
  await expect(attendancePage.getByRole("heading", { name: "Attendance" })).toBeVisible();
  await expect(attendancePage.locator(".attendance-manager__sync")).toContainText(
    "Live updates every 30 seconds",
  );
  const markRemainingPresent = attendancePage.getByRole("button", {
    name: "Mark remaining present",
    exact: true,
  });
  await expect(markRemainingPresent).toBeEnabled();
  await markRemainingPresent.click();
  const attendanceConfirmation = page.getByRole("dialog", { name: "Mark remaining present?" });
  await expect(attendanceConfirmation).toBeVisible();
  await expect(attendanceConfirmation).toContainText("This will mark 1 performer");
  await attendanceConfirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(attendanceConfirmation).toBeHidden();
  await markRemainingPresent.click();
  await attendanceConfirmation
    .getByRole("button", { name: "Mark remaining present", exact: true })
    .click();
  await expect(attendanceConfirmation).toBeHidden();
  await attendancePage.getByRole("button", { name: "Present 1", exact: true }).click();
  await expect(
    attendancePage.getByRole("button", { name: /Browser Singer: Present/ }),
  ).toBeVisible();
  await expect(attendancePage.getByRole("button", { name: "All 1", exact: true })).toBeVisible();
  await attendancePage.getByRole("button", { name: "All 1", exact: true }).click();
  const unexpectedSinger = attendancePage.getByRole("button", {
    name: /Unexpected Singer: Tap to check in/,
  });
  await expect(unexpectedSinger).toHaveCount(0);
  await expect(attendancePage.getByRole("separator", { name: "Not currently RSVP'd" })).toHaveCount(
    0,
  );
  await attendancePage.getByRole("searchbox", { name: "Find a performer" }).fill("Unexpected");
  await expect(unexpectedSinger).toBeVisible();
  await expect(unexpectedSinger).toContainText("Not currently RSVP'd");
  await expect(
    attendancePage.getByRole("separator", { name: "Not currently RSVP'd" }),
  ).toBeVisible();
  await expect(attendancePage.getByRole("dialog")).toHaveCount(0);
  await unexpectedSinger.click();
  const rescueConfirmation = page.getByRole("dialog", {
    name: "Mark unexpected attendee present?",
  });
  await expect(rescueConfirmation).toBeVisible();
  await expect(rescueConfirmation).toContainText("Unexpected Singer");
  await expect(rescueConfirmation).toContainText("will RSVP them Yes");
  await rescueConfirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(rescueConfirmation).toBeHidden();
  await expect(unexpectedSinger).toContainText("Not currently RSVP'd");
  await unexpectedSinger.click();
  await rescueConfirmation
    .getByRole("button", { name: "Mark present and RSVP", exact: true })
    .click();
  await expect(rescueConfirmation).toBeHidden();
  await expect(
    attendancePage.getByRole("button", { name: /Unexpected Singer: Present/ }),
  ).toBeVisible();
  await page.goto("/admin/events");
  await expect(eventsPage.getByRole("heading", { name: "Events" })).toBeVisible();
  await eventsPage.getByRole("checkbox", { name: "Show past events", exact: true }).check();
  await browserConcertEdit
    .getByRole("button", { name: "More actions for Browser Concert" })
    .click();
  await page.getByRole("menuitem", { name: "Clone", exact: true }).click();
  const cloneDialog = page.getByRole("dialog", { name: "Clone event" });
  await expect(cloneDialog).toBeVisible();
  await cloneDialog.getByRole("button", { name: "Close" }).click();
  await expect(cloneDialog).toHaveCount(0);
  await browserConcertEdit
    .getByRole("button", { name: "More actions for Browser Concert" })
    .click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Archive event?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/admin/venues");
  const venuesPage = page.getByRole("main");
  await expect(venuesPage.getByRole("heading", { name: "Venues" })).toBeVisible();
  await venuesPage.locator('button:has-text("Delete"):visible').click();
  await expect(page.getByRole("dialog", { name: "Delete venue?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.setViewportSize({ height: 734, width: 844 });
  await page.goto("/admin/events/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/roster");
  const collapseNavigation = page.getByRole("button", {
    name: "Collapse navigation",
  });
  await expect(collapseNavigation).toBeVisible();
  await expect(page.locator(".signed-in-header")).toHaveCSS("height", "60px");
  await expect(page.locator(".signed-in-sidebar")).toHaveCSS("top", "60px");
  await expect(page.locator(".sidebar-toolbar__button--pin path")).toHaveAttribute(
    "d",
    "M8 4h8v5l3 3H5l3-3V4M12 12v8",
  );
  await collapseNavigation.click();
  await expect(page.locator(".signed-in-sidebar")).toHaveCount(0);
  const openNavigation = page.getByRole("button", { name: "Open workspace navigation" });
  await expect(openNavigation).toBeVisible();
  await openNavigation.click();
  const navigationDrawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(navigationDrawer).toBeVisible();
  const pinNavigation = navigationDrawer.getByRole("button", { name: "Keep sidebar open" });
  const closeNavigation = navigationDrawer.getByRole("button", {
    name: "Close Workspace navigation",
  });
  await expect(pinNavigation).toHaveClass(/sidebar-drawer__pin/);
  // Coarse pointers use larger touch targets (46px); fine pointers use 36px.
  await expect(pinNavigation).toHaveCSS("width", /^(36|46)px$/);
  await expect(closeNavigation).toHaveCSS("width", "36px");
  await expect(closeNavigation).toHaveCSS("height", "36px");
  await expect(pinNavigation.locator("svg")).toHaveCSS("overflow", "visible");
  await expect(pinNavigation.locator("path")).toHaveAttribute("d", "M8 4h8v5l3 3H5l3-3V4M12 12v8");

  const desktopPinBox = await pinNavigation.boundingBox();
  const desktopCloseBox = await closeNavigation.boundingBox();
  const desktopDrawerBox = await navigationDrawer.boundingBox();
  expect(desktopPinBox).not.toBeNull();
  expect(desktopCloseBox).not.toBeNull();
  expect(desktopDrawerBox).not.toBeNull();
  if (!desktopPinBox || !desktopCloseBox || !desktopDrawerBox) {
    throw new Error("Workspace navigation controls should have visible geometry");
  }
  expect(Math.abs(desktopPinBox.y - desktopCloseBox.y)).toBeLessThanOrEqual(1);
  expect(desktopCloseBox.x - (desktopPinBox.x + desktopPinBox.width)).toBeGreaterThanOrEqual(7);
  expect(desktopCloseBox.x - (desktopPinBox.x + desktopPinBox.width)).toBeLessThanOrEqual(9);
  expect(desktopPinBox.x).toBeGreaterThanOrEqual(desktopDrawerBox.x);
  expect(desktopCloseBox.x + desktopCloseBox.width).toBeLessThanOrEqual(
    desktopDrawerBox.x + desktopDrawerBox.width,
  );

  await page.setViewportSize({ height: 734, width: 390 });
  // Narrow viewports use drawer-only navigation: the pin control is hidden
  // while the drawer and its close button stay usable.
  await expect(pinNavigation).toHaveCount(0);
  await expect(closeNavigation).toBeVisible();
  await expect(navigationDrawer).toBeVisible();

  await page.setViewportSize({ height: 734, width: 844 });
  await expect(pinNavigation).toBeVisible();
  await pinNavigation.click();
  await expect(navigationDrawer).toHaveCount(0);
  await expect(collapseNavigation).toBeVisible();
  await page.reload();
  await expect(collapseNavigation).toBeVisible();

  const rsvpPage = page.getByRole("main");
  const performanceSelect = rsvpPage
    .locator(".rsvp-manager__balance")
    .getByRole("combobox", { name: "Performance" });
  await expect(performanceSelect).toHaveValue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  await expect(performanceSelect).toHaveCSS("appearance", "auto");
  await expect(rsvpPage.locator(".rsvp-manager__roster").getByRole("combobox")).toHaveCount(0);
  await expect(rsvpPage.getByRole("textbox", { name: "Search active singers" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Export CSV" })).toHaveAttribute(
    "href",
    "/api/organization/events/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/rsvp-export.csv?sort=lastName",
  );
  const historyTab = rsvpPage
    .getByRole("tab", { name: "History", exact: true })
    .or(rsvpPage.getByRole("button", { name: "History", exact: true }));
  await historyTab.click({ force: true });
  const historySection = rsvpPage.locator(".rsvp-manager__history");
  await expect(historySection.getByRole("heading", { name: "Event RSVP History" })).toHaveCount(1);
  const historySearch = historySection.getByRole("searchbox", { name: "Search history" });
  await expect(historySearch).toBeVisible();
  await expect(historySection.getByRole("columnheader", { name: /Changed/ })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await historySearch.fill("Browser Singer");
  await expect(
    historySection.locator("strong:visible").filter({ hasText: "Browser Singer" }),
  ).toBeVisible();
  await expect(
    historySection.locator("strong:visible").filter({ hasText: "Unexpected Singer" }),
  ).toHaveCount(0);
  await historySearch.fill("");
  await historySection.getByRole("combobox", { name: "Filter new RSVP" }).selectOption("No");
  await expect(
    historySection.locator("strong:visible").filter({ hasText: "Unexpected Singer" }),
  ).toBeVisible();
  await expect(
    historySection.locator("strong:visible").filter({ hasText: "Browser Singer" }),
  ).toHaveCount(0);
  await historySection.getByRole("button", { name: "Sort by Performer" }).click();
  await expect(historySection.getByRole("columnheader", { name: /Performer/ })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );

  await page.goto("/admin/settings/invitations");
  const invitationSection = page.getByRole("group", { name: "Invite a member" });
  await expect(invitationSection.getByLabel("Email address")).toBeVisible();
  await invitationSection.getByLabel("Email address").fill("future.member@example.test");
  await invitationSection
    .getByLabel("Organization role")
    .selectOption({ label: "Organization Administrator" });
  await invitationSection.getByRole("button", { name: "Create invitation" }).click();
  await expect(
    invitationSection.getByRole("status").filter({ hasText: "Invitation created" }),
  ).toContainText("Invitation created for future.member@example.test");

  await page.goto("/admin/settings/setup-checklist");
  const providerStatus = page.getByRole("group", { name: "Payments and email setup" });
  await expect(providerStatus.getByText("Platform-managed setup:")).toBeVisible();
  await expect(providerStatus.getByText("How platform setup works")).toHaveCount(0);

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  api.assertNoUnexpectedRequests();
});
