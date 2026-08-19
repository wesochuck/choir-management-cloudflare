import { expect, test, type Route } from "@playwright/test";

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const organizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const eventId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const firstTemplateId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const secondTemplateId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const auditionTemplateId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const donationTemplateId = "11111111-1111-4111-8111-111111111111";
const smsTemplateId = "55555555-5555-4555-8555-555555555555";
const historyMessageId = "22222222-2222-4222-8222-222222222222";
const queuedMessageId = "33333333-3333-4333-8333-333333333333";
const secondQueuedMessageId = "44444444-4444-4444-8444-444444444444";

const session = {
  session: {
    activeOrganizationId: organizationId,
    createdAt: "2026-07-20T20:00:00.000Z",
    expiresAt: "2026-07-27T20:00:00.000Z",
    id: "session-communications",
    ipAddress: "192.0.2.40",
    token: "communications-token-not-displayed",
    updatedAt: "2026-07-20T20:00:00.000Z",
    userAgent: "Chromium browser",
    userId: "user-communications-admin",
  },
  user: {
    createdAt: "2026-07-20T19:00:00.000Z",
    email: "communications.admin@example.test",
    emailVerified: true,
    id: "user-communications-admin",
    image: null,
    name: "Communications Administrator",
    twoFactorEnabled: false,
    updatedAt: "2026-07-20T19:00:00.000Z",
  },
};

const queuedMessage = {
  audience: {
    eventId: null,
    globalStatuses: ["Active"],
    profileIds: [],
    rsvp: "All",
    targetAudiences: ["Members"],
    voiceParts: [],
  },
  channel: "Email",
  contentMarkdown: "Hello queued recipients.",
  createdAt: "2026-08-14T18:12:00.000Z",
  id: queuedMessageId,
  reach: { both: 0, email: 2, sms: 0, total: 2, unreachable: 0 },
  requestId,
  sentAt: null,
  status: "Queued",
  subject: "Queued announcement",
  updatedAt: "2026-08-14T18:12:00.000Z",
} as const;

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });
}

async function handleRoute(route: Route, previewBodies: unknown[]): Promise<void> {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname === "/api/public/projection") {
    await route.fulfill({ status: 404 });
    return;
  }
  if (pathname === "/api/organization/communications/reach-preview") {
    previewBodies.push(route.request().postDataJSON());
    await fulfillJson(route, {
      both: 0,
      email: 2,
      requestId,
      sms: 0,
      total: 2,
      unreachable: 0,
    });
    return;
  }
  if (pathname === "/api/organization/communications/send") {
    await fulfillJson(route, queuedMessage, 202);
    return;
  }

  const responses: Record<string, unknown> = {
    "/api/account/organizations": {
      organizations: [
        {
          canonicalHostname: "communications.example.test",
          canonicalStatus: "active",
          lifecycleState: "active",
          name: "Communications Choir",
          organizationId,
          profileId: null,
          role: "administrator",
          slug: "communications",
        },
      ],
    },
    "/api/auth/get-session": session,
    "/api/health": {
      environment: "local",
      requestId,
      service: "choir-management-cloudflare",
      status: "ok",
      version: "browser-test",
    },
    "/api/organization/auth-status": {
      mfaRequired: false,
      mfaVerifiedUntil: null,
      organizationId,
      requestId,
      role: "administrator",
      twoFactorEnabled: false,
      twoFactorVerified: false,
    },
    "/api/organization/communications": { messages: [], requestId },
    "/api/organization/communications/scheduled": { messages: [], requestId },
    "/api/organization/communications/templates": {
      requestId,
      templates: [
        {
          channel: "Email",
          contentMarkdown: "Hello from the first template.",
          createdAt: "2026-07-20T20:00:00.000Z",
          id: firstTemplateId,
          isSystem: false,
          subject: "First template",
          title: "First template",
          updatedAt: "2026-07-20T20:00:00.000Z",
        },
        {
          channel: "Email",
          contentMarkdown: "Hello from the second template.",
          createdAt: "2026-07-20T20:00:00.000Z",
          id: secondTemplateId,
          isSystem: false,
          subject: "Second template",
          title: "Second template",
          updatedAt: "2026-07-20T20:00:00.000Z",
        },
        {
          channel: "Email",
          contentMarkdown: "Your audition is confirmed for {auditionDate}.",
          createdAt: "2026-07-20T20:00:00.000Z",
          id: auditionTemplateId,
          isSystem: true,
          subject: "Your audition is confirmed",
          title: "Audition Confirmed",
          updatedAt: "2026-07-20T20:00:00.000Z",
        },
        {
          channel: "Email",
          contentMarkdown: "Thank you for your donation to {organizationName}.",
          createdAt: "2026-07-20T20:00:00.000Z",
          id: donationTemplateId,
          isSystem: true,
          subject: "Donation receipt from {organizationName}",
          title: "Donation Payment Receipt",
          updatedAt: "2026-07-20T20:00:00.000Z",
        },
        {
          channel: "SMS",
          contentMarkdown: "Reminder: rehearsal starts at 7 PM.",
          createdAt: "2026-07-20T20:00:00.000Z",
          id: smsTemplateId,
          isSystem: false,
          subject: "",
          title: "Text reminder",
          updatedAt: "2026-07-20T20:00:00.000Z",
        },
      ],
    },
    "/api/organization/events": {
      events: [
        {
          advancePriceCents: 0,
          callTime: "",
          createdAt: "2026-07-20T20:00:00.000Z",
          dayOfPriceCents: 0,
          details: "",
          doorsOpenTime: "",
          durationMinutes: null,
          id: eventId,
          isCanceled: false,
          isTicketingEnabled: false,
          location: "Main Hall",
          parentPerformanceId: null,
          publicDetails: "",
          publicGraphicFileId: null,
          publishOnWebsite: false,
          rsvpDeadlineAt: null,
          rsvpDeadlineDate: null,
          rsvpDeadlinePassed: false,
          rsvpFollowUpLeadHours: null,
          rsvpFollowUpMode: "inherit",
          rsvpSelfServiceOpen: true,
          setList: [],
          setListApproved: false,
          startsAt: "2026-08-20T23:00:00.000Z",
          ticketCapacity: null,
          title: "Browser Performance",
          type: "Performance",
          updatedAt: "2026-07-20T20:00:00.000Z",
          venueId: null,
        },
      ],
      requestId,
    },
    "/api/organization/module-state": {
      modules: [
        { enabled: true, id: "events" },
        { enabled: true, id: "people" },
        { enabled: true, id: "programs" },
      ],
    },
    "/api/organization/provider-status": {
      brevo: { detail: "Sandbox provider", status: "ok" },
      emailSender: { fromEmail: null, fromName: null },
      environment: "local",
      externalEffectsMode: "fake",
      requestId,
      stripe: { detail: "Sandbox provider", status: "ok" },
    },
    "/api/organization/roster-configuration": {
      attendanceReportWarningThreshold: 3,
      onBreakTimeoutDays: 60,
      onBreakTimeoutEnabled: true,
      performerLabel: "Performer",
      requestId,
      rsvpExpiryEnabled: true,
      rsvpExpiryLeadDays: 3,
      rsvpFollowUpEnabled: false,
      rsvpFollowUpLeadHours: 48,
      sections: [{ code: "S", color: "#1b4d3e", name: "Sopranos", trackOnly: false }],
      statusAutomationEnabled: false,
      statusAutomationMissThreshold: 3,
      statusAutomationRecoveryEnabled: true,
      voiceParts: [{ fullName: "Soprano 1", label: "S1", sectionCode: "S" }],
    },
    "/api/platform/mfa/status": {
      activePlatformAdministrator: false,
      enrollmentComplete: false,
      requestId,
      twoFactorEnabled: false,
    },
    "/api/setup/status": {
      allModulesConfigured: true,
      completedSteps: [],
      currentStep: null,
      launched: true,
      organizationId,
      organizationName: "Communications Choir",
    },
  };
  await fulfillJson(
    route,
    responses[pathname] ?? { code: "not_found", message: "Not found", requestId },
    responses[pathname] ? 200 : 404,
  );
}

test("preserves all selected audiences when reach preview follows quick selection", async ({
  page,
}) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.goto("/admin/communications");
  const composeTab = page.getByRole("tab", { exact: true, name: "Compose" });
  await expect(composeTab).toHaveAttribute("aria-controls", "communication-compose-panel");
  await expect(page.locator("#communication-compose-panel")).toHaveAttribute(
    "aria-labelledby",
    "communication-compose-tab",
  );
  const audience = page.getByRole("group", { name: "Audience" });
  const ticketBuyers = audience.getByRole("checkbox", { name: "Ticket Buyers" });
  const donors = audience.getByRole("checkbox", { name: "Donors" });

  await expect(audience.getByRole("checkbox", { name: "Members" })).toBeChecked();
  await ticketBuyers.click();
  await donors.click();
  await page.getByRole("button", { name: "Preview audience reach" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Audience reach" })).toContainText(
    "2 reachable",
  );
  await expect(audience.getByRole("checkbox", { name: "Members" })).toBeChecked();
  await expect(ticketBuyers).toBeChecked();
  await expect(donors).toBeChecked();
  expect(previewBodies).toHaveLength(1);
  expect(previewBodies[0]).toEqual({
    audience: {
      eventId: null,
      globalStatuses: ["Active"],
      profileIds: [],
      rsvp: "All",
      targetAudiences: ["Members", "Ticket Buyers", "Donors"],
      voiceParts: [],
    },
    channel: "Email",
  });
});

test("starts each toolbar list item on a new line", async ({ page }) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.goto("/admin/communications");
  await page.getByRole("button", { name: "Continue to compose" }).click();

  const message = page.getByRole("textbox", { name: "Message body" });
  const listButton = page.getByRole("button", { name: "List" });
  await message.fill("- one");
  await message.press("End");

  await listButton.click();
  await expect(message).toHaveValue("- one\n- text");
  await listButton.click();
  await expect(message).toHaveValue("- one\n- text\n- text");
});

test("populates communication placeholders in the message preview", async ({ page }) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.goto("/admin/communications");
  await page.getByLabel("Event (optional)").selectOption(eventId);
  await page.getByRole("button", { name: "Continue to compose" }).click();

  const message = page.getByRole("textbox", { name: "Message body" });
  await message.fill(
    "Hi {singerName},\n{eventTitle} ({eventType}) on {eventDate} at {eventLocation}.",
  );
  await page.getByRole("tab", { name: "Preview", exact: true }).click();

  const preview = page.locator("#communication-composer-preview-panel");
  await expect(preview).toContainText("Alex Morgan");
  await expect(preview).toContainText("Browser Performance");
  await expect(preview).toContainText("Performance");
  await expect(preview).toContainText("Main Hall");
  await expect(preview).not.toContainText("{singerName}");
  await expect(preview).not.toContainText("{eventTitle}");
  await expect(preview).not.toContainText("{eventDate}");

  await page.getByRole("tab", { name: "Write", exact: true }).click();
  await page.getByLabel("Subject").fill("Rehearsal update");
  await page.getByRole("button", { name: "Preview before queueing" }).click();

  const finalPreview = page.getByRole("dialog", { name: "Final message preview" });
  await expect(finalPreview).toContainText("Alex Morgan");
  await expect(finalPreview).toContainText("Browser Performance");
  await expect(finalPreview).not.toContainText("{singerName}");
  await expect(finalPreview).not.toContainText("{eventTitle}");
});

test("shows the queued count and lets the user start another message", async ({ page }) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.goto("/admin/communications");
  await page.getByRole("button", { name: "Continue to compose" }).click();
  await page.getByLabel("Subject").fill("Queued announcement");
  await page.getByRole("textbox", { name: "Message body" }).fill("Hello queued recipients.");
  await page.getByRole("button", { name: "Preview before queueing" }).click();

  const finalPreview = page.getByRole("dialog", { name: "Final message preview" });
  await finalPreview.getByRole("button", { name: "Queue communication" }).click();

  const queuedResult = page.locator("#communication-queued-result");
  await expect(queuedResult.getByRole("heading", { name: "Communication queued" })).toBeVisible();
  await expect(queuedResult.getByRole("status")).toContainText(
    "2 recipients were queued for delivery.",
  );
  await expect(queuedResult).toContainText("Queued announcement");

  await queuedResult.getByRole("button", { name: "Send another message" }).click();
  await expect(page.getByRole("group", { name: "Audience" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to compose" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Communication queued" })).toHaveCount(0);
});

test("reuses the same idempotency key when queueing is retried", async ({ page }) => {
  const previewBodies: unknown[] = [];
  const idempotencyKeys: string[] = [];
  let sendAttempts = 0;
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/organization/communications/send") {
      idempotencyKeys.push(route.request().headers()["idempotency-key"] ?? "");
      sendAttempts += 1;
      if (sendAttempts === 1) {
        await fulfillJson(
          route,
          {
            code: "communication_temporarily_unavailable",
            message: "The communication could not be queued.",
            requestId,
          },
          503,
        );
        return;
      }
      await fulfillJson(route, queuedMessage, 202);
      return;
    }
    await handleRoute(route, previewBodies);
  });

  await page.goto("/admin/communications");
  await page.getByRole("button", { name: "Continue to compose" }).click();
  await page.getByLabel("Subject").fill("Retry-safe announcement");
  await page.getByRole("textbox", { name: "Message body" }).fill("Hello queued recipients.");
  await page.getByRole("button", { name: "Preview before queueing" }).click();

  const finalPreview = page.getByRole("dialog", { name: "Final message preview" });
  await finalPreview.getByRole("button", { name: "Queue communication" }).click();
  await expect(finalPreview.getByRole("alert")).toContainText(
    "The communication could not be queued.",
  );
  await finalPreview.getByRole("button", { name: "Queue communication" }).click();

  await expect(page.getByRole("heading", { name: "Communication queued" })).toBeVisible();
  expect(sendAttempts).toBe(2);
  expect(idempotencyKeys[0]).toBeTruthy();
  expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
});

test("shows recipient names in message history delivery details", async ({ page }) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/organization/communications") {
      await fulfillJson(route, {
        messages: [
          {
            audience: {
              eventId: null,
              globalStatuses: ["Active"],
              profileIds: [],
              rsvp: "All",
              targetAudiences: ["Members"],
              voiceParts: [],
            },
            channel: "Email",
            contentMarkdown: "Hello {singerName}",
            createdAt: "2026-08-14T18:12:00.000Z",
            id: historyMessageId,
            reach: { both: 0, email: 2, sms: 0, total: 2, unreachable: 0 },
            sentAt: "2026-08-14T18:12:00.000Z",
            status: "Sent",
            subject: "Rehearsal update",
            updatedAt: "2026-08-14T18:12:00.000Z",
          },
        ],
        requestId,
      });
      return;
    }
    if (pathname === "/api/organization/communications/" + historyMessageId + "/delivery-summary") {
      await fulfillJson(route, {
        email: { failed: 0, processing: 0, queued: 0, sent: 2, suppressed: 0, total: 2 },
        failures: [],
        hasMoreFailures: false,
        lastActivity: "2026-08-14T18:12:00.000Z",
        messageId: historyMessageId,
        provider: {
          accepted: 0,
          bounced: 0,
          complained: 0,
          deferred: 0,
          delivered: 2,
          failed: 0,
          rejected: 0,
          total: 2,
        },
        recipients: [
          {
            channel: "email",
            providerStatus: "delivered",
            recipientName: "Ada Alto",
            status: "sent",
          },
          {
            channel: "email",
            providerStatus: "delivered",
            recipientName: "Ben Bass",
            status: "sent",
          },
        ],
        sms: { failed: 0, processing: 0, queued: 0, sent: 0, suppressed: 0, total: 0 },
        state: "sent",
        total: { failed: 0, processing: 0, queued: 0, sent: 2, suppressed: 0, total: 2 },
        requestId,
      });
      return;
    }
    await handleRoute(route, previewBodies);
  });

  await page.goto("/admin/communications?tab=history");
  await expect(page.getByRole("tab", { exact: true, name: "History" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const messageRow = page.getByRole("listitem").filter({ hasText: "Rehearsal update" });
  await messageRow.getByRole("button", { name: "View delivery details" }).click();

  const deliveryDetails = messageRow.getByRole("region", {
    name: "Delivery details for Rehearsal update",
  });
  await expect(deliveryDetails).toBeVisible();
  await expect(deliveryDetails.getByText("Recipients (2)", { exact: true })).toBeVisible();
  await expect(deliveryDetails.getByText("Ada Alto", { exact: true })).toBeVisible();
  await expect(deliveryDetails.getByText("Ben Bass", { exact: true })).toBeVisible();
  await expect(deliveryDetails.getByText("Delivered", { exact: true })).toHaveCount(2);
  await expect(page.getByText("ada@example.test", { exact: true })).toHaveCount(0);
});

test("allows queued messages to be edited or canceled", async ({ page }) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/organization/communications") {
      await fulfillJson(route, {
        messages: [
          queuedMessage,
          {
            ...queuedMessage,
            id: secondQueuedMessageId,
            subject: "Queued follow-up",
          },
        ],
        requestId,
      });
      return;
    }
    if (pathname.endsWith("/cancel")) {
      const messageId = pathname.split("/").at(-2);
      const source =
        messageId === secondQueuedMessageId
          ? { ...queuedMessage, id: secondQueuedMessageId, subject: "Queued follow-up" }
          : queuedMessage;
      await fulfillJson(route, { ...source, requestId, status: "Canceled" });
      return;
    }
    await handleRoute(route, previewBodies);
  });

  await page.goto("/admin/communications?tab=history");
  const queuedRow = page.getByRole("listitem").filter({ hasText: "Queued announcement" });
  await queuedRow.getByRole("button", { name: "Edit & requeue" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit queued message?" });
  await expect(editDialog).toBeVisible();
  await editDialog.getByRole("button", { name: "Edit & requeue" }).click();

  await expect(page.getByRole("tab", { name: "Compose", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByLabel("Subject")).toHaveValue("Queued announcement");
  await expect(page.getByRole("textbox", { name: "Message body" })).toHaveValue(
    "Hello queued recipients.",
  );
  await expect(
    page.getByText(
      "Queued message canceled. Review it, make changes, and queue it again when ready.",
      { exact: true },
    ),
  ).toBeVisible();

  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Queued announcement" })).toContainText(
    "Canceled",
  );
  const followUpRow = page.getByRole("listitem").filter({ hasText: "Queued follow-up" });
  await followUpRow.getByRole("button", { name: "Cancel message" }).click();
  const cancelDialog = page.getByRole("dialog", { name: "Cancel queued message?" });
  await expect(cancelDialog).toBeVisible();
  await cancelDialog.getByRole("button", { name: "Cancel message" }).click();
  await expect(followUpRow).toContainText("Canceled");
  await expect(followUpRow.getByRole("button", { name: "Edit & requeue" })).toHaveCount(0);
});

test("uses an optional template picker and confirms before replacing a draft", async ({ page }) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.goto("/admin/communications");
  await page.getByRole("button", { name: "Continue to compose" }).click();

  const templatePicker = page.getByLabel("Choose a template (optional)");
  await expect(templatePicker).toHaveValue("");
  await expect(templatePicker).toContainText("First template");
  await expect(templatePicker).not.toContainText("Audition Confirmed");
  await expect(templatePicker).not.toContainText("Donation Payment Receipt");

  await templatePicker.selectOption(firstTemplateId);
  await expect(templatePicker).toHaveValue(firstTemplateId);
  await expect(page.getByLabel("Subject")).toHaveValue("First template");

  await templatePicker.selectOption(secondTemplateId);
  const replaceDialog = page.getByRole("dialog", { name: "Replace current draft?" });
  await expect(replaceDialog).toBeVisible();
  await expect(replaceDialog).toContainText("current message draft will be replaced");
  await replaceDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(templatePicker).toHaveValue(firstTemplateId);
  await expect(page.getByLabel("Subject")).toHaveValue("First template");

  await templatePicker.selectOption(secondTemplateId);
  await expect(replaceDialog).toBeVisible();
  await replaceDialog.getByRole("button", { name: "Replace draft" }).click();
  await expect(templatePicker).toHaveValue(secondTemplateId);
  await expect(page.getByLabel("Subject")).toHaveValue("Second template");
});

test("keeps audition system templates in the management tab only", async ({ page }) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.goto("/admin/communications?tab=templates");
  await expect(page.getByText("Audition Confirmed")).toBeVisible();
  await expect(page.getByText("Donation Payment Receipt")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use template" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit wording" }).first()).toBeVisible();
});

test("edits template wording in a dirty modal", async ({ page }) => {
  const previewBodies: unknown[] = [];
  let updateBody: unknown = null;
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (
      pathname === `/api/organization/communications/templates/${firstTemplateId}` &&
      route.request().method() === "PUT"
    ) {
      updateBody = route.request().postDataJSON();
      await fulfillJson(route, {
        channel: "Email",
        contentMarkdown: "Updated content.",
        createdAt: "2026-07-20T20:00:00.000Z",
        id: firstTemplateId,
        isSystem: false,
        requestId,
        subject: "Updated subject",
        title: "Updated title",
        updatedAt: "2026-08-18T20:00:00.000Z",
      });
      return;
    }
    await handleRoute(route, previewBodies);
  });

  await page.goto("/admin/communications?tab=templates");
  const templateRow = page.getByRole("listitem").filter({ hasText: "First template" });
  await templateRow.getByRole("button", { name: "Edit wording" }).click();

  const editor = page.getByRole("dialog", { name: "Edit template wording" });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Template name")).toHaveValue("First template");
  await expect(editor.getByRole("region", { name: "Unsaved template changes" })).toHaveCount(0);

  await editor.getByLabel("Template name").fill("Discarded title");
  const saveBar = editor.getByRole("region", { name: "Unsaved template changes" });
  await expect(saveBar).toBeVisible();
  await saveBar.getByRole("button", { name: "Cancel" }).click();

  const discardDialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(editor).toBeHidden();

  await templateRow.getByRole("button", { name: "Edit wording" }).click();
  await expect(editor).toBeVisible();
  await editor.getByLabel("Template name").fill("Updated title");
  await editor.getByLabel("Subject").fill("Updated subject");
  await editor.getByLabel("Message").fill("Updated content.");
  await editor
    .getByRole("region", { name: "Unsaved template changes" })
    .getByRole("button", { name: "Save template" })
    .click();

  await expect(editor).toBeHidden();
  await expect(page.getByText("Updated title", { exact: true })).toBeVisible();
  expect(updateBody).toEqual({
    channel: "Email",
    contentMarkdown: "Updated content.",
    subject: "Updated subject",
    title: "Updated title",
  });
});

test("searches and filters the template list", async ({ page }) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.goto("/admin/communications?tab=templates");
  const templatePanel = page.locator("#communication-templates-panel");
  const templateList = templatePanel.getByRole("list");
  const search = page.getByLabel("Search templates");

  await search.fill("first");
  await expect(templateList.getByText("First template", { exact: true })).toBeVisible();
  await expect(templateList.getByText("Second template", { exact: true })).toHaveCount(0);

  await search.fill("");
  await page.getByLabel("Template type").selectOption("system");
  await expect(templateList.getByText("Audition Confirmed", { exact: true })).toBeVisible();
  await expect(templateList.getByText("First template", { exact: true })).toHaveCount(0);

  await page.getByLabel("Template type").selectOption("all");
  await page.getByLabel("Template channel").selectOption("SMS");
  await expect(templateList.getByText("Text reminder", { exact: true })).toBeVisible();
  await expect(templateList.getByText("First template", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Clear template filters" }).click();
  await expect(templateList.getByText("First template", { exact: true })).toBeVisible();
  await expect(templateList.getByText("Text reminder", { exact: true })).toBeVisible();
});
