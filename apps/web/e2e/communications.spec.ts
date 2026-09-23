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

async function handleRoute(
  route: Route,
  previewBodies: unknown[],
  sendBodies: unknown[] = [],
): Promise<void> {
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
    sendBodies.push(route.request().postDataJSON());
    await fulfillJson(route, queuedMessage, 202);
    return;
  }
  if (pathname === "/api/organization/communications/test-email") {
    await fulfillJson(route, { requestId, sent: true }, 202);
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
    "/api/organization/email-settings": {
      requestId,
      settings: {
        customDomain: null,
        customDomainStatus: "none",
        dnsRecords: [],
        fromName: null,
        lastCheckedAt: null,
        replyToEmail: null,
        verifiedAt: null,
      },
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

test("preserves all selected audiences and automatically computes reach preview", async ({
  page,
}) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.goto("/admin/communications?tab=compose");
  await expect(page.getByRole("button", { exact: true, name: "Messages" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const recipientPanel = page.locator(".communication-recipient-panel");
  const ticketBuyers = recipientPanel.getByRole("checkbox", { name: "Ticket Buyers" });
  const donors = recipientPanel.getByRole("checkbox", { name: "Donors" });

  await expect(recipientPanel.getByRole("checkbox", { name: "Members" })).toBeChecked();
  const reachResponse = page.waitForResponse(
    (res) =>
      res.url().includes("/api/organization/communications/reach-preview") &&
      res.request().postData()?.includes("Donors") === true,
  );
  await ticketBuyers.click();
  await donors.click();
  await reachResponse;

  // Automatic reach calculation
  await expect(recipientPanel.getByRole("status")).toContainText("2 people can receive this email");
  await expect(recipientPanel.getByRole("checkbox", { name: "Members" })).toBeChecked();
  await expect(ticketBuyers).toBeChecked();
  await expect(donors).toBeChecked();

  await expect
    .poll(() => previewBodies[previewBodies.length - 1])
    .toMatchObject({
      audience: { targetAudiences: ["Members", "Ticket Buyers", "Donors"] },
    });
});

test("reviews and queues an event-specific ticket-holder service notice", async ({ page }) => {
  const previewBodies: unknown[] = [];
  const sendBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies, sendBodies));

  await page.goto("/admin/communications?tab=compose");
  const recipientPanel = page.locator(".communication-recipient-panel");
  const subject = page.getByLabel("Subject");
  const body = page.getByRole("textbox", { name: "Message body" });
  await subject.fill("Performance update");
  await body.fill("Your performance has been canceled.");

  await recipientPanel.getByRole("checkbox", { name: "Ticket Buyers" }).check();
  await recipientPanel.getByRole("checkbox", { name: "Members" }).uncheck();
  await recipientPanel
    .getByRole("radio", { name: "Important notice for current ticket holders" })
    .check();
  await expect(recipientPanel.getByLabel("Event (required)")).toBeVisible();
  await expect(
    recipientPanel.getByText("Select the affected performance to contact its ticket holders."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Review & send" })).toBeDisabled();

  const serviceReach = page.waitForResponse(
    (response) =>
      response.url().includes("/api/organization/communications/reach-preview") &&
      response.request().postData()?.includes('"ticketBuyerMode":"ticket_service"') === true,
  );
  await recipientPanel.getByLabel("Event (required)").selectOption(eventId);
  await serviceReach;
  await expect
    .poll(() => previewBodies[previewBodies.length - 1])
    .toMatchObject({
      audience: {
        eventId,
        targetAudiences: ["Ticket Buyers"],
        ticketBuyerMode: "ticket_service",
      },
      channel: "Email",
    });
  await expect(recipientPanel.getByRole("status")).toContainText(
    "2 ticket-holder recipients can receive this email",
  );

  await page.getByRole("button", { name: "Review & send" }).click();
  const review = page.getByRole("dialog", { name: "Review message" });
  await expect(review).toContainText("Important notice for current ticket holders");
  await expect(review).toContainText("paid ticket for the selected performance");
  await expect(review).toContainText("2 ticket-holder recipients can receive this email");
  await review.getByRole("button", { name: "Send to 2 recipients" }).click();
  await expect(page.getByRole("status")).toContainText("Message queued for 2 recipients.");
  expect(sendBodies).toHaveLength(1);
  expect(sendBodies[0]).toMatchObject({
    audience: {
      eventId,
      targetAudiences: ["Ticket Buyers"],
      ticketBuyerMode: "ticket_service",
    },
    channel: "Email",
  });
});

test("starts each toolbar list item on a new line", async ({ page }) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.goto("/admin/communications?tab=compose");

  const message = page.getByRole("textbox", { name: "Message body" });
  const listButton = page.getByRole("button", { name: "List" });
  await message.fill("- one");
  await message.press("End");

  await listButton.click();
  await expect(message).toHaveValue("- one\n- text");
  await listButton.click();
  await expect(message).toHaveValue("- one\n- text\n- text");
});

test("populates communication placeholders in the live message preview", async ({ page }) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.goto("/admin/communications?tab=compose");
  await page.getByLabel("Event (optional)").selectOption(eventId);

  const message = page.getByRole("textbox", { name: "Message body" });
  await message.fill(
    "Hi {singerName},\n{eventTitle} ({eventType}) on {eventDate} at {eventLocation}.",
  );

  // Check 2-column live preview panel
  const preview = page.locator(".communication-composer-preview-col .preview-body");
  await expect(preview).toContainText("Alex Morgan");
  await expect(preview).toContainText("Browser Performance");
  await expect(preview).toContainText("Performance");
  await expect(preview).toContainText("Main Hall");
  await expect(preview).not.toContainText("{singerName}");
  await expect(preview).not.toContainText("{eventTitle}");
  await expect(preview).not.toContainText("{eventDate}");

  await page.getByLabel("Subject").fill("Rehearsal update");
  await page.getByRole("button", { name: "Review & send" }).click();

  const finalPreview = page.getByRole("dialog", { name: "Review message" });
  await expect(finalPreview).toContainText("Alex Morgan");
  await expect(finalPreview).toContainText("Browser Performance");
  await expect(finalPreview).not.toContainText("{singerName}");
  await expect(finalPreview).not.toContainText("{eventTitle}");
});

test("shows the queued message in unified list and lets the user start another message", async ({
  page,
}) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.goto("/admin/communications?tab=compose");
  await page.getByLabel("Subject").fill("Queued announcement");
  await page.getByRole("textbox", { name: "Message body" }).fill("Hello queued recipients.");
  await page.getByRole("button", { name: "Review & send" }).click();

  const reviewDialog = page.getByRole("dialog", { name: "Review message" });
  await reviewDialog.getByRole("button", { name: "Send to 2 recipients" }).click();

  await expect(page.getByText("Message queued for 2 recipients.")).toBeVisible();
  await expect(page.getByRole("button", { name: "New message" })).toBeVisible();
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

  await page.goto("/admin/communications?tab=compose");
  await page.getByLabel("Subject").fill("Retry-safe announcement");
  await page.getByRole("textbox", { name: "Message body" }).fill("Hello queued recipients.");
  await page.getByRole("button", { name: "Review & send" }).click();

  const reviewDialog = page.getByRole("dialog", { name: "Review message" });
  await reviewDialog.getByRole("button", { name: "Send to 2 recipients" }).click();
  await expect(reviewDialog.getByRole("alert")).toContainText(
    "The communication could not be queued.",
  );
  await reviewDialog.getByRole("button", { name: "Send to 2 recipients" }).click();

  await expect(page.getByText("Message queued for 2 recipients.")).toBeVisible();
  expect(sendAttempts).toBe(2);
  expect(idempotencyKeys[0]).toBeTruthy();
  expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
});

test("shows recipient names in message delivery details", async ({ page }) => {
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
  const messageCard = page
    .locator(".communication-message-card")
    .filter({ hasText: "Rehearsal update" });
  await messageCard.getByRole("button", { name: "View delivery details" }).click();

  const deliveryDetails = messageCard.getByRole("region", {
    name: "Delivery details for Rehearsal update",
  });
  await expect(deliveryDetails).toBeVisible();
  await expect(deliveryDetails.getByText("Recipients (2)", { exact: true })).toBeVisible();
  await expect(deliveryDetails.getByText("Ada Alto", { exact: true })).toBeVisible();
  await expect(deliveryDetails.getByText("Ben Bass", { exact: true })).toBeVisible();
  await expect(deliveryDetails.getByText("Delivered", { exact: true })).toHaveCount(2);
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
  const queuedRow = page
    .locator(".communication-message-card")
    .filter({ hasText: "Queued announcement" });
  await queuedRow.getByRole("button", { name: "Edit & requeue" }).click();

  await expect(page.getByLabel("Subject")).toHaveValue("Queued announcement");
  await expect(page.getByRole("textbox", { name: "Message body" })).toHaveValue(
    "Hello queued recipients.",
  );

  await page.getByRole("button", { exact: true, name: "Messages" }).click();
  const followUpRow = page
    .locator(".communication-message-card")
    .filter({ hasText: "Queued follow-up" });
  await followUpRow.getByRole("button", { name: "Cancel message" }).click({ force: true });
  const cancelDialog = page.getByRole("dialog", { name: "Cancel queued communication" });
  await expect(cancelDialog).toBeVisible();
  await cancelDialog.getByRole("button", { name: "Cancel communication" }).click();
  await expect(page.getByText("Queued communication canceled.")).toBeVisible();
});

test("uses a contextual template picker and warns before replacing content", async ({ page }) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.goto("/admin/communications?tab=compose");

  const templatePicker = page.getByLabel("Template");
  await expect(templatePicker).toHaveValue("");
  await expect(templatePicker).toContainText("First template");
  await expect(templatePicker).not.toContainText("Audition Confirmed");
  await expect(templatePicker).not.toContainText("Donation Payment Receipt");

  await templatePicker.selectOption(firstTemplateId);
  await expect(templatePicker).toHaveValue(firstTemplateId);
  await expect(page.getByLabel("Subject")).toHaveValue("First template");

  await templatePicker.selectOption(secondTemplateId);
  const replaceDialog = page.getByRole("dialog", { name: "Replace message content?" });
  await expect(replaceDialog).toBeVisible();
  await expect(replaceDialog).toContainText(
    "Applying this template will replace the current subject",
  );
  await replaceDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Subject")).toHaveValue("First template");

  await templatePicker.selectOption(secondTemplateId);
  await expect(replaceDialog).toBeVisible();
  await replaceDialog.getByRole("button", { name: "Apply template" }).click();
  await expect(page.getByLabel("Subject")).toHaveValue("Second template");
});

test("shows conflict warning when audience becomes incompatible with placeholders", async ({
  page,
}) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.goto("/admin/communications?tab=compose");
  await page.getByLabel("Event (optional)").selectOption(eventId);

  const message = page.getByRole("textbox", { name: "Message body" });
  await message.fill("Please RSVP here: {{RSVP_LINKS}}");

  // No conflict yet because audience is Members only
  await expect(page.locator(".communication-conflict-banner")).toHaveCount(0);

  // Add Ticket Buyers to audience
  const recipientPanel = page.locator(".communication-recipient-panel");
  await recipientPanel.getByRole("checkbox", { name: "Ticket Buyers" }).click();

  // Conflict banner appears
  const conflictBanner = page.locator(".communication-conflict-banner");
  await expect(conflictBanner).toBeVisible();
  await expect(conflictBanner).toContainText("This message needs an update");
  await expect(conflictBanner).toContainText(
    "can only be used when all selected recipients are Members",
  );

  // Send button should be disabled
  await expect(page.getByRole("button", { name: "Review & send" })).toBeDisabled();

  // Click Remove placeholder action in the banner
  await conflictBanner.getByRole("button", { name: "Remove {{RSVP_LINKS}}" }).click();
  await expect(conflictBanner).toHaveCount(0);
  await expect(message).toHaveValue("Please RSVP here:");
});

test("searches and filters the template list in the dedicated Templates panel", async ({
  page,
}) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.goto("/admin/communications?tab=templates");
  const templateList = page.locator(".communication-templates-list");
  const search = page.getByLabel("Search templates");

  await search.fill("first");
  await expect(templateList.getByText("First template", { exact: true })).toBeVisible();
  await expect(templateList.getByText("Second template", { exact: true })).toHaveCount(0);

  await search.fill("");
  await page.getByLabel("Type").selectOption("system");
  await expect(templateList.getByText("Audition Confirmed", { exact: true })).toBeVisible();
  await expect(templateList.getByText("First template", { exact: true })).toHaveCount(0);

  await page.getByLabel("Type").selectOption("all");
  await page.getByLabel("Channel").selectOption("SMS");
  await expect(templateList.getByText("Text reminder", { exact: true })).toBeVisible();
  await expect(templateList.getByText("First template", { exact: true })).toHaveCount(0);
});

test("hides delivery mode notice banner in production", async ({ page }) => {
  const previewBodies: unknown[] = [];
  await page.route("**/api/**", (route) => handleRoute(route, previewBodies));

  await page.route("**/api/organization/provider-status", async (route) => {
    await fulfillJson(route, {
      brevo: { detail: "Email sends live", status: "ok" },
      emailSender: { fromEmail: null, fromName: null },
      environment: "production",
      externalEffectsMode: "sandbox",
      requestId,
      stripe: { detail: "Stripe live", status: "ok" },
    });
  });

  await page.goto("/admin/communications");
  await expect(page.getByText(/Delivery mode:/i)).toHaveCount(0);
});
