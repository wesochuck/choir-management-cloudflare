import { expect, test } from "@playwright/test";

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const sessionResponse = {
  session: {
    activeOrganizationId: null,
    createdAt: "2026-07-20T20:00:00.000Z",
    expiresAt: "2026-07-27T20:00:00.000Z",
    id: "session-audition-admin",
    ipAddress: "192.0.2.20",
    token: "audition-admin-token-not-displayed",
    updatedAt: "2026-07-20T20:00:00.000Z",
    userAgent: "Chromium browser",
    userId: "user-audition-admin",
  },
  user: {
    createdAt: "2026-07-20T19:00:00.000Z",
    email: "audition.admin@example.test",
    emailVerified: true,
    id: "user-audition-admin",
    image: null,
    name: "Audition Admin",
    twoFactorEnabled: false,
    updatedAt: "2026-07-20T20:00:00.000Z",
  },
};

const organizationsResponse = {
  organizations: [
    {
      canonicalHostname: "audition.example.test",
      canonicalStatus: "active",
      lifecycleState: "active",
      name: "Audition Choir",
      organizationId: "org-audition-test",
      profileId: null,
      role: "administrator",
      slug: "audition",
    },
  ],
};

const authStatusResponse = {
  mfaRequired: false,
  mfaVerifiedUntil: null,
  organizationId: "org-audition-test",
  requestId,
  role: "administrator",
  twoFactorEnabled: false,
  twoFactorVerified: false,
};

const sessionsListResponse = [
  {
    activeOrganizationId: null,
    createdAt: "2026-07-20T20:00:00.000Z",
    expiresAt: "2026-07-27T20:00:00.000Z",
    id: "session-audition-admin",
    ipAddress: "192.0.2.20",
    token: "audition-admin-token-not-displayed",
    updatedAt: "2026-07-20T20:00:00.000Z",
    userAgent: "Chromium browser",
    userId: "user-audition-admin",
  },
];

const organizationContextResponse = {
  organizationId: "org-audition-test",
  requestId,
  role: "administrator",
  userId: "user-audition-admin",
};

const auditionList = [
  {
    adminNotes: "",
    availabilityNotes: "",
    createdAt: "2026-07-22T10:00:00.000Z",
    email: "singer.one@example.test",
    id: "audition-001",
    name: "Singer One",
    phone: "555-0101",
    slots: [],
    status: "pending",
    updatedAt: "2026-07-22T10:00:00.000Z",
    voicePart: "Soprano",
  },
  {
    adminNotes: "Strong candidate",
    availabilityNotes: "Weekdays only",
    createdAt: "2026-07-23T14:00:00.000Z",
    email: "singer.two@example.test",
    id: "audition-002",
    name: "Singer Two",
    phone: "",
    slots: [],
    status: "scheduled",
    updatedAt: "2026-07-23T14:00:00.000Z",
    voicePart: "Bass",
  },
];

test("displays public audition inquiry form and accepts a submission", async ({ page }) => {
  let inquiryReceived: { name: string; email: string } | null = null;

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId,
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({ body: "null", contentType: "application/json", status: 200 });
  });
  await page.route("**/api/public/projection", async (route) => {
    await route.fulfill({ status: 404 });
  });
  await page.route("**/api/public/audition-inquiry", async (route) => {
    const body: unknown = route.request().postDataJSON();
    if (
      typeof body === "object" &&
      body !== null &&
      "name" in body &&
      typeof body.name === "string" &&
      "email" in body &&
      typeof body.email === "string"
    ) {
      inquiryReceived = { email: body.email, name: body.name };
    }
    await route.fulfill({
      body: JSON.stringify({ id: "audition-new-001", requestId }),
      contentType: "application/json",
      status: 201,
    });
  });

  await page.goto("/auditions");

  await expect(page.getByRole("heading", { name: "Audition Inquiry" })).toBeVisible();
  await expect(page.getByText("Interested in joining?")).toBeVisible();

  await page.getByLabel("Name *").fill("Jane Singer");
  await page.getByLabel("Email *").fill("jane.singer@example.test");
  await page.getByLabel("Phone").fill("555-0200");
  await page.getByLabel("Voice Part").selectOption({ label: "Unsure" });
  await page.getByLabel("Musical Experience").fill("Five years of choir experience.");
  await page.getByRole("button", { name: "Submit Inquiry" }).click();

  await expect(page.getByRole("heading", { name: "Inquiry Received" })).toBeVisible();
  await expect(page.getByText("Thank you for your interest!")).toBeVisible();
  expect(inquiryReceived).toEqual({
    email: "jane.singer@example.test",
    name: "Jane Singer",
  });
});

test("shows configured public audition availability and scheduled details", async ({ page }) => {
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId,
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({ body: "null", contentType: "application/json", status: 200 });
  });
  await page.route("**/api/public/projection", async (route) => {
    await route.fulfill({ status: 404 });
  });
  await page.route("**/api/public/audition-settings", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        confirmationMessage: "Choose a time",
        defaultPerformanceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        enabled: true,
        performance: null,
        sections: [],
        slots: [
          {
            endsAt: "2026-08-01T15:30:00.000Z",
            id: "slot-001",
            startsAt: "2026-08-01T15:00:00.000Z",
          },
        ],
        timezone: "UTC",
        venue: null,
        voiceParts: [],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.goto("/auditions");
  await expect(page.getByRole("heading", { name: "Audition Inquiry" })).toBeVisible();
  await expect(page.getByText("Choose a time")).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(1);

  await page.route("**/api/public/audition-details", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        createdAt: "2026-07-22T10:00:00.000Z",
        email: "scheduled@example.test",
        id: "audition-scheduled",
        name: "Scheduled Singer",
        requestedSlots: ["2026-08-01T15:00:00.000Z"],
        scheduledTimeSlot: "2026-08-01T15:00:00.000Z",
        slots: [],
        status: "scheduled",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.goto("/auditions?token=scheduled-token");
  await expect(page.getByRole("heading", { name: "Your Audition" })).toBeVisible();
  await expect(page.getByText(/Scheduled audition:/)).toBeVisible();
});

test("shows not-found state for an invalid audition token", async ({ page }) => {
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId,
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({ body: "null", contentType: "application/json", status: 200 });
  });
  await page.route("**/api/public/projection", async (route) => {
    await route.fulfill({ status: 404 });
  });
  await page.route("**/api/public/audition-details", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        code: "invalid_link",
        message: "This audition link is invalid or expired.",
        requestId,
      }),
      contentType: "application/json",
      status: 404,
    });
  });

  await page.goto("/auditions?token=invalid-token-12345");

  await expect(page.getByRole("heading", { name: "Link Not Found" })).toBeVisible();
  await expect(page.getByText("This audition link is invalid or expired.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to the Organization site" })).toBeVisible();
});

test("admin manages auditions: list, edit, and save", async ({ page }) => {
  const updatedAudition: {
    value: { id: string; status: string; adminNotes?: string } | null;
  } = { value: null };

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId,
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({
      body: JSON.stringify(sessionResponse),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/public/projection", async (route) => {
    await route.fulfill({ status: 404 });
  });
  await page.route("**/api/account/organizations", async (route) => {
    await route.fulfill({
      body: JSON.stringify(organizationsResponse),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/sessions", async (route) => {
    await route.fulfill({
      body: JSON.stringify(sessionsListResponse),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await route.fulfill({
      body: JSON.stringify(authStatusResponse),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/context", async (route) => {
    await route.fulfill({
      body: JSON.stringify(organizationContextResponse),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auditions", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ auditions: auditionList, requestId }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auditions/*", async (route) => {
    if (route.request().method() === "PUT") {
      const body: unknown = route.request().postDataJSON();
      const id = route.request().url().split("/").pop() ?? "";
      const existingAudition = auditionList.find((a) => a.id === id);
      const bodyRecord: Record<string, unknown> = {};
      if (typeof body === "object" && body !== null) {
        for (const [key, value] of Object.entries(body)) {
          bodyRecord[key] = value;
        }
      }
      const adminNotesVal =
        "adminNotes" in bodyRecord && typeof bodyRecord.adminNotes === "string"
          ? bodyRecord.adminNotes
          : undefined;
      const statusVal =
        "status" in bodyRecord && typeof bodyRecord.status === "string"
          ? bodyRecord.status
          : (existingAudition?.status ?? "pending");
      updatedAudition.value = {
        ...(adminNotesVal !== undefined ? { adminNotes: adminNotesVal } : {}),
        id,
        status: statusVal,
      };
      await route.fulfill({
        body: JSON.stringify({ ...existingAudition, ...bodyRecord }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/admin/auditions");

  await expect(page.getByRole("heading", { name: "Auditions" })).toBeVisible();
  await expect(page.getByText("Singer One")).toBeVisible();
  await expect(page.getByText("Singer Two")).toBeVisible();
  await expect(page.getByText("Soprano")).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).first().click({ force: true });
  await expect(page.getByText("Edit Audition")).toBeVisible();
  await page.getByLabel("Status").selectOption("scheduled");
  await page.getByLabel("Admin notes").fill("Promising candidate");
  await page.getByRole("button", { exact: true, name: "Save" }).click();

  await expect(page.getByText("Audition updated.")).toBeVisible();
  expect(updatedAudition.value).not.toBeNull();
  if (updatedAudition.value !== null) {
    expect(updatedAudition.value.status).toBe("scheduled");
    expect(updatedAudition.value.adminNotes).toBe("Promising candidate");
  }
});

test("admin sees empty state when no auditions exist", async ({ page }) => {
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId,
        service: "choir-management-cloudflare",
        status: "ok",
        version: "browser-test",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({
      body: JSON.stringify(sessionResponse),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/public/projection", async (route) => {
    await route.fulfill({ status: 404 });
  });
  await page.route("**/api/account/organizations", async (route) => {
    await route.fulfill({
      body: JSON.stringify(organizationsResponse),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/sessions", async (route) => {
    await route.fulfill({
      body: JSON.stringify(sessionsListResponse),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await route.fulfill({
      body: JSON.stringify(authStatusResponse),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/context", async (route) => {
    await route.fulfill({
      body: JSON.stringify(organizationContextResponse),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auditions", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ auditions: [], requestId }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/admin/auditions");

  await expect(page.getByRole("heading", { name: "Auditions" })).toBeVisible();
  await expect(page.getByText("No audition inquiries yet.")).toBeVisible();
});
