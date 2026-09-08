import type { ProblemDetails } from "@choir/contracts";
import { z } from "zod";
import { readCapturedPlatformEmailsForTest } from "../auth/platformEmail";
import { validateStartupConfig } from "../env";
import { invokeOrganizationRpc, organizationStoreStub } from "../organization/rpc/client";
import { currentOrganizationSchemaVersion } from "../organization/schema";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

// Local-only full-stack E2E seam (Phase 3 browser smoke tests).
//
// These endpoints reset and seed exactly one deterministic test tenant so
// `*.fullstack.spec.ts` suites can drive the real local Worker/D1/DO stack
// through the browser without mocks. They are reachable only when
// `APP_ENV === "local"`; staging and production answer with the same
// `not_found` shape as an unknown route. No other Organization, user, or
// session row is touched.
//
// Web-side contract: apps/web/e2e/fixtures/fullstack.ts is the only caller.
// Keep the literals below in sync with that helper.
const FULLSTACK_ORGANIZATION_ID = "organization-fullstack";
const FULLSTACK_ORGANIZATION_SLUG = "fullstack";
const FULLSTACK_ORGANIZATION_NAME = "Fullstack Test Choir";
const FULLSTACK_DEFAULT_EMAIL = "fullstack.admin@example.test";
const FULLSTACK_HOSTNAMES = ["localhost", "127.0.0.1"] as const;

// Parallel-safe identities: each spec file seeds its own admin user so
// concurrent fullstack workers never delete each other's sessions. Only
// addresses in this namespace are accepted; anything else is a 400.
const fullstackEmailPattern = /^fullstack\.[a-z0-9-]{1,64}@example\.test$/;

const oneTimeCodePattern = /Use (\d{6}) to sign in/;

const bootstrapBodySchema = z.object({
  email: z.string().regex(fullstackEmailPattern).max(320).optional(),
});

const otpQuerySchema = z.object({
  email: z.string().regex(fullstackEmailPattern).max(320),
});

function fullstackLocalPart(email: string): string {
  return email.split("@")[0] ?? "fullstack.admin";
}

function fullstackUserId(email: string): string {
  return `user-${fullstackLocalPart(email)}`;
}

function fullstackMemberId(email: string): string {
  return `member-${fullstackLocalPart(email)}`;
}

function fullstackDisplayName(email: string): string {
  const label = fullstackLocalPart(email).replace(/^fullstack\./, "");
  return `Fullstack ${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function notFound(requestId: string): Response {
  return Response.json(
    {
      code: "not_found",
      message: "The requested API route was not found.",
      requestId,
    } satisfies ProblemDetails,
    { status: 404 },
  );
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/local/fullstack-bootstrap", async (context) => {
    if (context.env.APP_ENV !== "local") {
      return notFound(context.get("requestId"));
    }
    validateStartupConfig(context.env);
    const requestId = context.get("requestId");
    const body = bootstrapBodySchema.safeParse(await context.req.json<unknown>().catch(() => ({})));
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid full-stack test email is required.",
          requestId,
        } satisfies ProblemDetails,
        400,
      );
    }
    const email = body.data.email ?? FULLSTACK_DEFAULT_EMAIL;
    const userId = fullstackUserId(email);
    const database = context.env.CONTROL_DB;
    const occurredAt = new Date().toISOString();
    const createdAt = Date.now();

    // The Organization and its loopback domains are identical on every call,
    // so they are inserted idempotently and never deleted: parallel spec
    // files share them safely. Only the per-file user identity is reset.
    // Identity rows match by id OR email so a stale row left by an older
    // bootstrap shape (different id, same email) can never wedge a later
    // run on the UNIQUE(email) constraint. Everything stays scoped to the
    // single validated test email, so parallel files cannot disturb each
    // other.
    await database.batch([
      database
        .prepare(
          `INSERT OR IGNORE INTO organizations
            (id, name, slug, lifecycle_state, durable_object_key, operational_schema_version,
             created_at, updated_at, provisioned_at)
           VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
        )
        .bind(
          FULLSTACK_ORGANIZATION_ID,
          FULLSTACK_ORGANIZATION_NAME,
          FULLSTACK_ORGANIZATION_SLUG,
          FULLSTACK_ORGANIZATION_ID,
          currentOrganizationSchemaVersion,
          occurredAt,
          occurredAt,
          occurredAt,
        ),
      ...FULLSTACK_HOSTNAMES.map((hostname, index) =>
        database
          .prepare(
            `INSERT OR IGNORE INTO organization_domains
              (id, organization_id, hostname, kind, status, routing_version, created_at, updated_at)
             VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
          )
          .bind(
            `domain-fullstack-${index === 0 ? "localhost" : "loopback"}`,
            FULLSTACK_ORGANIZATION_ID,
            hostname,
            occurredAt,
            occurredAt,
          ),
      ),
      database
        .prepare(
          `DELETE FROM member
            WHERE organizationId = ?
              AND (userId = ? OR userId IN (SELECT id FROM user WHERE email = ?))`,
        )
        .bind(FULLSTACK_ORGANIZATION_ID, userId, email),
      database
        .prepare(
          `DELETE FROM session WHERE userId = ? OR userId IN (SELECT id FROM user WHERE email = ?)`,
        )
        .bind(userId, email),
      database
        .prepare(
          `DELETE FROM account WHERE userId = ? OR userId IN (SELECT id FROM user WHERE email = ?)`,
        )
        .bind(userId, email),
      database.prepare(`DELETE FROM user WHERE id = ? OR email = ?`).bind(userId, email),
      database.prepare(`DELETE FROM verification WHERE identifier LIKE ?`).bind(`%${email}%`),
      // rateLimit rows are ephemeral per-IP/per-path counters, not tenant data.
      // Clearing them keeps OTP sends repeatable across consecutive spec runs
      // from the same loopback address (emailOTP allows 3 sends / 60s).
      database.prepare(`DELETE FROM rateLimit`),
    ]);

    await database.batch([
      database
        .prepare(
          `INSERT INTO user
            (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
           VALUES (?, ?, ?, 1, ?, ?, 0)`,
        )
        .bind(userId, fullstackDisplayName(email), email, createdAt, createdAt),
      database
        .prepare(
          `INSERT INTO member (id, organizationId, userId, role, createdAt)
           VALUES (?, ?, ?, 'admin', ?)`,
        )
        .bind(fullstackMemberId(email), FULLSTACK_ORGANIZATION_ID, userId, createdAt),
    ]);

    // Idempotent for the fixed test identity: the store upserts matching
    // metadata and reports a conflict only for a different Organization.
    const provisionResponse = await invokeOrganizationRpc(
      organizationStoreStub(context.env, FULLSTACK_ORGANIZATION_ID),
      "https://organization.internal/internal/provision",
      {
        body: JSON.stringify({
          actorUserId: "bootstrap",
          canonicalHostname: "localhost",
          canonicalStatus: "active",
          name: FULLSTACK_ORGANIZATION_NAME,
          organizationId: FULLSTACK_ORGANIZATION_ID,
          requestId: crypto.randomUUID(),
          slug: FULLSTACK_ORGANIZATION_SLUG,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    if (!provisionResponse.ok) {
      return context.json(
        {
          code: "service_unavailable",
          message: "The full-stack test Organization could not be prepared.",
          requestId,
        } satisfies ProblemDetails,
        503,
      );
    }

    // Force hostname re-resolution so a previous run (or manual local use)
    // cannot serve a stale cached route for the loopback hostnames.
    await context.env.ROUTING_CACHE.delete("host:localhost");
    await context.env.ROUTING_CACHE.delete("host:127.0.0.1");

    return context.json({
      canonicalHostname: "localhost",
      email,
      organizationId: FULLSTACK_ORGANIZATION_ID,
      organizationName: FULLSTACK_ORGANIZATION_NAME,
    });
  });

  router.get("/api/local/fullstack-otp", (context) => {
    if (context.env.APP_ENV !== "local") {
      return notFound(context.get("requestId"));
    }
    const parsed = otpQuerySchema.safeParse({ email: context.req.query("email") ?? "" });
    if (!parsed.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid full-stack test email is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const email = parsed.data.email;
    const messages = readCapturedPlatformEmailsForTest();
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.kind !== "email-one-time-code") continue;
      if (message.recipient.trim().toLowerCase() !== email) continue;
      const code = oneTimeCodePattern.exec(message.text)?.[1];
      if (code) {
        return context.json({ email, otp: code });
      }
    }
    return context.json(
      {
        code: "otp_not_ready",
        message: "No sign-in code has been captured for the test email yet.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  });
}
