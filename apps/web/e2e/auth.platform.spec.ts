import { expect, test, type Page } from "@playwright/test";
import { installPlatformAdminMocks, installStrictGuard } from "./fixtures/apiMocks";
import { buildAccountSecurityResponse } from "./fixtures/builders";
import { installWorkspaceExtras } from "./fixtures/organization";
import { fulfillJson, installSessionShell, type SessionShell } from "./fixtures/session";

const platformRequestId = "33333333-3333-4333-8333-333333333333";

async function installPlatformSpecShell(
  page: Page,
  session: SessionShell,
  authStatus: { code: string; message: string; status: number },
  securityRequestId: string,
): Promise<void> {
  await installWorkspaceExtras(page, {});
  await page.route("**/api/account/organizations", async (route) => {
    await fulfillJson(route, { organizations: [] });
  });
  await page.route("**/api/account/security", async (route) => {
    await fulfillJson(route, buildAccountSecurityResponse(false, securityRequestId));
  });
  await page.route("**/api/account/sessions", async (route) => {
    await fulfillJson(route, [session.session]);
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await fulfillJson(
      route,
      {
        code: authStatus.code,
        message: authStatus.message,
        requestId: "55555555-5555-4555-8555-555555555555",
      },
      authStatus.status,
    );
  });
  // The pre-extraction specs left these org endpoints to fall through to the local Worker
  // (unauthorized there); the guarded equivalent is an explicit 404.
  await page.route("**/api/organization/module-state", async (route) => {
    await fulfillJson(route, { requestId: platformRequestId }, 404);
  });
  await page.route("**/api/setup/status", async (route) => {
    await fulfillJson(route, { requestId: platformRequestId }, 404);
  });
}

test("enrolls and verifies mandatory Platform Administrator MFA", async ({ page }) => {
  const guard = await installStrictGuard(page);
  const session = await installSessionShell(page, {});
  await installPlatformAdminMocks(page, { userId: session.user.id });
  await installPlatformSpecShell(
    page,
    session,
    {
      code: "not_found",
      message: "No canonical Organization hostname is active.",
      status: 404,
    },
    "44444444-4444-4444-8444-444444444444",
  );

  await page.goto("/platform/security");
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

  await page.goto("/platform/dead-letters");
  const deadLettersSection = page.getByRole("region", { name: "Queue dead letters" });
  await expect(
    deadLettersSection.getByRole("heading", { name: "Queue dead letters" }),
  ).toBeVisible();
  await expect(
    deadLettersSection.getByText("No jobs have reached the dead-letter queue."),
  ).toBeVisible();

  await page.goto("/platform/organizations");
  const organizationsSection = page.getByRole("region", { name: "Organizations" });
  await expect(
    organizationsSection.getByRole("heading", { name: "Organization provisioning" }),
  ).toBeVisible();
  await organizationsSection.getByRole("button", { name: "Prepare schemas" }).click();
  await expect(
    organizationsSection.getByRole("button", { name: "Preparation running" }),
  ).toBeDisabled();
  await organizationsSection.getByLabel("Organization name").fill("Staging Choir");
  await organizationsSection.getByLabel("Hostname slug").fill("staging-choir");
  await organizationsSection.getByRole("button", { name: "Create Organization" }).click();
  await expect(organizationsSection.getByText("Staging Choir", { exact: true })).toBeVisible();
  await expect(organizationsSection.getByText("Provisioning", { exact: true })).toBeVisible();
  await expect(organizationsSection.getByRole("status").last()).toContainText(
    "canonical hostname remains pending",
  );
  await expect(page.getByText("recovery-01")).toHaveCount(0);
  guard.assertNoUnexpectedRequests();
});

test("enables and ends scoped Platform Administrator edit access", async ({ page }) => {
  const guard = await installStrictGuard(page);
  const session = await installSessionShell(page, {});
  await installPlatformAdminMocks(page, {
    contextScope: { kind: "organization", organizationId: "organization-alpha" },
    gatePlatformContext: false,
    mfaStatus: {
      activePlatformAdministrator: true,
      enrollmentComplete: true,
      twoFactorEnabled: true,
    },
    userId: session.user.id,
  });
  await installPlatformSpecShell(
    page,
    session,
    {
      code: "forbidden",
      message: "This identity is not an active Organization Member.",
      status: 403,
    },
    platformRequestId,
  );

  await page.goto("/platform/access");
  const platformSection = page.getByRole("region", { name: "Organization access" });
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
  guard.assertNoUnexpectedRequests();
});
