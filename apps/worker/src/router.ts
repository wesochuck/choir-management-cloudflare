import {
  accountPasswordRequestSchema,
  organizationInvitationRequestSchema,
  organizationEventRequestSchema,
  organizationCalendarSettingsRequestSchema,
  organizationMfaPolicyRequestSchema,
  organizationMfaVerificationRequestSchema,
  organizationProfileRequestSchema,
  organizationRsvpRequestSchema,
  organizationVenueRequestSchema,
  organizationProfileLinkRequestSchema,
  organizationProvisionRequestSchema,
  platformElevationRequestSchema,
  publicDomainRegistrationRequestSchema,
  type HealthResponse,
  type CalendarFeedUrlsResponse,
  type OrganizationContextResponse,
  type OrganizationInvitationActionResponse,
  type OrganizationInvitationDetails,
  type OrganizationInvitationsResponse,
  type OrganizationInvitationSummary,
  type OrganizationProvisionResponse,
  type PlatformOrganizationSummary,
  type PlatformJobDeadLetterSummary,
  type PlatformFleetSchemaPreparation,
  type PlatformOrganizationContextResponse,
  type ProblemDetails,
  type PrivateFileResponse,
} from "@choir/contracts";
import { Hono, type Context } from "hono";
import { requestId } from "hono/request-id";
import { z } from "zod";
import { isValidTimeZone } from "@choir/domain";

import { createAuth, isCanonicalAuthHost, isProductBaseHost } from "./auth/config";
import { createCalendarFeedUrls, readCalendarFeed } from "./calendar/calendarFeed";
import {
  createOrganizationEvent,
  createOrganizationVenue,
  archiveOrganizationEvent,
  listOrganizationEvents,
  listOrganizationVenues,
  readOrganizationCalendarSettings,
  setOrganizationEventRsvp,
  updateOrganizationCalendarSettings,
  updateOrganizationEvent,
} from "./calendar/organizationCalendar";
import { listAccountOrganizations } from "./auth/accountOrganizations";
import {
  authorizePlatformAdministratorSession,
  confirmPlatformAdministratorMfaEnrollment,
  getPlatformAdministratorMfaStatus,
  recordPlatformMfaAssertion,
} from "./auth/platformAdministrator";
import {
  getOrganizationMfaStatus,
  recordOrganizationMfaAssertion,
  setOrganizationMfaPolicy,
} from "./auth/organizationMfa";
import {
  createPlatformElevation,
  getPlatformOrganizationContext,
  revokePlatformElevation,
} from "./auth/platformElevation";
import {
  beginOrganizationProvisioning,
  OrganizationProvisioningError,
} from "./control/provisionOrganization";
import {
  beginFleetSchemaPreparation,
  FleetSchemaPreparationError,
} from "./control/prepareFleetSchema";
import type { Env } from "./env";
import { validateStartupConfig } from "./env";
import { currentOrganizationSchemaVersion } from "./organization/schema";
import { createOrganizationProfile, listOrganizationProfiles } from "./organization/profiles";
import { readPublishedOrganization } from "./publication/publishOrganization";
import {
  MAX_PRIVATE_FILE_BYTES,
  PrivateFileStorageError,
  privateFileContentTypeSchema,
  privateFileIdSchema,
  privateFileNameSchema,
  readPrivateOrganizationFile,
  uploadPrivateOrganizationFile,
} from "./storage/privateFiles";
import { authorizeOrganizationMember } from "./tenancy/authorizeOrganization";
import { linkOrganizationProfile } from "./tenancy/linkOrganizationProfile";
import {
  disablePublicDomain,
  listPublicDomains,
  registerPublicDomain,
} from "./tenancy/registerPublicDomain";
import { resolveOrganization } from "./tenancy/resolveOrganization";

interface WorkerHonoEnvironment {
  Bindings: Env;
  Variables: {
    requestId: string;
  };
}

export const router = new Hono<WorkerHonoEnvironment>();

const PLATFORM_ORGANIZATION_PAGE_SIZE = 25;
const PLATFORM_DEAD_LETTER_PAGE_SIZE = 25;
const ORGANIZATION_INVITATION_PAGE_SIZE = 50;
const browserOrganizationAuthAllowlist = new Set([
  "/api/auth/organization/list",
  "/api/auth/organization/set-active",
]);
const invitationIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
const platformOrganizationCursorSchema = z.tuple([z.iso.datetime(), z.string().min(1).max(128)]);
const platformDeadLetterCursorSchema = z.tuple([z.iso.datetime(), z.string().min(1).max(512)]);

type CalendarAuthorization =
  | { readonly ok: true; readonly organizationId: string; readonly userId: string }
  | {
      readonly code: string;
      readonly message: string;
      readonly ok: false;
      readonly status: 401 | 403 | 404;
    };

async function authorizeCalendarRoute(
  context: Context<WorkerHonoEnvironment>,
  managerOnly: boolean,
): Promise<CalendarAuthorization> {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return {
      code: "not_found",
      message: "Organization calendar management requires a registered canonical hostname.",
      ok: false,
      status: 404,
    };
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id,
    session?.user.id,
  );
  if (!authorization.ok) {
    return {
      code: authorization.error.code,
      message: authorization.error.message,
      ok: false,
      status: authorization.error.code === "unauthorized" ? 401 : 403,
    };
  }
  if (managerOnly && authorization.value.role === "member") {
    return {
      code: "forbidden",
      message: "Only Organization Owners and Administrators may manage calendar data.",
      ok: false,
      status: 403,
    };
  }
  return { ok: true, organizationId, userId: authorization.value.userId };
}

interface PlatformOrganizationRow extends PlatformOrganizationSummary {
  readonly createdAt: string;
}

interface PlatformDeadLetterRow {
  readonly firstSeenAt: string;
  readonly id: string;
  readonly idempotencyKey: string | null;
  readonly jobId: string | null;
  readonly jobKind: PlatformJobDeadLetterSummary["jobKind"];
  readonly lastSeenAt: string;
  readonly messageId: string;
  readonly messageValid: number;
  readonly observationCount: number;
  readonly observedAttempt: number;
  readonly organizationId: string | null;
  readonly queueName: string;
}

type PlatformFleetSchemaPreparationRow = PlatformFleetSchemaPreparation;

interface InvitationControlRow {
  readonly createdAt: number | string;
  readonly email: string;
  readonly expiresAt: number | string;
  readonly id: string;
  readonly inviterId: string;
  readonly organizationId: string;
  readonly role: string | null;
  readonly status: string;
}

function normalizeInvitationRole(
  role: string | null,
): OrganizationInvitationSummary["role"] | null {
  switch (role) {
    case "admin":
      return "administrator";
    case "member":
    case "owner":
      return role;
    default:
      return null;
  }
}

function invitationDate(value: number | string): string {
  return new Date(value).toISOString();
}

function decodePrivateFileName(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = privateFileNameSchema.safeParse(decodeURIComponent(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parsePrivateFileUploadHeaders(headers: Headers): {
  readonly contentType: string;
  readonly fileName: string;
  readonly sizeBytes: number;
} | null {
  const fileName = decodePrivateFileName(headers.get("x-file-name") ?? undefined);
  const contentType = privateFileContentTypeSchema.safeParse(
    headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase(),
  );
  const declaredSize = z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PRIVATE_FILE_BYTES)
    .safeParse(headers.get("content-length"));
  return fileName && contentType.success && declaredSize.success
    ? { contentType: contentType.data, fileName, sizeBytes: declaredSize.data }
    : null;
}

async function findInvitationForOrganization(
  database: D1Database,
  invitationId: string,
  organizationId: string,
): Promise<InvitationControlRow | null> {
  return database
    .prepare(
      `SELECT id, organizationId, email, role, status, expiresAt, createdAt, inviterId
       FROM invitation
       WHERE id = ? AND organizationId = ?
       LIMIT 1`,
    )
    .bind(invitationId, organizationId)
    .first<InvitationControlRow>();
}

async function recordInvitationAudit(
  database: D1Database,
  input: {
    readonly action: string;
    readonly actorUserId: string;
    readonly changeSummary: Readonly<Record<string, string>>;
    readonly invitationId: string;
    readonly organizationId: string;
    readonly requestId: string;
  },
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO platform_audit_events
        (id, actor_user_id, organization_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, ?, ?, ?, 'organization_invitation', ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.actorUserId,
      input.organizationId,
      input.action,
      input.invitationId,
      input.requestId,
      JSON.stringify(input.changeSummary),
      new Date().toISOString(),
    )
    .run();
}

function parsePlatformOrganizationCursor(
  value: string | null,
): readonly [createdAt: string, organizationId: string] | null | undefined {
  if (value === null) {
    return null;
  }
  if (value.length > 128) {
    return undefined;
  }
  const parsed = platformOrganizationCursorSchema.safeParse(value.split("|"));
  return parsed.success ? parsed.data : undefined;
}

function encodePlatformOrganizationCursor(row: PlatformOrganizationRow): string {
  return `${row.createdAt}|${row.organizationId}`;
}

function parsePlatformDeadLetterCursor(
  value: string | null,
): readonly [lastSeenAt: string, id: string] | null | undefined {
  if (value === null) {
    return null;
  }
  if (value.length > 512) {
    return undefined;
  }
  const parsed = platformDeadLetterCursorSchema.safeParse(value.split("|"));
  return parsed.success ? parsed.data : undefined;
}

function encodePlatformDeadLetterCursor(row: PlatformDeadLetterRow): string {
  return `${row.lastSeenAt}|${row.id}`;
}

async function ensurePendingInvitationIdentity(
  database: D1Database,
  auth: ReturnType<typeof createAuth>,
  headers: Headers,
  invitationId: string,
  email: string,
): Promise<void> {
  const now = Date.now();
  const defaultName = email.split("@", 1)[0] ?? "Invited member";
  try {
    await database
      .prepare(
        `INSERT OR IGNORE INTO user
          (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled)
         VALUES (?, ?, ?, 0, ?, ?, 0)`,
      )
      .bind(crypto.randomUUID(), defaultName, email, now, now)
      .run();
  } catch {
    await auth.api.cancelInvitation({ body: { invitationId }, headers }).catch(() => undefined);
    throw new Error("Pending invitation identity creation failed.");
  }
}

async function isAuthorizedPlatformHostname(requestUrl: URL, env: Env): Promise<boolean> {
  if (isProductBaseHost(requestUrl.hostname, env.PRODUCT_BASE_DOMAIN)) {
    return true;
  }
  if (!isCanonicalAuthHost(requestUrl.hostname, env.PRODUCT_BASE_DOMAIN)) {
    return false;
  }
  const resolvedOrganization = await resolveOrganization(requestUrl, env);
  return resolvedOrganization.ok && resolvedOrganization.value.routeKind === "canonical";
}

async function resolveCanonicalOrganizationId(requestUrl: URL, env: Env): Promise<string | null> {
  if (!isCanonicalAuthHost(requestUrl.hostname, env.PRODUCT_BASE_DOMAIN)) {
    return null;
  }
  const resolvedOrganization = await resolveOrganization(requestUrl, env);
  return resolvedOrganization.ok && resolvedOrganization.value.routeKind === "canonical"
    ? resolvedOrganization.value.organizationId
    : null;
}

async function verifySecondFactor(
  auth: ReturnType<typeof createAuth>,
  headers: Headers,
  verification:
    | { readonly code: string; readonly method: "recovery_code" }
    | { readonly code: string; readonly method: "totp" },
): Promise<boolean> {
  try {
    if (verification.method === "totp") {
      await auth.api.verifyTOTP({
        body: { code: verification.code, trustDevice: false },
        headers,
      });
    } else {
      await auth.api.verifyBackupCode({
        body: { code: verification.code, disableSession: true, trustDevice: false },
        headers,
      });
    }
    return true;
  } catch {
    return false;
  }
}

router.use("*", requestId());
router.use("*", async (context, next) => {
  await next();
  const responsePath = new URL(context.req.url).pathname;
  const publicProjectionResponse =
    responsePath === "/api/public/projection" &&
    (context.res.status === 200 || context.res.status === 304);
  context.header(
    "cache-control",
    publicProjectionResponse ? "public, max-age=60, stale-while-revalidate=300" : "no-store",
  );
  context.header(
    "referrer-policy",
    responsePath === "/api/calendar/feed" ? "no-referrer" : "strict-origin-when-cross-origin",
  );
  context.header("x-content-type-options", "nosniff");
  context.header("x-frame-options", "DENY");
});

router.get("/api/health", (context) => {
  const config = validateStartupConfig(context.env);
  const response: HealthResponse = {
    environment: config.APP_ENV,
    requestId: context.get("requestId"),
    service: "choir-management-cloudflare",
    status: "ok",
    version: config.BUILD_VERSION,
  };

  return context.json(response);
});

router.get("/api/ready", async (context) => {
  const requestIdValue = context.get("requestId");

  try {
    validateStartupConfig(context.env);
    await context.env.CONTROL_DB.prepare("SELECT 1 AS ready").first<{ ready: number }>();
    return context.json({ requestId: requestIdValue, status: "ready" as const });
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        errorType: error instanceof Error ? error.name : "UnknownError",
        event: "readiness_check_failed",
        requestId: requestIdValue,
      }),
    );
    const problem: ProblemDetails = {
      code: "service_not_ready",
      message: "The service is not ready.",
      requestId: requestIdValue,
    };
    return context.json(problem, 503);
  }
});

router.get("/api/public/projection", async (context) => {
  validateStartupConfig(context.env);
  const resolvedOrganization = await resolveOrganization(new URL(context.req.url), context.env);
  if (!resolvedOrganization.ok) {
    return context.json(
      {
        code: "not_found",
        message: "No published Organization website is available for this hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const published = await readPublishedOrganization(
    context.env,
    resolvedOrganization.value.organizationId,
  );
  if (!published) {
    return context.json(
      {
        code: "not_found",
        message: "No published Organization website is available for this hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  context.header("etag", published.httpEtag);
  context.header("vary", "Host");
  if (context.req.header("if-none-match") === published.httpEtag) {
    return context.body(null, 304);
  }
  return context.json(published.projection);
});

router.get("/api/calendar/feed", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  const token = requestUrl.searchParams.get("token") ?? "";
  if (!organizationId || token.length === 0 || token.length > 4096) {
    return context.json(
      {
        code: "not_found",
        message: "The calendar feed is unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const feed = await readCalendarFeed(context.env, organizationId, token).catch(() => null);
  if (!feed) {
    return context.json(
      {
        code: "not_found",
        message: "The calendar feed is unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  context.header("content-disposition", `attachment; filename="${feed.filename}"`);
  context.header("content-type", "text/calendar; charset=utf-8");
  return context.body(feed.body);
});

router.get("/api/singer/calendar-feed-url", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "Calendar subscriptions require a canonical Organization hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id,
    session?.user.id,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }
  const urls = await createCalendarFeedUrls(context.env, {
    action: "read",
    actorUserId: authorization.value.userId,
    canonicalOrigin: requestUrl.origin,
    organizationId,
    requestId: context.get("requestId"),
  });
  if (!urls) {
    return context.json(
      {
        code: "not_found",
        message: "A linked Organization Profile is required for calendar subscriptions.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  return context.json({
    ...urls,
    requestId: context.get("requestId"),
  } satisfies CalendarFeedUrlsResponse);
});

router.post("/api/singer/calendar-feed-url/reset", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "Calendar subscriptions require a canonical Organization hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id,
    session?.user.id,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }
  const urls = await createCalendarFeedUrls(context.env, {
    action: "reset",
    actorUserId: authorization.value.userId,
    canonicalOrigin: requestUrl.origin,
    organizationId,
    requestId: context.get("requestId"),
  });
  if (!urls) {
    return context.json(
      {
        code: "not_found",
        message: "A linked Organization Profile is required for calendar subscriptions.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  return context.json({
    ...urls,
    requestId: context.get("requestId"),
  } satisfies CalendarFeedUrlsResponse);
});

router.put("/api/organization/files/:fileId", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  const fileId = privateFileIdSchema.safeParse(context.req.param("fileId"));
  if (!organizationId || !fileId.success) {
    return context.json(
      {
        code: "not_found",
        message: "Private files require a registered canonical Organization hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id,
    session?.user.id,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }
  const uploadHeaders = parsePrivateFileUploadHeaders(context.req.raw.headers);
  if (!uploadHeaders) {
    return context.json(
      {
        code: "validation_failed",
        message:
          "A valid encoded file name, content type, and bounded content length are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const body = await context.req.arrayBuffer();
  if (body.byteLength !== uploadHeaders.sizeBytes) {
    return context.json(
      {
        code: "validation_failed",
        message: "The private file body does not match its declared content length.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const uploaded = await uploadPrivateOrganizationFile(context.env, {
      actorUserId: authorization.value.userId,
      body,
      contentType: uploadHeaders.contentType,
      fileId: fileId.data,
      fileName: uploadHeaders.fileName,
      organizationId,
      requestId: context.get("requestId"),
      sizeBytes: body.byteLength,
    });
    const response: PrivateFileResponse = {
      ...uploaded,
      requestId: context.get("requestId"),
    };
    return context.json(response, 201);
  } catch (error: unknown) {
    const conflict = error instanceof PrivateFileStorageError && error.kind === "conflict";
    return context.json(
      {
        code: conflict ? "conflict" : "service_unavailable",
        message: conflict
          ? "The private file ID is already in use."
          : "The private file could not be stored safely.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      conflict ? 409 : 503,
    );
  }
});

router.get("/api/organization/files/:fileId", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  const fileId = privateFileIdSchema.safeParse(context.req.param("fileId"));
  if (!organizationId || !fileId.success) {
    return context.json(
      {
        code: "not_found",
        message: "The private Organization file was not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id,
    session?.user.id,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }
  try {
    const file = await readPrivateOrganizationFile(context.env, organizationId, fileId.data);
    if (!file) {
      return context.json(
        {
          code: "not_found",
          message: "The private Organization file was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    context.header(
      "content-disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.metadata.fileName)}`,
    );
    context.header("content-length", String(file.metadata.sizeBytes));
    context.header("content-type", file.metadata.contentType);
    context.header("etag", file.object.httpEtag);
    return context.body(file.object.body);
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The private Organization file is temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.on(["GET", "POST"], "/api/auth/*", async (context) => {
  const config = validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);

  if (
    requestUrl.pathname.startsWith("/api/auth/organization/") &&
    !browserOrganizationAuthAllowlist.has(requestUrl.pathname)
  ) {
    return context.json(
      {
        code: "not_found",
        message: "The requested authentication route is not available.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }

  const hostnameIsProductBase = isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN);
  const hostnameIsWithinProduct = isCanonicalAuthHost(
    requestUrl.hostname,
    config.PRODUCT_BASE_DOMAIN,
  );
  const resolvedAuthOrganization =
    hostnameIsProductBase || !hostnameIsWithinProduct
      ? null
      : await resolveOrganization(requestUrl, context.env);
  const hostnameIsRegisteredOrganization =
    resolvedAuthOrganization?.ok === true &&
    resolvedAuthOrganization.value.routeKind === "canonical";
  if (!hostnameIsWithinProduct || (!hostnameIsProductBase && !hostnameIsRegisteredOrganization)) {
    const problem: ProblemDetails = {
      code: "not_found",
      message: "Authentication is available only on a canonical product hostname.",
      requestId: context.get("requestId"),
    };
    return context.json(problem, 404);
  }

  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  return auth.handler(context.req.raw);
});

router.get("/api/account/organizations", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
    return context.json(
      {
        code: "not_found",
        message: "Account management requires a canonical product hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }

  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Sign in is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      401,
    );
  }

  return context.json({
    organizations: await listAccountOrganizations(context.env.CONTROL_DB, session.user.id),
  });
});

router.get("/api/account/security", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
    return context.json(
      {
        code: "not_found",
        message: "Account management requires a canonical product hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Sign in is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      401,
    );
  }
  const credential = await context.env.CONTROL_DB.prepare(
    `SELECT 1 AS passwordSet
     FROM account
     WHERE userId = ? AND providerId = 'credential' AND password IS NOT NULL
     LIMIT 1`,
  )
    .bind(session.user.id)
    .first<{ passwordSet: number }>();
  return context.json({
    passwordSet: credential?.passwordSet === 1,
    requestId: context.get("requestId"),
  });
});

router.put("/api/account/password", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
    return context.json(
      {
        code: "not_found",
        message: "Account management requires a canonical product hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const parsedBody = accountPasswordRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!parsedBody.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "Passwords must contain between 12 and 128 characters.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Sign in is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      401,
    );
  }
  const credential = await context.env.CONTROL_DB.prepare(
    `SELECT 1 AS passwordSet
     FROM account
     WHERE userId = ? AND providerId = 'credential' AND password IS NOT NULL
     LIMIT 1`,
  )
    .bind(session.user.id)
    .first<{ passwordSet: number }>();
  const passwordSet = credential?.passwordSet === 1;
  if (
    (passwordSet && parsedBody.data.mode !== "change") ||
    (!passwordSet && parsedBody.data.mode !== "set")
  ) {
    return context.json(
      {
        code: "conflict",
        message: passwordSet
          ? "The current password is required to change this account password."
          : "This account does not have a password yet.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      409,
    );
  }
  try {
    if (parsedBody.data.mode === "set") {
      await auth.api.setPassword({
        body: { newPassword: parsedBody.data.newPassword },
        headers: context.req.raw.headers,
      });
    } else {
      await auth.api.changePassword({
        body: {
          currentPassword: parsedBody.data.currentPassword,
          newPassword: parsedBody.data.newPassword,
          revokeOtherSessions: false,
        },
        headers: context.req.raw.headers,
      });
    }
  } catch {
    return context.json(
      {
        code: "password_update_failed",
        message: "The password could not be updated. Check the current password and try again.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  return context.json({ passwordSet: true, requestId: context.get("requestId") });
});

router.get("/api/organization/context", async (context) => {
  const config = validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const resolvedOrganization = await resolveOrganization(requestUrl, context.env);
  if (!resolvedOrganization.ok) {
    const problem: ProblemDetails = {
      code: resolvedOrganization.error.code,
      message: resolvedOrganization.error.message,
      requestId: context.get("requestId"),
    };
    return context.json(
      problem,
      resolvedOrganization.error.code === "validation_failed" ? 400 : 404,
    );
  }
  if (resolvedOrganization.value.routeKind !== "canonical") {
    const problem: ProblemDetails = {
      code: "not_found",
      message: "Authenticated Organization routes require a canonical product hostname.",
      requestId: context.get("requestId"),
    };
    return context.json(problem, 404);
  }
  if (!isCanonicalAuthHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
    const problem: ProblemDetails = {
      code: "not_found",
      message: "Authenticated Organization routes require a canonical product hostname.",
      requestId: context.get("requestId"),
    };
    return context.json(problem, 404);
  }

  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    resolvedOrganization.value.organizationId,
    session?.session.id,
    session?.user.id,
  );
  if (!authorization.ok) {
    const problem: ProblemDetails = {
      code: authorization.error.code,
      message: authorization.error.message,
      requestId: context.get("requestId"),
    };
    return context.json(problem, authorization.error.code === "unauthorized" ? 401 : 403);
  }

  const response: OrganizationContextResponse = {
    organizationId: authorization.value.organizationId,
    requestId: context.get("requestId"),
    role: authorization.value.role,
    userId: authorization.value.userId,
  };
  return context.json(response);
});

router.get("/api/organization/profiles", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "Organization Profiles require a registered canonical hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id,
    session?.user.id,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }
  try {
    return context.json({
      profiles: await listOrganizationProfiles(context.env, organizationId),
      requestId: context.get("requestId"),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Organization Profiles are temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.post("/api/organization/profiles", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "Organization Profiles require a registered canonical hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const parsedBody = organizationProfileRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!parsedBody.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A Profile display name is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id,
    session?.user.id,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }
  if (authorization.value.role === "member") {
    return context.json(
      {
        code: "forbidden",
        message: "Only Organization Owners and Administrators may create Profiles.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }
  try {
    const profile = await createOrganizationProfile(context.env, {
      actorUserId: authorization.value.userId,
      displayName: parsedBody.data.displayName,
      organizationId,
      requestId: context.get("requestId"),
    });
    return context.json({ ...profile, requestId: context.get("requestId") }, 201);
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Organization Profile could not be created.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.get("/api/organization/venues", async (context) => {
  const authorization = await authorizeCalendarRoute(context, false);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    return context.json({
      requestId: context.get("requestId"),
      venues: await listOrganizationVenues(context.env, authorization.organizationId),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Organization venues are temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.get("/api/organization/calendar-settings", async (context) => {
  const authorization = await authorizeCalendarRoute(context, false);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    return context.json({
      ...(await readOrganizationCalendarSettings(context.env, authorization.organizationId)),
      requestId: context.get("requestId"),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Organization calendar settings are temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.put("/api/organization/calendar-settings", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const body = organizationCalendarSettingsRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success || !isValidTimeZone(body.data.timezone)) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid IANA Organization timezone is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const settings = await updateOrganizationCalendarSettings(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      body.data,
    );
    return context.json({ ...settings, requestId: context.get("requestId") });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Organization timezone could not be updated.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.post("/api/organization/venues", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const body = organizationVenueRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid venue name and address are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const venue = await createOrganizationVenue(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      body.data,
    );
    return context.json({ ...venue, requestId: context.get("requestId") }, 201);
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Organization venue could not be created.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.get("/api/organization/events", async (context) => {
  const authorization = await authorizeCalendarRoute(context, false);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    return context.json({
      events: await listOrganizationEvents(context.env, authorization.organizationId),
      requestId: context.get("requestId"),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Organization events are temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.post("/api/organization/events", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const body = organizationEventRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "Valid event details are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const event = await createOrganizationEvent(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      body.data,
    );
    return context.json({ ...event, requestId: context.get("requestId") }, 201);
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Organization event could not be created.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.put("/api/organization/events/:eventId", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const eventId = z.uuid().safeParse(context.req.param("eventId"));
  const body = organizationEventRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!eventId.success || !body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid event and event details are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const event = await updateOrganizationEvent(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      eventId.data,
      body.data,
    );
    return context.json({ ...event, requestId: context.get("requestId") });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Organization event could not be updated.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.delete("/api/organization/events/:eventId", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const eventId = z.uuid().safeParse(context.req.param("eventId"));
  if (!eventId.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid event is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const result = await archiveOrganizationEvent(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      eventId.data,
    );
    return context.json({ ...result, requestId: context.get("requestId") });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Organization event could not be archived.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.put("/api/organization/events/:eventId/rsvp", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const eventId = z.uuid().safeParse(context.req.param("eventId"));
  const body = organizationRsvpRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!eventId.success || !body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid event, Profile, and RSVP are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const rsvp = await setOrganizationEventRsvp(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      eventId.data,
      body.data,
    );
    return context.json({ ...rsvp, requestId: context.get("requestId") });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Organization RSVP could not be updated.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.post("/api/organization/invitations", async (context) => {
  const config = validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const resolvedOrganization = await resolveOrganization(requestUrl, context.env);
  if (
    !resolvedOrganization.ok ||
    resolvedOrganization.value.routeKind !== "canonical" ||
    !isCanonicalAuthHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)
  ) {
    return context.json(
      {
        code: "not_found",
        message: "Organization invitations require a canonical product hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const parsedBody = organizationInvitationRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!parsedBody.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid invitation email and Organization role are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }

  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    resolvedOrganization.value.organizationId,
    session?.session.id,
    session?.user.id,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }
  if (authorization.value.role === "member") {
    return context.json(
      {
        code: "forbidden",
        message: "Only Organization Owners and Administrators may invite members.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }
  if (parsedBody.data.role === "owner" && authorization.value.role !== "owner") {
    return context.json(
      {
        code: "forbidden",
        message: "Only an Organization Owner may invite another Owner.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }

  const email = parsedBody.data.email.toLowerCase();
  const betterAuthRole = parsedBody.data.role === "administrator" ? "admin" : parsedBody.data.role;
  try {
    const invitation = await auth.api.createInvitation({
      body: {
        email,
        organizationId: resolvedOrganization.value.organizationId,
        role: betterAuthRole,
      },
      headers: context.req.raw.headers,
    });
    await ensurePendingInvitationIdentity(
      context.env.CONTROL_DB,
      auth,
      context.req.raw.headers,
      invitation.id,
      email,
    );
    await recordInvitationAudit(context.env.CONTROL_DB, {
      action: "organization.invitation.created",
      actorUserId: authorization.value.userId,
      changeSummary: { role: parsedBody.data.role, status: "pending" },
      invitationId: invitation.id,
      organizationId: resolvedOrganization.value.organizationId,
      requestId: context.get("requestId"),
    });
    return context.json(
      {
        expiresAt: invitation.expiresAt.toISOString(),
        id: invitation.id,
        requestId: context.get("requestId"),
        status: invitation.status,
      },
      201,
    );
  } catch {
    return context.json(
      {
        code: "conflict",
        message: "The Organization invitation could not be created.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      409,
    );
  }
});

router.get("/api/organization/invitations", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "Organization invitations require a registered canonical hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }

  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id,
    session?.user.id,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }
  if (authorization.value.role === "member") {
    return context.json(
      {
        code: "forbidden",
        message: "Only Organization Owners and Administrators may view invitations.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }

  const rows = await context.env.CONTROL_DB.prepare(
    `SELECT id, organizationId, email, role, status, expiresAt, createdAt, inviterId
     FROM invitation
     WHERE organizationId = ? AND status = 'pending' AND expiresAt > ?
     ORDER BY createdAt DESC, id DESC
     LIMIT ?`,
  )
    .bind(organizationId, Date.now(), ORGANIZATION_INVITATION_PAGE_SIZE + 1)
    .all<InvitationControlRow>();
  const invitations = rows.results
    .slice(0, ORGANIZATION_INVITATION_PAGE_SIZE)
    .flatMap((row): OrganizationInvitationSummary[] => {
      const role = normalizeInvitationRole(row.role);
      return role
        ? [
            {
              createdAt: invitationDate(row.createdAt),
              email: row.email,
              expiresAt: invitationDate(row.expiresAt),
              id: row.id,
              role,
              status: "pending",
            },
          ]
        : [];
    });
  const response: OrganizationInvitationsResponse = {
    invitations,
    requestId: context.get("requestId"),
    truncated: rows.results.length > ORGANIZATION_INVITATION_PAGE_SIZE,
  };
  return context.json(response);
});

router.delete("/api/organization/invitations/:invitationId", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  const invitationId = invitationIdSchema.safeParse(context.req.param("invitationId"));
  if (!organizationId || !invitationId.success) {
    return context.json(
      {
        code: "not_found",
        message: "The pending Organization invitation was not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }

  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id,
    session?.user.id,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }
  if (authorization.value.role === "member") {
    return context.json(
      {
        code: "forbidden",
        message: "Only Organization Owners and Administrators may cancel invitations.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }

  const invitation = await findInvitationForOrganization(
    context.env.CONTROL_DB,
    invitationId.data,
    organizationId,
  );
  if (invitation?.status !== "pending") {
    return context.json(
      {
        code: "not_found",
        message: "The pending Organization invitation was not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  if (invitation.role === "owner" && authorization.value.role !== "owner") {
    return context.json(
      {
        code: "forbidden",
        message: "Only an Organization Owner may cancel an Owner invitation.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }

  try {
    await auth.api.cancelInvitation({
      body: { invitationId: invitationId.data },
      headers: context.req.raw.headers,
    });
  } catch {
    return context.json(
      {
        code: "conflict",
        message: "The Organization invitation could not be canceled.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      409,
    );
  }
  await recordInvitationAudit(context.env.CONTROL_DB, {
    action: "organization.invitation.canceled",
    actorUserId: authorization.value.userId,
    changeSummary: {
      from: "pending",
      role: normalizeInvitationRole(invitation.role) ?? "unknown",
      to: "canceled",
    },
    invitationId: invitationId.data,
    organizationId,
    requestId: context.get("requestId"),
  });
  const response: OrganizationInvitationActionResponse = {
    id: invitationId.data,
    requestId: context.get("requestId"),
    status: "canceled",
  };
  return context.json(response);
});

router.get("/api/organization/invitations/:invitationId", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  const invitationId = invitationIdSchema.safeParse(context.req.param("invitationId"));
  if (!organizationId || !invitationId.success) {
    return context.json(
      {
        code: "not_found",
        message: "The pending Organization invitation was not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Sign in is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      401,
    );
  }
  const invitationRow = await findInvitationForOrganization(
    context.env.CONTROL_DB,
    invitationId.data,
    organizationId,
  );
  if (!invitationRow) {
    return context.json(
      {
        code: "not_found",
        message: "The pending Organization invitation was not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  try {
    const invitation = await auth.api.getInvitation({
      headers: context.req.raw.headers,
      query: { id: invitationId.data },
    });
    const role = normalizeInvitationRole(invitation.role);
    if (!role) {
      throw new Error("Unsupported Organization invitation role.");
    }
    const response: OrganizationInvitationDetails = {
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
      id: invitation.id,
      inviterEmail: invitation.inviterEmail,
      organizationId: invitation.organizationId,
      organizationName: invitation.organizationName,
      organizationSlug: invitation.organizationSlug,
      role,
      status: "pending",
    };
    return context.json(response);
  } catch {
    return context.json(
      {
        code: "not_found",
        message: "The pending Organization invitation was not found for this signed-in email.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
});

router.post("/api/organization/invitations/:invitationId/accept", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  const invitationId = invitationIdSchema.safeParse(context.req.param("invitationId"));
  if (!organizationId || !invitationId.success) {
    return context.json(
      {
        code: "not_found",
        message: "The pending Organization invitation was not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Sign in is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      401,
    );
  }
  const invitation = await findInvitationForOrganization(
    context.env.CONTROL_DB,
    invitationId.data,
    organizationId,
  );
  if (invitation?.status !== "pending") {
    return context.json(
      {
        code: "not_found",
        message: "The pending Organization invitation was not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  try {
    await auth.api.acceptInvitation({
      body: { invitationId: invitationId.data },
      headers: context.req.raw.headers,
    });
  } catch {
    return context.json(
      {
        code: "conflict",
        message: "The Organization invitation could not be accepted.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      409,
    );
  }
  await recordInvitationAudit(context.env.CONTROL_DB, {
    action: "organization.invitation.accepted",
    actorUserId: session.user.id,
    changeSummary: {
      from: "pending",
      role: normalizeInvitationRole(invitation.role) ?? "unknown",
      to: "accepted",
    },
    invitationId: invitationId.data,
    organizationId,
    requestId: context.get("requestId"),
  });
  const response: OrganizationInvitationActionResponse = {
    id: invitationId.data,
    requestId: context.get("requestId"),
    status: "accepted",
  };
  return context.json(response);
});

router.post("/api/organization/invitations/:invitationId/reject", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  const invitationId = invitationIdSchema.safeParse(context.req.param("invitationId"));
  if (!organizationId || !invitationId.success) {
    return context.json(
      {
        code: "not_found",
        message: "The pending Organization invitation was not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Sign in is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      401,
    );
  }
  const invitation = await findInvitationForOrganization(
    context.env.CONTROL_DB,
    invitationId.data,
    organizationId,
  );
  if (invitation?.status !== "pending") {
    return context.json(
      {
        code: "not_found",
        message: "The pending Organization invitation was not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  try {
    await auth.api.rejectInvitation({
      body: { invitationId: invitationId.data },
      headers: context.req.raw.headers,
    });
  } catch {
    return context.json(
      {
        code: "conflict",
        message: "The Organization invitation could not be declined.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      409,
    );
  }
  await recordInvitationAudit(context.env.CONTROL_DB, {
    action: "organization.invitation.rejected",
    actorUserId: session.user.id,
    changeSummary: {
      from: "pending",
      role: normalizeInvitationRole(invitation.role) ?? "unknown",
      to: "rejected",
    },
    invitationId: invitationId.data,
    organizationId,
    requestId: context.get("requestId"),
  });
  const response: OrganizationInvitationActionResponse = {
    id: invitationId.data,
    requestId: context.get("requestId"),
    status: "rejected",
  };
  return context.json(response);
});

router.get("/api/organization/auth-status", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "Organization authentication status requires a registered canonical hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }

  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id,
    session?.user.id,
    { enforceMfa: false },
  );
  if (!authorization.ok || !session) {
    const code = authorization.ok ? "unauthorized" : authorization.error.code;
    const message = authorization.ok ? "Sign in is required." : authorization.error.message;
    return context.json(
      { code, message, requestId: context.get("requestId") } satisfies ProblemDetails,
      code === "unauthorized" ? 401 : 403,
    );
  }

  const status = await getOrganizationMfaStatus(context.env.CONTROL_DB, {
    organizationId,
    sessionId: session.session.id,
    userId: authorization.value.userId,
  });
  if (!status.ok) {
    return context.json(
      {
        code: status.error.code,
        message: status.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }
  return context.json({
    mfaRequired: status.value.mfaRequired,
    mfaVerifiedUntil: status.value.mfaVerifiedUntil
      ? new Date(status.value.mfaVerifiedUntil).toISOString()
      : null,
    organizationId,
    requestId: context.get("requestId"),
    role: authorization.value.role,
    twoFactorEnabled: status.value.twoFactorEnabled,
    twoFactorVerified: status.value.twoFactorVerified,
  });
});

router.patch("/api/organization/auth-policy", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "Organization authentication policy requires a registered canonical hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const parsedBody = organizationMfaPolicyRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!parsedBody.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid Organization MFA policy is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }

  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id,
    session?.user.id,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }
  if (authorization.value.role !== "owner") {
    return context.json(
      {
        code: "forbidden",
        message: "Only an Organization Owner may change the Organization MFA policy.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }

  const updated = await setOrganizationMfaPolicy(context.env.CONTROL_DB, {
    actorUserId: authorization.value.userId,
    mfaRequired: parsedBody.data.mfaRequired,
    organizationId,
    requestId: context.get("requestId"),
  });
  if (!updated.ok) {
    return context.json(
      {
        code: updated.error.code,
        message: updated.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  return context.json({
    mfaRequired: updated.value.mfaRequired,
    organizationId,
    requestId: context.get("requestId"),
  });
});

router.post("/api/organization/mfa/verify", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "Organization MFA requires a registered canonical hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const parsedBody = organizationMfaVerificationRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!parsedBody.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid Organization MFA code and method are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }

  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id,
    session?.user.id,
    { enforceMfa: false },
  );
  if (!authorization.ok || !session) {
    const code = authorization.ok ? "unauthorized" : authorization.error.code;
    const message = authorization.ok ? "Sign in is required." : authorization.error.message;
    return context.json(
      { code, message, requestId: context.get("requestId") } satisfies ProblemDetails,
      code === "unauthorized" ? 401 : 403,
    );
  }
  if (!authorization.value.mfaRequired) {
    return context.json(
      {
        code: "conflict",
        message: "This Organization does not currently require MFA.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      409,
    );
  }

  if (!(await verifySecondFactor(auth, context.req.raw.headers, parsedBody.data))) {
    return context.json(
      {
        code: "unauthorized",
        message: "Organization MFA verification failed.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      401,
    );
  }

  const assertion = await recordOrganizationMfaAssertion(context.env.CONTROL_DB, {
    method: parsedBody.data.method,
    organizationId,
    sessionId: session.session.id,
    userId: authorization.value.userId,
  });
  if (!assertion.ok) {
    return context.json(
      {
        code: assertion.error.code,
        message: assertion.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      assertion.error.code === "conflict" ? 409 : 403,
    );
  }
  return context.json({
    expiresAt: new Date(assertion.value.expiresAt).toISOString(),
    organizationId,
    requestId: context.get("requestId"),
    status: "verified" as const,
  });
});

router.put("/api/organization/members/:membershipId/profile", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  const membershipId = z.string().min(1).max(128).safeParse(context.req.param("membershipId"));
  if (!organizationId || !membershipId.success) {
    return context.json(
      {
        code: "not_found",
        message: "The Organization Membership was not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const parsedBody = organizationProfileLinkRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!parsedBody.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid Organization Profile ID is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }

  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id,
    session?.user.id,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }
  if (authorization.value.role === "member") {
    return context.json(
      {
        code: "forbidden",
        message: "Only Organization Owners and Administrators may link Profiles.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }

  try {
    const linked = await linkOrganizationProfile(context.env, {
      actorUserId: authorization.value.userId,
      membershipId: membershipId.data,
      organizationId,
      profileId: parsedBody.data.profileId,
      requestId: context.get("requestId"),
    });
    if (!linked.ok) {
      return context.json(
        {
          code: linked.error.code,
          message: linked.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        linked.error.code === "conflict" ? 409 : 404,
      );
    }
    return context.json({ ...linked.value, requestId: context.get("requestId") });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Organization Profile verification is temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.get("/api/organization/public-domains", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "Public Website Domain settings require a registered canonical hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id,
    session?.user.id,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }
  if (authorization.value.role === "member") {
    return context.json(
      {
        code: "forbidden",
        message: "Only Organization Owners and Administrators may view Public Website Domains.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }
  return context.json({ domains: await listPublicDomains(context.env.CONTROL_DB, organizationId) });
});

router.post("/api/organization/public-domains", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "Public Website Domain registration requires a canonical product hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const parsedBody = publicDomainRegistrationRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!parsedBody.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid Public Website Domain hostname is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id,
    session?.user.id,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }
  if (authorization.value.role !== "owner") {
    return context.json(
      {
        code: "forbidden",
        message: "Only an Organization Owner may register a Public Website Domain.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }

  const registration = await registerPublicDomain(context.env, {
    actorUserId: authorization.value.userId,
    hostname: parsedBody.data.hostname,
    organizationId,
    requestId: context.get("requestId"),
  });
  if (!registration.ok) {
    const status = registration.error.code === "validation_failed" ? 400 : 409;
    return context.json(
      {
        code: registration.error.code,
        message: registration.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      status,
    );
  }
  return context.json({ ...registration.value, requestId: context.get("requestId") }, 201);
});

router.delete("/api/organization/public-domains/:domainId", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  const domainId = z.uuid().safeParse(context.req.param("domainId"));
  if (!organizationId || !domainId.success) {
    return context.json(
      {
        code: "not_found",
        message: "The Public Website Domain was not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id,
    session?.user.id,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }
  if (authorization.value.role !== "owner") {
    return context.json(
      {
        code: "forbidden",
        message: "Only an Organization Owner may disable a Public Website Domain.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }

  const disabled = await disablePublicDomain(context.env, {
    actorUserId: authorization.value.userId,
    domainId: domainId.data,
    organizationId,
    requestId: context.get("requestId"),
  });
  if (!disabled.ok) {
    return context.json(
      {
        code: disabled.error.code,
        message: disabled.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  return context.json({ ...disabled.value, requestId: context.get("requestId") });
});

router.get("/api/platform/mfa/status", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
    return context.json(
      {
        code: "not_found",
        message: "Platform administration requires a canonical product hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Sign in is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      401,
    );
  }
  return context.json({
    ...(await getPlatformAdministratorMfaStatus(context.env.CONTROL_DB, session.user.id)),
    requestId: context.get("requestId"),
  });
});

router.post("/api/platform/mfa/confirm-enrollment", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
    return context.json(
      {
        code: "not_found",
        message: "Platform administration requires a canonical product hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const confirmation = await confirmPlatformAdministratorMfaEnrollment(
    context.env.CONTROL_DB,
    session?.user.id ?? null,
  );
  if (!confirmation.ok) {
    return context.json(
      {
        code: confirmation.error.code,
        message: confirmation.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      confirmation.error.code === "unauthorized" ? 401 : 403,
    );
  }
  return context.json({ status: "confirmed" as const });
});

const platformMfaVerificationSchema = z.discriminatedUnion("method", [
  z.object({ code: z.string().regex(/^\d{6}$/), method: z.literal("totp") }),
  z.object({ code: z.string().min(8).max(128), method: z.literal("recovery_code") }),
]);

router.post("/api/platform/mfa/verify", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  if (!(await isAuthorizedPlatformHostname(requestUrl, context.env))) {
    return context.json(
      {
        code: "not_found",
        message: "Platform administration requires a canonical product hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const parsedBody = platformMfaVerificationSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!parsedBody.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid Platform Administrator MFA code and method are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }

  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const existingAuthorization = await authorizePlatformAdministratorSession(
    context.env.CONTROL_DB,
    session?.session.id ?? null,
    session?.user.id ?? null,
  );
  if (!existingAuthorization.ok && existingAuthorization.error.code === "forbidden") {
    return context.json(
      {
        code: existingAuthorization.error.code,
        message: existingAuthorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Sign in is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      401,
    );
  }

  try {
    if (parsedBody.data.method === "totp") {
      await auth.api.verifyTOTP({
        body: { code: parsedBody.data.code, trustDevice: false },
        headers: context.req.raw.headers,
      });
    } else {
      await auth.api.verifyBackupCode({
        body: { code: parsedBody.data.code, disableSession: true, trustDevice: false },
        headers: context.req.raw.headers,
      });
    }
  } catch {
    return context.json(
      {
        code: "unauthorized",
        message: "Platform Administrator MFA verification failed.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      401,
    );
  }

  const assertion = await recordPlatformMfaAssertion(
    context.env.CONTROL_DB,
    session.session.id,
    session.user.id,
    parsedBody.data.method,
  );
  if (!assertion.ok) {
    return context.json(
      {
        code: assertion.error.code,
        message: assertion.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }
  return context.json({
    expiresAt: new Date(assertion.value.mfaVerifiedUntil).toISOString(),
    status: "verified" as const,
  });
});

router.get("/api/platform/context", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const productBaseScope = isProductBaseHost(requestUrl.hostname, context.env.PRODUCT_BASE_DOMAIN);
  const organizationId = productBaseScope
    ? null
    : await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!productBaseScope && !organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "Platform administration requires a canonical product hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizePlatformAdministratorSession(
    context.env.CONTROL_DB,
    session?.session.id ?? null,
    session?.user.id ?? null,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }
  return context.json({
    mfaMethod: authorization.value.mfaMethod,
    mfaVerifiedUntil: new Date(authorization.value.mfaVerifiedUntil).toISOString(),
    requestId: context.get("requestId"),
    scope: organizationId
      ? ({ kind: "organization", organizationId } as const)
      : ({ kind: "product_base" } as const),
    userId: authorization.value.userId,
  });
});

router.get("/api/platform/fleet-schema-preparation", async (context) => {
  const config = validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
    return context.json(
      {
        code: "not_found",
        message: "Fleet schema preparation is available only on the product base hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizePlatformAdministratorSession(
    context.env.CONTROL_DB,
    session?.session.id ?? null,
    session?.user.id ?? null,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }
  const preparation = await context.env.CONTROL_DB.prepare(
    `SELECT id AS runId, target_version AS targetVersion, status,
      processed_count AS processedCount, started_at AS startedAt,
      updated_at AS updatedAt, completed_at AS completedAt
     FROM fleet_schema_preparations
     ORDER BY started_at DESC, id DESC LIMIT 1`,
  ).first<PlatformFleetSchemaPreparationRow>();
  return context.json({
    currentVersion: currentOrganizationSchemaVersion,
    preparation,
    requestId: context.get("requestId"),
  });
});

router.post("/api/platform/fleet-schema-preparation", async (context) => {
  const config = validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
    return context.json(
      {
        code: "not_found",
        message: "Fleet schema preparation is available only on the product base hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizePlatformAdministratorSession(
    context.env.CONTROL_DB,
    session?.session.id ?? null,
    session?.user.id ?? null,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }
  try {
    const started = await beginFleetSchemaPreparation(context.env, {
      actorUserId: authorization.value.userId,
      requestId: context.get("requestId"),
    });
    return context.json(
      {
        currentVersion: currentOrganizationSchemaVersion,
        preparation: {
          completedAt: null,
          processedCount: 0,
          runId: started.runId,
          startedAt: started.startedAt,
          status: "running" as const,
          targetVersion: started.targetVersion,
          updatedAt: started.startedAt,
          workflowId: started.workflowId,
        },
        requestId: context.get("requestId"),
      },
      202,
    );
  } catch (error: unknown) {
    const workflowDispatchFailed =
      error instanceof FleetSchemaPreparationError && error.phase === "workflow";
    return context.json(
      {
        code: workflowDispatchFailed ? "service_unavailable" : "conflict",
        message: workflowDispatchFailed
          ? "The schema-preparation run was recorded, but its Workflow could not be dispatched."
          : "Another fleet schema-preparation run is active.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      workflowDispatchFailed ? 503 : 409,
    );
  }
});

router.get("/api/platform/job-dead-letters", async (context) => {
  const config = validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
    return context.json(
      {
        code: "not_found",
        message: "Queue dead-letter visibility is available only on the product base hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }

  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizePlatformAdministratorSession(
    context.env.CONTROL_DB,
    session?.session.id ?? null,
    session?.user.id ?? null,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }

  const cursor = parsePlatformDeadLetterCursor(requestUrl.searchParams.get("cursor"));
  if (cursor === undefined) {
    return context.json(
      {
        code: "validation_failed",
        message: "The queue dead-letter cursor is invalid.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }

  const baseQuery = `SELECT id, queue_name AS queueName, message_id AS messageId,
      message_valid AS messageValid, observed_attempt AS observedAttempt,
      organization_id AS organizationId, job_id AS jobId, job_kind AS jobKind,
      idempotency_key AS idempotencyKey, first_seen_at AS firstSeenAt,
      last_seen_at AS lastSeenAt, observation_count AS observationCount
    FROM job_dead_letters`;
  const statement = cursor
    ? context.env.CONTROL_DB.prepare(
        `${baseQuery}
         WHERE last_seen_at < ? OR (last_seen_at = ? AND id < ?)
         ORDER BY last_seen_at DESC, id DESC
         LIMIT ?`,
      ).bind(cursor[0], cursor[0], cursor[1], PLATFORM_DEAD_LETTER_PAGE_SIZE + 1)
    : context.env.CONTROL_DB.prepare(
        `${baseQuery}
         ORDER BY last_seen_at DESC, id DESC
         LIMIT ?`,
      ).bind(PLATFORM_DEAD_LETTER_PAGE_SIZE + 1);
  const rows = await statement.all<PlatformDeadLetterRow>();
  const deadLetters = rows.results.slice(0, PLATFORM_DEAD_LETTER_PAGE_SIZE).map((row) => ({
    firstSeenAt: row.firstSeenAt,
    idempotencyKey: row.idempotencyKey,
    jobId: row.jobId,
    jobKind: row.jobKind,
    lastSeenAt: row.lastSeenAt,
    messageId: row.messageId,
    messageValid: row.messageValid === 1,
    observationCount: row.observationCount,
    observedAttempt: row.observedAttempt,
    organizationId: row.organizationId,
    queueName: row.queueName,
  }));
  const cursorRow =
    deadLetters.length === PLATFORM_DEAD_LETTER_PAGE_SIZE
      ? rows.results[PLATFORM_DEAD_LETTER_PAGE_SIZE - 1]
      : undefined;
  return context.json({
    deadLetters,
    nextCursor:
      rows.results.length > PLATFORM_DEAD_LETTER_PAGE_SIZE && cursorRow
        ? encodePlatformDeadLetterCursor(cursorRow)
        : null,
    requestId: context.get("requestId"),
  });
});

router.get("/api/platform/organizations", async (context) => {
  const config = validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
    return context.json(
      {
        code: "not_found",
        message:
          "The Platform Organization directory is available only on the product base hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }

  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizePlatformAdministratorSession(
    context.env.CONTROL_DB,
    session?.session.id ?? null,
    session?.user.id ?? null,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }

  const cursor = parsePlatformOrganizationCursor(requestUrl.searchParams.get("cursor"));
  if (cursor === undefined) {
    return context.json(
      {
        code: "validation_failed",
        message: "The Organization directory cursor is invalid.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }

  const baseQuery = `SELECT o.id AS organizationId, o.name, o.slug,
      o.lifecycle_state AS lifecycleState,
      o.operational_schema_version AS operationalSchemaVersion,
      o.provisioned_at AS provisionedAt, o.created_at AS createdAt,
      d.hostname AS canonicalHostname, d.status AS canonicalStatus
    FROM organizations o
    INNER JOIN organization_domains d
      ON d.organization_id = o.id AND d.kind = 'canonical'`;
  const statement = cursor
    ? context.env.CONTROL_DB.prepare(
        `${baseQuery}
         WHERE o.created_at < ? OR (o.created_at = ? AND o.id < ?)
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT ?`,
      ).bind(cursor[0], cursor[0], cursor[1], PLATFORM_ORGANIZATION_PAGE_SIZE + 1)
    : context.env.CONTROL_DB.prepare(
        `${baseQuery}
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT ?`,
      ).bind(PLATFORM_ORGANIZATION_PAGE_SIZE + 1);
  const rows = await statement.all<PlatformOrganizationRow>();
  const organizations = rows.results.slice(0, PLATFORM_ORGANIZATION_PAGE_SIZE).map((row) => ({
    canonicalHostname: row.canonicalHostname,
    canonicalStatus: row.canonicalStatus,
    lifecycleState: row.lifecycleState,
    name: row.name,
    operationalSchemaVersion: row.operationalSchemaVersion,
    organizationId: row.organizationId,
    provisionedAt: row.provisionedAt,
    slug: row.slug,
  }));
  const cursorRow =
    organizations.length === PLATFORM_ORGANIZATION_PAGE_SIZE
      ? rows.results[PLATFORM_ORGANIZATION_PAGE_SIZE - 1]
      : undefined;
  return context.json({
    nextCursor:
      rows.results.length > PLATFORM_ORGANIZATION_PAGE_SIZE && cursorRow
        ? encodePlatformOrganizationCursor(cursorRow)
        : null,
    organizations,
    requestId: context.get("requestId"),
  });
});

router.post("/api/platform/organizations", async (context) => {
  const config = validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  if (!isProductBaseHost(requestUrl.hostname, config.PRODUCT_BASE_DOMAIN)) {
    return context.json(
      {
        code: "not_found",
        message: "Organization provisioning is available only on the product base hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }

  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizePlatformAdministratorSession(
    context.env.CONTROL_DB,
    session?.session.id ?? null,
    session?.user.id ?? null,
  );
  if (!authorization.ok) {
    return context.json(
      {
        code: authorization.error.code,
        message: authorization.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      authorization.error.code === "unauthorized" ? 401 : 403,
    );
  }

  const parsedBody = organizationProvisionRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!parsedBody.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid Organization name and unique hostname slug are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }

  try {
    const started = await beginOrganizationProvisioning(context.env, {
      ...parsedBody.data,
      actorUserId: authorization.value.userId,
      requestId: context.get("requestId"),
    });
    const response: OrganizationProvisionResponse = {
      ...started,
      lifecycleState: "provisioning",
      requestId: context.get("requestId"),
    };
    return context.json(response, 202);
  } catch (error: unknown) {
    const workflowDispatchFailed =
      error instanceof OrganizationProvisioningError && error.phase === "workflow";
    return context.json(
      {
        code: workflowDispatchFailed ? "service_unavailable" : "conflict",
        message: workflowDispatchFailed
          ? "The Organization registry was created, but provisioning could not be dispatched."
          : "The Organization name or hostname slug is already in use.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      workflowDispatchFailed ? 503 : 409,
    );
  }
});

router.get("/api/platform/organization-context", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "Platform Organization access requires a registered canonical hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }

  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizePlatformAdministratorSession(
    context.env.CONTROL_DB,
    session?.session.id ?? null,
    session?.user.id ?? null,
  );
  if (!authorization.ok || !session) {
    const code = authorization.ok ? "unauthorized" : authorization.error.code;
    const message = authorization.ok ? "Sign in is required." : authorization.error.message;
    return context.json(
      { code, message, requestId: context.get("requestId") } satisfies ProblemDetails,
      code === "unauthorized" ? 401 : 403,
    );
  }

  const platformContext = await getPlatformOrganizationContext(
    context.env.CONTROL_DB,
    organizationId,
    session.session.id,
    authorization.value.userId,
  );
  const response: PlatformOrganizationContextResponse = {
    ...platformContext,
    requestId: context.get("requestId"),
  };
  return context.json(response);
});

router.post("/api/platform/elevations", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "Platform edit elevation requires a registered canonical hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }

  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizePlatformAdministratorSession(
    context.env.CONTROL_DB,
    session?.session.id ?? null,
    session?.user.id ?? null,
  );
  if (!authorization.ok || !session) {
    const code = authorization.ok ? "unauthorized" : authorization.error.code;
    const message = authorization.ok ? "Sign in is required." : authorization.error.message;
    return context.json(
      { code, message, requestId: context.get("requestId") } satisfies ProblemDetails,
      code === "unauthorized" ? 401 : 403,
    );
  }

  const parsedBody = platformElevationRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!parsedBody.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A concise reason is required before enabling Platform Administrator edits.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const platformContext = await createPlatformElevation(context.env.CONTROL_DB, {
    actorUserId: authorization.value.userId,
    organizationId,
    reason: parsedBody.data.reason,
    requestId: context.get("requestId"),
    sessionId: session.session.id,
  });
  const response: PlatformOrganizationContextResponse = {
    ...platformContext,
    requestId: context.get("requestId"),
  };
  return context.json(response, 201);
});

router.delete("/api/platform/elevations/:elevationId", async (context) => {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  const elevationId = z.uuid().safeParse(context.req.param("elevationId"));
  if (!organizationId || !elevationId.success) {
    return context.json(
      {
        code: "not_found",
        message: "The scoped Platform Administrator elevation was not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }

  const auth = createAuth({
    env: context.env,
    requestUrl,
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  const authorization = await authorizePlatformAdministratorSession(
    context.env.CONTROL_DB,
    session?.session.id ?? null,
    session?.user.id ?? null,
  );
  if (!authorization.ok || !session) {
    const code = authorization.ok ? "unauthorized" : authorization.error.code;
    const message = authorization.ok ? "Sign in is required." : authorization.error.message;
    return context.json(
      { code, message, requestId: context.get("requestId") } satisfies ProblemDetails,
      code === "unauthorized" ? 401 : 403,
    );
  }

  const revoked = await revokePlatformElevation(context.env.CONTROL_DB, {
    actorUserId: authorization.value.userId,
    elevationId: elevationId.data,
    organizationId,
    requestId: context.get("requestId"),
    sessionId: session.session.id,
  });
  if (!revoked.ok) {
    return context.json(
      {
        code: revoked.error.code,
        message: revoked.error.message,
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  return context.json({ elevationId: revoked.value.elevationId, status: "revoked" as const });
});

router.notFound((context) => {
  const problem: ProblemDetails = {
    code: "not_found",
    message: "The requested API route was not found.",
    requestId: context.get("requestId"),
  };
  return context.json(problem, 404);
});
