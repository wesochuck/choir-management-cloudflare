// FULL-STACK suite (reaches the real local Worker/D1).
//
// This spec intentionally registers NO `page.route(...)` mocks: every
// `/api/**` request flows through the preview proxy to the Worker started by
// scripts/run-e2e-servers.mjs. If the frontend and Worker disagree on a
// contract (renamed field, new required property, changed status code), the
// schema validations and UI assertions below fail. Mocked coverage for the
// same pages lives in the non-`fullstack` specs, which stay fast and
// deterministic through apps/web/e2e/fixtures/apiMocks.ts.
import { expect, test } from "@playwright/test";
import { currentAuthSessionSchema, healthResponseSchema } from "@choir/contracts";
import { z } from "zod";
import { bootstrapFullstack, FULLSTACK_APP_ORIGIN } from "./fixtures/fullstack";

const readinessSchema = z.object({
  requestId: z.string().min(1),
  status: z.literal("ready"),
});

const problemSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1),
});

test("serves the anonymous landing page from the real Worker @webkit-smoke", async ({
  page,
  request,
}) => {
  const health = await request.get(`${FULLSTACK_APP_ORIGIN}/api/health`);
  expect(health.ok()).toBe(true);
  const healthBody = healthResponseSchema.parse(await health.json());
  expect(healthBody).toMatchObject({
    environment: "local",
    service: "choir-management-cloudflare",
    status: "ok",
  });

  const ready = await request.get(`${FULLSTACK_APP_ORIGIN}/api/ready`);
  expect(ready.ok()).toBe(true);
  expect(readinessSchema.parse(await ready.json()).status).toBe("ready");

  // No session exists in this fresh browser context; the Worker answers null
  // and the app must present the signed-out product surface.
  const session = await request.get(`${FULLSTACK_APP_ORIGIN}/api/auth/get-session`);
  expect(session.ok()).toBe(true);
  expect(currentAuthSessionSchema.parse(await session.json())).toBeNull();

  await page.goto(`${FULLSTACK_APP_ORIGIN}/`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("choir moving together");
  await expect(page.getByRole("link", { name: "Explore features" })).toBeVisible();
  await expect(page.getByLabel("Account").getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("keeps OTP sign-in non-enumerating and rejects an unknown code", async ({ page }) => {
  // Nobody seeds this address: the Worker must still answer success (no
  // account enumeration) without capturing any email.
  await page.goto(`${FULLSTACK_APP_ORIGIN}/login`);
  await expect(page.getByRole("heading", { name: "Sign in to Choir Management." })).toBeVisible();
  await page.getByLabel("Email address").fill("nobody.fullstack@example.test");
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "If nobody.fullstack@example.test has access",
  );

  await page.getByLabel("6-digit sign-in code").fill("000000");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("That code is invalid or expired");
});

test("rejects unauthenticated Organization access with typed problems", async ({ request }) => {
  // Seed the tenant so the boundary under test is authentication (401),
  // not hostname resolution (404 for unknown hosts, covered implicitly by
  // every unseeded-host call). If the Worker ever stopped requiring a
  // session here, or changed its problem shape, this fails instead of
  // letting the UI silently render an empty workspace.
  await bootstrapFullstack(request, "fullstack.health@example.test");
  const authStatus = await request.get(`${FULLSTACK_APP_ORIGIN}/api/organization/auth-status`);
  expect(authStatus.status()).toBe(401);
  expect(problemSchema.parse(await authStatus.json()).code).toBe("unauthorized");

  // A second tenant boundary must agree: module state needs the same
  // session, so an anonymous caller cannot enumerate enabled modules.
  const moduleState = await request.get(`${FULLSTACK_APP_ORIGIN}/api/organization/module-state`);
  expect(moduleState.status()).toBe(401);

  const unknownRoute = await request.get(`${FULLSTACK_APP_ORIGIN}/api/organization/no-such-route`);
  expect(unknownRoute.status()).toBe(404);
  expect(problemSchema.parse(await unknownRoute.json()).code).toBe("not_found");
});
