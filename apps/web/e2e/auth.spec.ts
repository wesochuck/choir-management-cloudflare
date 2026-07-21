import { expect, test } from "@playwright/test";

const currentSession = {
  activeOrganizationId: null,
  createdAt: "2026-07-20T20:00:00.000Z",
  expiresAt: "2026-07-27T20:00:00.000Z",
  id: "session-current",
  ipAddress: "192.0.2.10",
  token: "current-session-token-not-displayed",
  updatedAt: "2026-07-20T20:00:00.000Z",
  userAgent: "Chromium browser",
  userId: "user-invited-member",
} as const;

const currentUser = {
  createdAt: "2026-07-20T19:00:00.000Z",
  email: "invited.member@example.test",
  emailVerified: true,
  id: "user-invited-member",
  image: null,
  name: "Invited Member",
  twoFactorEnabled: false,
  updatedAt: "2026-07-20T20:00:00.000Z",
} as const;

test("completes OTP sign-in and manages Organizations and sessions", async ({ page }) => {
  let passwordSet = false;
  let signedIn = false;
  let sessions = [
    currentSession,
    {
      ...currentSession,
      id: "session-other",
      ipAddress: "198.51.100.4",
      token: "other-session-token-not-displayed",
      userAgent: "Safari on iPad",
    },
  ];

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: "11111111-1111-4111-8111-111111111111",
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
      body: JSON.stringify(signedIn ? { session: currentSession, user: currentUser } : null),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/email-otp/send-verification-otp", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ success: true }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/sign-in/email-otp", async (route) => {
    signedIn = true;
    await route.fulfill({
      body: JSON.stringify({ token: "not-used-by-browser-ui", user: currentUser }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/organizations", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        organizations: [
          {
            canonicalHostname: "alpha.example.test",
            canonicalStatus: "active",
            lifecycleState: "active",
            name: "Organization Alpha",
            organizationId: "organization-alpha",
            profileId: null,
            role: "administrator",
            slug: "alpha",
          },
          {
            canonicalHostname: "future.example.test",
            canonicalStatus: "pending",
            lifecycleState: "provisioning",
            name: "Future Choir",
            organizationId: "organization-future",
            profileId: null,
            role: "member",
            slug: "future",
          },
        ],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/security", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        passwordSet,
        requestId: "44444444-4444-4444-8444-444444444444",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/password", async (route) => {
    passwordSet = true;
    await route.fulfill({
      body: JSON.stringify({
        passwordSet: true,
        requestId: "44444444-4444-4444-8444-444444444444",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/list-sessions", async (route) => {
    await route.fulfill({
      body: JSON.stringify(sessions),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/revoke-session", async (route) => {
    sessions = sessions.filter((session) => session.id !== "session-other");
    await route.fulfill({
      body: JSON.stringify({ status: true }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/sign-out", async (route) => {
    signedIn = false;
    await route.fulfill({
      body: JSON.stringify({ success: true }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/mfa/status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        activePlatformAdministrator: false,
        enrollmentComplete: false,
        requestId: "22222222-2222-4222-8222-222222222222",
        twoFactorEnabled: false,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        code: "not_found",
        message: "No canonical Organization hostname is active.",
        requestId: "55555555-5555-4555-8555-555555555555",
      }),
      contentType: "application/json",
      status: 404,
    });
  });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to Choir Management." })).toBeVisible();
  await page.getByLabel("Email address").fill(currentUser.email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "If invited.member@example.test has access",
  );
  await page.getByLabel("6-digit sign-in code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Welcome, Invited Member." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Organization Alpha" })).toBeVisible();
  await expect(page.getByText("Future Choir")).toBeVisible();
  await expect(page.getByText("Setup pending")).toBeVisible();

  const passwordSection = page.getByRole("region", { name: "Account password" });
  const userPassword = "a-user-managed-password";
  await passwordSection.getByLabel("New password", { exact: true }).fill(userPassword);
  await passwordSection.getByLabel("Confirm new password").fill(userPassword);
  await passwordSection.getByRole("button", { name: "Add password" }).click();
  await expect(passwordSection.getByRole("status")).toContainText("Password added");
  await expect(passwordSection.getByLabel("Current password")).toBeVisible();

  const otherSession = page.getByRole("listitem", { name: "Session: Safari on iPad" });
  await expect(otherSession).toBeVisible();
  await otherSession.getByRole("button", { name: "Revoke session" }).click();
  await expect(otherSession).toHaveCount(0);
  await expect(page.getByText("current-session-token-not-displayed")).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
});

test("enrolls and verifies mandatory Platform Administrator MFA", async ({ page }) => {
  let assertionReady = false;
  let enrollmentComplete = false;
  let twoFactorEnabled = false;
  const recoveryCodes = Array.from(
    { length: 10 },
    (_, index) => `recovery-${String(index + 1).padStart(2, "0")}`,
  );

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: "11111111-1111-4111-8111-111111111111",
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
      body: JSON.stringify({ session: currentSession, user: currentUser }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/organizations", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ organizations: [] }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/security", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        passwordSet: false,
        requestId: "44444444-4444-4444-8444-444444444444",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/list-sessions", async (route) => {
    await route.fulfill({
      body: JSON.stringify([currentSession]),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/mfa/status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        activePlatformAdministrator: true,
        enrollmentComplete,
        requestId: "22222222-2222-4222-8222-222222222222",
        twoFactorEnabled,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        code: "not_found",
        message: "No canonical Organization hostname is active.",
        requestId: "55555555-5555-4555-8555-555555555555",
      }),
      contentType: "application/json",
      status: 404,
    });
  });
  await page.route("**/api/auth/two-factor/enable", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        backupCodes: recoveryCodes,
        totpURI:
          "otpauth://totp/Choir%20Management:invited.member%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Choir%20Management",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
    twoFactorEnabled = true;
    await route.fulfill({
      body: JSON.stringify({ status: true }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/mfa/confirm-enrollment", async (route) => {
    enrollmentComplete = true;
    await route.fulfill({
      body: JSON.stringify({ status: "confirmed" }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/context", async (route) => {
    if (!assertionReady) {
      await route.fulfill({
        body: JSON.stringify({
          code: "unauthorized",
          message: "A recent Platform Administrator MFA verification is required.",
          requestId: "33333333-3333-4333-8333-333333333333",
        }),
        contentType: "application/json",
        status: 401,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        mfaMethod: "totp",
        mfaVerifiedUntil: "2026-07-20T20:15:00.000Z",
        requestId: "33333333-3333-4333-8333-333333333333",
        scope: { kind: "product_base" },
        userId: currentUser.id,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/organizations", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        body: JSON.stringify({
          canonicalHostname: "staging-choir.example.test",
          canonicalStatus: "pending",
          lifecycleState: "provisioning",
          organizationId: "99999999-9999-4999-8999-999999999999",
          requestId: "33333333-3333-4333-8333-333333333333",
          workflowId: "organization-provision-browser-test",
        }),
        contentType: "application/json",
        status: 202,
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        nextCursor: null,
        organizations: [],
        requestId: "33333333-3333-4333-8333-333333333333",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/mfa/verify", async (route) => {
    assertionReady = true;
    await route.fulfill({
      body: JSON.stringify({ expiresAt: "2026-07-20T20:15:00.000Z", status: "verified" }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/account");
  const platformSection = page.getByRole("region", { name: "Platform Administrator access" });
  await expect(
    platformSection.getByRole("heading", { name: "Complete mandatory MFA" }),
  ).toBeVisible();
  await platformSection.getByRole("button", { name: "Start MFA setup" }).click();
  await expect(platformSection.getByLabel("Platform Administrator recovery codes")).toContainText(
    "recovery-01",
  );
  await platformSection.getByLabel("3. Verify the authenticator code").fill("123456");
  await platformSection.getByRole("button", { name: "Verify authenticator" }).click();
  await platformSection
    .getByRole("checkbox", { name: "I saved these recovery codes in a secure place." })
    .check();
  await platformSection.getByRole("button", { name: "Confirm recovery codes" }).click();

  await expect(
    platformSection.getByRole("heading", { name: "Verify Platform Administrator access" }),
  ).toBeVisible();
  await platformSection.getByLabel("6-digit code").fill("654321");
  await platformSection.getByRole("button", { name: "Verify Platform access" }).click();
  await expect(platformSection.getByRole("status")).toContainText("Platform access is ready");
  await expect(
    platformSection.getByRole("heading", { name: "Organization provisioning" }),
  ).toBeVisible();
  await platformSection.getByLabel("Organization name").fill("Staging Choir");
  await platformSection.getByLabel("Hostname slug").fill("staging-choir");
  await platformSection.getByRole("button", { name: "Create Organization" }).click();
  await expect(platformSection.getByText("Staging Choir", { exact: true })).toBeVisible();
  await expect(platformSection.getByText("Provisioning", { exact: true })).toBeVisible();
  await expect(platformSection.getByRole("status").last()).toContainText(
    "canonical hostname remains pending",
  );
  await expect(page.getByText("recovery-01")).toHaveCount(0);
});

test("enables and ends scoped Platform Administrator edit access", async ({ page }) => {
  let canEdit = false;
  const elevationId = "88888888-8888-4888-8888-888888888888";
  const requestId = "33333333-3333-4333-8333-333333333333";

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: "11111111-1111-4111-8111-111111111111",
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
      body: JSON.stringify({ session: currentSession, user: currentUser }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/organizations", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ organizations: [] }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/security", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ passwordSet: false, requestId }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/list-sessions", async (route) => {
    await route.fulfill({
      body: JSON.stringify([currentSession]),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/mfa/status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        activePlatformAdministrator: true,
        enrollmentComplete: true,
        requestId,
        twoFactorEnabled: true,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        code: "forbidden",
        message: "This identity is not an active Organization Member.",
        requestId,
      }),
      contentType: "application/json",
      status: 403,
    });
  });
  await page.route("**/api/platform/context", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        mfaMethod: "totp",
        mfaVerifiedUntil: "2026-07-20T20:15:00.000Z",
        requestId,
        scope: { kind: "organization", organizationId: "organization-alpha" },
        userId: currentUser.id,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/organization-context", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        canEdit,
        elevationExpiresAt: canEdit ? "2026-07-20T20:15:00.000Z" : null,
        elevationId: canEdit ? elevationId : null,
        organizationId: "organization-alpha",
        requestId,
        userId: currentUser.id,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/elevations", async (route) => {
    canEdit = true;
    await route.fulfill({
      body: JSON.stringify({
        canEdit: true,
        elevationExpiresAt: "2026-07-20T20:15:00.000Z",
        elevationId,
        organizationId: "organization-alpha",
        requestId,
        userId: currentUser.id,
      }),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.route("**/api/platform/elevations/*", async (route) => {
    canEdit = false;
    await route.fulfill({
      body: JSON.stringify({ elevationId, status: "revoked" }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/account");
  const platformSection = page.getByRole("region", { name: "Platform Administrator access" });
  await expect(platformSection.getByRole("heading", { name: "Organization access" })).toBeVisible();
  await expect(platformSection.getByText("Read-only Platform access")).toBeVisible();
  await platformSection
    .getByLabel("Reason for enabling edits")
    .fill("Review Organization configuration");
  await platformSection
    .getByRole("button", { name: "Enable Platform edits for 15 minutes" })
    .click();
  await expect(platformSection.getByText("Platform edits enabled.")).toBeVisible();
  await platformSection.getByRole("button", { name: "End edit access" }).click();
  await expect(platformSection.getByText("Read-only Platform access")).toBeVisible();
});

test("enrolls, verifies, and safely manages an Organization MFA policy", async ({ page }) => {
  let mfaRequired = false;
  let mfaVerifiedUntil: string | null = null;
  let twoFactorEnabled = false;
  let twoFactorVerified = false;
  const requestId = "55555555-5555-4555-8555-555555555555";
  const recoveryCodes = Array.from(
    { length: 10 },
    (_, index) => `organization-recovery-${String(index + 1).padStart(2, "0")}`,
  );
  const pendingInvitations: {
    createdAt: string;
    email: string;
    expiresAt: string;
    id: string;
    role: "administrator";
    status: "pending";
  }[] = [];

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: "11111111-1111-4111-8111-111111111111",
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
      body: JSON.stringify({ session: currentSession, user: currentUser }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/organizations", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        organizations: [
          {
            canonicalHostname: "alpha.localhost",
            canonicalStatus: "active",
            lifecycleState: "active",
            name: "Organization Alpha",
            organizationId: "organization-alpha",
            profileId: null,
            role: "owner",
            slug: "alpha",
          },
        ],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/account/security", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ passwordSet: false, requestId }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/list-sessions", async (route) => {
    await route.fulfill({
      body: JSON.stringify([currentSession]),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/platform/mfa/status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        activePlatformAdministrator: false,
        enrollmentComplete: false,
        requestId,
        twoFactorEnabled,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        mfaRequired,
        mfaVerifiedUntil,
        organizationId: "organization-alpha",
        requestId,
        role: "owner",
        twoFactorEnabled,
        twoFactorVerified,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/auth-policy", async (route) => {
    mfaRequired = !mfaRequired;
    mfaVerifiedUntil = null;
    await route.fulfill({
      body: JSON.stringify({ mfaRequired, organizationId: "organization-alpha", requestId }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/two-factor/enable", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        backupCodes: recoveryCodes,
        totpURI:
          "otpauth://totp/Choir%20Management:member%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Choir%20Management",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
    twoFactorEnabled = true;
    twoFactorVerified = true;
    await route.fulfill({
      body: JSON.stringify({ status: true }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/mfa/verify", async (route) => {
    mfaVerifiedUntil = "2026-07-21T08:00:00.000Z";
    await route.fulfill({
      body: JSON.stringify({
        expiresAt: mfaVerifiedUntil,
        organizationId: "organization-alpha",
        requestId,
        status: "verified",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/organization/invitations", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify({ invitations: pendingInvitations, requestId, truncated: false }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    const body: unknown = route.request().postDataJSON();
    expect(body).toEqual({ email: "future.member@example.test", role: "administrator" });
    pendingInvitations.push({
      createdAt: "2026-07-20T08:00:00.000Z",
      email: "future.member@example.test",
      expiresAt: "2026-07-22T08:00:00.000Z",
      id: "77777777-7777-4777-8777-777777777777",
      role: "administrator",
      status: "pending",
    });
    await route.fulfill({
      body: JSON.stringify({
        expiresAt: "2026-07-22T08:00:00.000Z",
        id: "77777777-7777-4777-8777-777777777777",
        requestId,
        status: "pending",
      }),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.route("**/api/organization/invitations/*", async (route) => {
    const invitationId = route.request().url().split("/").at(-1);
    const invitationIndex = pendingInvitations.findIndex(
      (invitation) => invitation.id === invitationId,
    );
    expect(route.request().method()).toBe("DELETE");
    expect(invitationIndex).toBeGreaterThanOrEqual(0);
    pendingInvitations.splice(invitationIndex, 1);
    await route.fulfill({
      body: JSON.stringify({ id: invitationId, requestId, status: "canceled" }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/account");
  const organizationSection = page.getByRole("region", { name: "Organization security" });
  await expect(organizationSection.getByText("MFA not required")).toBeVisible();
  await organizationSection
    .getByRole("button", { name: "Require MFA for this Organization" })
    .click();
  await expect(organizationSection.getByText("MFA required")).toBeVisible();
  await organizationSection.getByRole("button", { name: "Start Organization MFA setup" }).click();
  await expect(organizationSection.getByLabel("Organization MFA recovery codes")).toContainText(
    "organization-recovery-01",
  );
  await organizationSection.getByLabel("3. Verify authenticator code").fill("123456");
  await organizationSection.getByRole("button", { name: "Verify authenticator" }).click();
  await organizationSection
    .getByRole("checkbox", {
      name: "I saved these Organization MFA recovery codes in a secure place.",
    })
    .check();
  await organizationSection
    .getByRole("button", { name: "Continue to Organization verification" })
    .click();
  await organizationSection.getByLabel("6-digit Organization code").fill("654321");
  await organizationSection.getByRole("button", { name: "Verify Organization access" }).click();
  await expect(organizationSection.getByText(/Verified until/)).toBeVisible();
  await expect(page.getByText("organization-recovery-01")).toHaveCount(0);

  const invitationSection = page.getByRole("region", { name: "Invite a member" });
  await invitationSection.getByLabel("Email address").fill("future.member@example.test");
  await invitationSection
    .getByLabel("Organization role")
    .selectOption({ label: "Organization Administrator" });
  await invitationSection.getByRole("button", { name: "Create invitation" }).click();
  await expect(invitationSection.getByRole("status")).toContainText(
    "Invitation created for future.member@example.test",
  );
  const pendingInvitation = invitationSection.getByRole("listitem", {
    name: "Invitation: future.member@example.test",
  });
  await expect(pendingInvitation).toContainText("Organization Administrator");
  await pendingInvitation.getByRole("button", { name: "Cancel invitation" }).click();
  await pendingInvitation.getByRole("button", { name: "Keep invitation" }).click();
  await expect(pendingInvitation).toBeVisible();
  await pendingInvitation.getByRole("button", { name: "Cancel invitation" }).click();
  await pendingInvitation.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(pendingInvitation).toHaveCount(0);
  await expect(invitationSection.getByRole("status")).toContainText(
    "Invitation for future.member@example.test canceled.",
  );

  await organizationSection.getByRole("button", { name: "Stop requiring MFA" }).click();
  const confirmation = organizationSection.getByRole("group", {
    name: "Confirm MFA policy change",
  });
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(
    organizationSection.getByRole("button", { name: "Stop requiring MFA" }),
  ).toBeVisible();
  await organizationSection.getByRole("button", { name: "Stop requiring MFA" }).click();
  await confirmation.getByRole("button", { name: "Confirm: stop requiring MFA" }).click();
  await expect(organizationSection.getByText("MFA not required")).toBeVisible();
});

test("signs in as the recipient and accepts an Organization invitation", async ({ page }) => {
  let signedIn = false;
  const invitationId = "77777777-7777-4777-8777-777777777777";

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: "11111111-1111-4111-8111-111111111111",
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
      body: JSON.stringify(signedIn ? { session: currentSession, user: currentUser } : null),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/email-otp/send-verification-otp", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ success: true }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/sign-in/email-otp", async (route) => {
    signedIn = true;
    await route.fulfill({
      body: JSON.stringify({ token: "not-used-by-browser-ui", user: currentUser }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(`**/api/organization/invitations/${invitationId}`, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        email: currentUser.email,
        expiresAt: "2026-07-22T08:00:00.000Z",
        id: invitationId,
        inviterEmail: "owner@example.test",
        organizationId: "organization-alpha",
        organizationName: "Organization Alpha",
        organizationSlug: "alpha",
        role: "member",
        status: "pending",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(`**/api/organization/invitations/${invitationId}/accept`, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        id: invitationId,
        requestId: "55555555-5555-4555-8555-555555555555",
        status: "accepted",
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/accept-invitation?id=${invitationId}`);
  await expect(page.getByRole("heading", { name: "Sign in to Choir Management." })).toBeVisible();
  await page.getByLabel("Email address").fill(currentUser.email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await page.getByLabel("6-digit sign-in code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Join Organization Alpha." })).toBeVisible();
  await expect(page.getByText(currentUser.email)).toBeVisible();
  await expect(page.getByText("Organization Member")).toBeVisible();
  await page.getByRole("button", { name: "Accept Organization invitation" }).click();
  await expect(page.getByRole("heading", { name: "You joined Organization Alpha." })).toBeVisible();
  await expect(page.getByText("Your Organization Membership is ready.")).toBeVisible();
});

test("requires confirmation before declining an Organization invitation", async ({ page }) => {
  const invitationId = "88888888-8888-4888-8888-888888888888";

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: "11111111-1111-4111-8111-111111111111",
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
      body: JSON.stringify({ session: currentSession, user: currentUser }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(`**/api/organization/invitations/${invitationId}`, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        email: currentUser.email,
        expiresAt: "2026-07-22T08:00:00.000Z",
        id: invitationId,
        inviterEmail: "owner@example.test",
        organizationId: "organization-alpha",
        organizationName: "Organization Alpha",
        organizationSlug: "alpha",
        role: "member",
        status: "pending",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(`**/api/organization/invitations/${invitationId}/reject`, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        id: invitationId,
        requestId: "55555555-5555-4555-8555-555555555555",
        status: "rejected",
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/accept-invitation?id=${invitationId}`);
  await expect(page.getByRole("heading", { name: "Join Organization Alpha." })).toBeVisible();
  await page.getByRole("button", { name: "Decline invitation" }).click();
  const confirmation = page.getByRole("group", { name: "Confirm invitation decline" });
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Accept Organization invitation" })).toBeVisible();
  await page.getByRole("button", { name: "Decline invitation" }).click();
  await confirmation.getByRole("button", { name: "Confirm: decline invitation" }).click();
  await expect(page.getByRole("heading", { name: "Invitation declined." })).toBeVisible();
  await expect(page.getByText("You did not join Organization Alpha.")).toBeVisible();
});

test("offers password MFA sign-in and completes non-enumerating account recovery", async ({
  page,
}) => {
  const resetToken = "browser-reset-token-123456";

  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        environment: "local",
        requestId: "11111111-1111-4111-8111-111111111111",
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
  await page.route("**/api/auth/sign-in/email", async (route) => {
    const body: unknown = route.request().postDataJSON();
    expect(body).toEqual({
      email: currentUser.email,
      password: "member-password-value",
    });
    await route.fulfill({
      body: JSON.stringify({ twoFactorMethods: ["totp"], twoFactorRedirect: true }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/request-password-reset", async (route) => {
    const body: unknown = route.request().postDataJSON();
    expect(body).toEqual({
      email: currentUser.email,
    });
    await route.fulfill({
      body: JSON.stringify({
        message: "If this email exists in our system, check your email for the reset link",
        status: true,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/auth/reset-password", async (route) => {
    const body: unknown = route.request().postDataJSON();
    expect(body).toEqual({
      newPassword: "a-new-browser-password",
      token: resetToken,
    });
    await route.fulfill({
      body: JSON.stringify({ status: true }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto("/login");
  await page.getByRole("button", { name: "Password", exact: true }).click();
  await page.getByLabel("Email address").fill(currentUser.email);
  await page.getByLabel("Password", { exact: true }).fill("member-password-value");
  await page.getByRole("button", { name: "Sign in with password" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "Complete two-factor sign-in",
  );
  await expect(page.getByLabel("6-digit authenticator code")).toBeVisible();

  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill(currentUser.email.toUpperCase());
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "If that email belongs to an invited account",
  );

  await page.goto(`/reset-password#token=${resetToken}`);
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel("New password", { exact: true }).fill("a-new-browser-password");
  await page.getByLabel("Confirm new password").fill("a-different-password");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByRole("alert")).toContainText("passwords do not match");
  await page.getByLabel("Confirm new password").fill("a-new-browser-password");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("password was reset");
  await expect(
    page.getByRole("main").getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
});
