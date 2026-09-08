import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";

// FULL-STACK fixture layer (reaches the real local Worker/D1/DO stack).
//
// Mocked suites must NOT import this module; they use apiMocks.ts with
// `{ strict: true }` instead. Full-stack suites (`*.fullstack.spec.ts`) use
// these helpers and deliberately register no `page.route(...)` interception
// for app `/api/**` calls, except for third-party provider boundaries
// documented per spec.
//
// Seeding contract: POST /api/local/fullstack-bootstrap prepares the single
// deterministic tenant (`organization-fullstack`, see
// apps/worker/src/routes/localFullstackSeed.ts). That endpoint answers 404
// unless APP_ENV === "local", so staging and production are unaffected. Each
// spec file seeds its own `fullstack.<area>@example.test` admin identity so
// parallel workers never delete each other's sessions; the shared
// Organization and loopback domains are inserted idempotently.
// Operational rows created by earlier runs (events, donations) are left in
// the test Organization's Durable Object; specs therefore create uniquely
// named entities per run (uniqueFullstackName) and assert on those instead
// of on global counts or list positions.
//
// Cookie note: only `page.request` shares the signed-in browser cookies. The
// standalone `request` fixture is a separate context, so specs use `request`
// for anonymous calls (bootstrap, OTP polling) and `page.request` for
// anything that needs the session.

// The specs drive the local Worker origin directly (not the preview
// proxy): `wrangler dev` serves both `/api/*` and the built SPA, and the
// preview proxy rewrites the Host header to 127.0.0.1, which is not a
// canonical auth hostname. `localhost` (not 127.0.0.1) is the canonical test
// hostname: Organization routes resolve the tenant from the request hostname,
// and only `localhost` hostnames are canonical auth hosts when
// PRODUCT_BASE_DOMAIN is `localhost`.
export const FULLSTACK_APP_ORIGIN = "http://localhost:8787";
export const FULLSTACK_ADMIN_EMAIL = "fullstack.admin@example.test";
export const FULLSTACK_ORGANIZATION_NAME = "Fullstack Test Choir";

const bootstrapResponseSchema = z.object({
  canonicalHostname: z.literal("localhost"),
  email: z.string().min(1),
  organizationId: z.literal("organization-fullstack"),
  organizationName: z.string().min(1),
});

const otpResponseSchema = z.object({
  email: z.string().min(1),
  otp: z.string().regex(/^\d{6}$/),
});

export type FullstackBootstrap = z.infer<typeof bootstrapResponseSchema>;

/**
 * Prepare the test tenant and reset one per-file admin identity.
 * Repeatable; no manual cleanup required.
 */
export async function bootstrapFullstack(
  request: APIRequestContext,
  email: string = FULLSTACK_ADMIN_EMAIL,
): Promise<FullstackBootstrap> {
  const response = await request.post(`${FULLSTACK_APP_ORIGIN}/api/local/fullstack-bootstrap`, {
    data: { email },
  });
  expect(response.ok()).toBe(true);
  const seed = bootstrapResponseSchema.parse(await response.json());
  expect(seed.email).toBe(email);
  return seed;
}

async function readFullstackOtpOnce(
  request: APIRequestContext,
  email: string,
): Promise<string | null> {
  const response = await request.get(
    `${FULLSTACK_APP_ORIGIN}/api/local/fullstack-otp?email=${encodeURIComponent(email)}`,
  );
  if (response.status() === 404) return null;
  expect(response.ok()).toBe(true);
  const body = otpResponseSchema.parse(await response.json());
  expect(body.email).toBe(email);
  return body.otp;
}

/**
 * Poll the local-only OTP capture until the Worker has stored the code that
 * `requestSignInCode` sent through PLATFORM_EMAIL_MODE=capture. No real
 * email leaves the machine.
 */
export async function pollFullstackOtp(request: APIRequestContext, email: string): Promise<string> {
  const box: { otp: string | null } = { otp: null };
  await expect
    .poll(async () => {
      box.otp = await readFullstackOtpOnce(request, email);
      return box.otp;
    })
    .toMatch(/^\d{6}$/);
  const otp = box.otp;
  if (otp === null) throw new Error("The full-stack OTP never became available.");
  return otp;
}

/**
 * Complete the real email-code sign-in through the UI. Starts signed out,
 * ends on the admin landing page with a Worker-issued session cookie.
 */
export async function signInWithFullstackOtp(
  page: Page,
  request: APIRequestContext,
  email: string = FULLSTACK_ADMIN_EMAIL,
): Promise<void> {
  await page.goto(`${FULLSTACK_APP_ORIGIN}/login`);
  await expect(page.getByRole("heading", { name: "Sign in to Choir Management." })).toBeVisible();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(`If ${email} has access`);
  const otp = await pollFullstackOtp(request, email);
  await page.getByLabel("6-digit sign-in code").fill(otp);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Administrators land on the Organization workspace after sign-in.
  await expect(page).toHaveURL(/\/admin\/?$/, { timeout: 20_000 });
}

/** Per-run unique entity name so assertions never depend on prior-run rows. */
export function uniqueFullstackName(prefix: string): string {
  return `${prefix} ${String(Date.now())}`;
}
