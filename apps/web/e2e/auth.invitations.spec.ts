import { expect, test } from "@playwright/test";
import { installStrictGuard } from "./fixtures/apiMocks";
import { buildInvitationSummary } from "./fixtures/builders";
import { installInvitationMocks } from "./fixtures/organization";
import { installSessionShell } from "./fixtures/session";

test("signs in as the recipient and accepts an Organization invitation", async ({ page }) => {
  const guard = await installStrictGuard(page);
  const session = await installSessionShell(page, { initiallySignedIn: false });
  const invitationId = "77777777-7777-4777-8777-777777777777";
  await installInvitationMocks(page, {
    invitations: [
      buildInvitationSummary({ email: session.user.email, id: invitationId, role: "member" }),
    ],
  });

  await page.goto(`/accept-invitation?id=${invitationId}`);
  await expect(page.getByRole("heading", { name: "Sign in to Choir Management." })).toBeVisible();
  await page.getByLabel("Email address").fill(session.user.email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await page.getByLabel("6-digit sign-in code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Join Organization Alpha." })).toBeVisible();
  await expect(page.getByText(session.user.email)).toBeVisible();
  await expect(page.getByText("Organization Member")).toBeVisible();
  await page.getByRole("button", { name: "Accept Organization invitation" }).click();
  await expect(page.getByRole("heading", { name: "You joined Organization Alpha." })).toBeVisible();
  await expect(page.getByText("Your Organization Membership is ready.")).toBeVisible();
  guard.assertNoUnexpectedRequests();
});

test("requires confirmation before declining an Organization invitation", async ({ page }) => {
  const guard = await installStrictGuard(page);
  const session = await installSessionShell(page, {});
  const invitationId = "88888888-8888-4888-8888-888888888888";
  await installInvitationMocks(page, {
    invitations: [
      buildInvitationSummary({ email: session.user.email, id: invitationId, role: "member" }),
    ],
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
  guard.assertNoUnexpectedRequests();
});
