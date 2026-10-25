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
import {
  currentAuthSessionSchema,
  healthResponseSchema,
  publishedOrganizationProjectionSchema,
} from "@choir/contracts";
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
  // and the app must present the signed-out homepage for this hostname.
  const session = await request.get(`${FULLSTACK_APP_ORIGIN}/api/auth/get-session`);
  expect(session.ok()).toBe(true);
  expect(currentAuthSessionSchema.parse(await session.json())).toBeNull();

  // The shared local tenant can already have a published website from the
  // event publication suite or a previous run. Verify the actual projection
  // consumed by this navigation rather than assuming that no site exists.
  const projectionResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/public/projection" &&
      response.request().method() === "GET",
  );
  await page.goto(`${FULLSTACK_APP_ORIGIN}/`);
  const projectionResponse = await projectionResponsePromise;
  let loginLabel = "Sign in";
  if (projectionResponse.status() === 200) {
    const { payload } = publishedOrganizationProjectionSchema.parse(
      await projectionResponse.json(),
    );
    loginLabel = `${payload.performerLabel ?? "Performer"} login`;
    await expect(
      page.getByRole("banner").getByRole("link", {
        name: payload.organizationName,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Public website" })).toBeVisible();
    if (payload.settings.heroHeadline) {
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        payload.settings.heroHeadline,
      );
    }
  } else {
    expect(projectionResponse.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Music Manager");
    await expect(page.getByRole("link", { name: "Upcoming performances" })).toBeVisible();
  }
  await expect(page.getByRole("main")).toBeVisible();
  await expect(
    page.getByRole("banner").getByRole("link", { name: loginLabel, exact: true }),
  ).toBeVisible();
});

test("keeps OTP sign-in non-enumerating and rejects an unknown code", async ({ page }) => {
  // Nobody seeds this address: the Worker must still answer success (no
  // account enumeration) without capturing any email.
  await page.goto(`${FULLSTACK_APP_ORIGIN}/login`);
  await expect(page.getByRole("heading", { name: /^Sign in to / })).toBeVisible();
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
