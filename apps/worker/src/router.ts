import {
  memberProfileUpdateRequestSchema,
  organizationMusicPieceRequestSchema,
  organizationResourceOrderRequestSchema,
  organizationResourceRequestSchema,
  communicationAudienceRequestSchema,
  communicationDraftRequestSchema,
  communicationSendRequestSchema,
  communicationTemplateRequestSchema,
  communicationUnsubscribeRequestSchema,
  organizationAttendanceBulkRequestSchema,
  accountPasswordRequestSchema,
  organizationInvitationRequestSchema,
  organizationEventRequestSchema,
  organizationCalendarSettingsRequestSchema,
  organizationRosterConfigurationRequestSchema,
  organizationSeatingChartRequestSchema,
  seatingConfigurationRequestSchema,
  organizationMfaPolicyRequestSchema,
  organizationMfaVerificationRequestSchema,
  organizationProfileRequestSchema,
  organizationRsvpRequestSchema,
  organizationVenueRequestSchema,
  publicQuickRsvpRequestSchema,
  generateRsvpTokensRequestSchema,
  publicPollSubmitRequestSchema,
  generatePollTokensRequestSchema,
  generatePlayerTokensRequestSchema,
  organizationPollRequestSchema,
  singerRsvpRequestSchema,
  singerLearningTrackPieceSchema,
  organizationProfileLinkRequestSchema,
  organizationProvisionRequestSchema,
  platformElevationRequestSchema,
  publicDomainRegistrationRequestSchema,
  publicWebsiteSettingsRequestSchema,
  ticketCheckoutRequestSchema,
  ticketBundleRequestSchema,
  ticketScanRequestSchema,
  publicAuditionInquiryRequestSchema,
  publicAuditionSubmitRequestSchema,
  generateAuditionTokensRequestSchema,
  organizationAuditionUpdateRequestSchema,
  donationCheckoutRequestSchema,
  donationRefundRequestSchema,
  duesCheckoutRequestSchema,
  setupProgressRequestSchema,
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
import {
  eventRsvpExportFilename,
  isValidTimeZone,
  MusicCsvError,
  parseRosterCsv,
  RosterCsvError,
  parseMusicCsv,
  renderEventRsvpCsv,
  renderMusicCsv,
  renderRosterCsv,
} from "@choir/domain";

import { createAuth, isCanonicalAuthHost, isProductBaseHost } from "./auth/config";
import { createCalendarFeedUrls, readCalendarFeed } from "./calendar/calendarFeed";
import {
  CalendarMutationError,
  createOrganizationEvent,
  createOrganizationVenue,
  deleteOrganizationVenue,
  archiveOrganizationEvent,
  listOrganizationEvents,
  readOrganizationDashboardSummary,
  listOrganizationEventAttendance,
  listOrganizationVenues,
  listMemberSchedule,
  readOrganizationCalendarSettings,
  readOrganizationEventRsvpExport,
  readOrganizationRosterConfiguration,
  setOrganizationEventRsvp,
  updateOrganizationCalendarSettings,
  updateOrganizationRosterConfiguration,
  updateOrganizationEvent,
  updateOrganizationEventAttendance,
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
import {
  createOrganizationMusicPiece,
  deleteOrganizationMusicPiece,
  importOrganizationMusicPieces,
  listOrganizationMusicPieces,
  MusicRepositoryError,
  updateOrganizationMusicPiece,
} from "./organization/organizationMusic";
import {
  createOrganizationResource,
  deleteOrganizationResource,
  listOrganizationResources,
  reorderOrganizationResources,
  ResourceRepositoryError,
  updateOrganizationResource,
} from "./organization/organizationResources";
import {
  CommunicationRepositoryError,
  listOrganizationCommunications,
  listCommunicationTemplates,
  previewCommunicationReach,
  readCommunicationDeliverySummary,
  retryCommunicationDeliveries,
  deleteCommunicationDraft,
  deleteCommunicationTemplate,
  saveCommunicationTemplate,
  saveCommunicationDraft,
  sendOrganizationCommunication,
  unsubscribeOrganizationProfile,
} from "./organization/organizationCommunications";
import {
  createOrganizationProfile,
  importOrganizationProfiles,
  listOrganizationDirectoryProfiles,
  listOrganizationProfileEmails,
  listOrganizationProfiles,
  OrganizationProfileMutationError,
  readOrganizationMemberProfile,
  updateOrganizationMemberProfile,
  updateOrganizationProfile,
  setOrganizationProfilePhoto,
} from "./organization/profiles";
import {
  createOrganizationSeatingChart,
  deleteOrganizationSeatingChart,
  listOrganizationSeatingCharts,
  readOrganizationSeatingConfiguration,
  readSingerSeating,
  SeatingRepositoryError,
  updateOrganizationSeatingChart,
  updateOrganizationSeatingConfiguration,
} from "./organization/organizationSeating";
import {
  readPublishedOrganization,
  readPublishedOrganizationMedia,
} from "./publication/publishOrganization";
import { verifySignedLinkScope } from "./security/signedLinks";
import {
  MAX_PRIVATE_FILE_BYTES,
  PrivateFileStorageError,
  privateFileContentTypeSchema,
  privateFileIdSchema,
  privateFileNameSchema,
  privateOrganizationFileKey,
  readPrivateOrganizationFile,
  reclaimPrivateOrganizationFile,
  uploadPrivateOrganizationFile,
} from "./storage/privateFiles";
import { authorizeOrganizationMember } from "./tenancy/authorizeOrganization";
import { linkOrganizationProfile } from "./tenancy/linkOrganizationProfile";
import { linkedOrganizationProfileId } from "./tenancy/linkedOrganizationProfile";
import {
  disablePublicDomain,
  listPublicDomains,
  registerPublicDomain,
} from "./tenancy/registerPublicDomain";
import { resolveOrganization } from "./tenancy/resolveOrganization";
import {
  PublicWebsiteError,
  publishOrganizationPublicWebsite,
  readOrganizationPublicWebsiteSettings,
  updateOrganizationPublicWebsiteSettings,
} from "./organization/organizationPublicWebsite";
import {
  createPublicTicketCheckout,
  deleteOrganizationTicketBundle,
  listOrganizationTicketBundles,
  listOrganizationTicketOrders,
  readOrganizationTicketWillCallCsv,
  readPublicTicketPurchase,
  resendOrganizationTicketConfirmation,
  refundFakeTicketPurchase,
  saveOrganizationTicketBundle,
  TicketingError,
  validateOrganizationTicketScan,
} from "./organization/organizationTicketing";
import {
  createDonationCheckoutSession,
  DonationError,
  listOrganizationDonations,
  listOrganizationPatrons,
  refundOrganizationDonation,
} from "./organization/organizationDonations";
import {
  claimSetup,
  completeSetup,
  getModuleState,
  getSetupStatus,
  saveSetupProgress,
  SetupError,
} from "./organization/organizationSetup";
import {
  createDuesCheckoutSession,
  listSeasons,
  listDues,
  refundDues,
  SeasonError,
} from "./organization/organizationSeasons";
import {
  generateRsvpTokens,
  resolveRsvpDetails,
  submitQuickRsvp,
} from "./organization/organizationRsvpLinks";
import {
  generatePollTokens,
  resolvePollDetails,
  submitPollResponse,
} from "./organization/organizationPollLinks";
import { generatePlayerTokens, resolvePlayerDetails } from "./organization/organizationPlayerLinks";
import {
  generateAuditionTokens,
  resolveAuditionDetails,
  submitAuditionUpdate,
} from "./organization/organizationAuditions";

interface WorkerHonoEnvironment {
  Bindings: Env;
  Variables: {
    requestId: string;
  };
}

export const router = new Hono<WorkerHonoEnvironment>();

function isErrorResponse(
  value: unknown,
): value is { readonly code: string; readonly status?: number } {
  return typeof value === "object" && value !== null && "code" in value;
}

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
  | {
      readonly ok: true;
      readonly organizationId: string;
      readonly role: "administrator" | "member" | "owner";
      readonly userId: string;
    }
  | {
      readonly code: string;
      readonly message: string;
      readonly ok: false;
      readonly status: 401 | 403 | 404;
    };

function calendarMutationMessage(code: string): string {
  if (code === "music_piece_not_found") {
    return "Every set-list music piece must exist in this Organization.";
  }
  if (code === "performer_profile_not_found") {
    return "Every credited Profile must exist in this Organization.";
  }
  if (code === "venue_not_found") return "The selected venue was not found in this Organization.";
  if (code === "parent_performance_not_found") {
    return "The selected parent performance was not found in this Organization.";
  }
  if (code === "event_not_found") return "The event was not found in this Organization.";
  return "The Organization rejected an invalid event reference.";
}

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
  return {
    ok: true,
    organizationId,
    role: authorization.value.role,
    userId: authorization.value.userId,
  };
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
  if (context.req.method === "OPTIONS") {
    context.res.headers.set(
      "access-control-allow-origin",
      context.env.PRODUCT_BASE_DOMAIN === "localhost"
        ? "*"
        : `https://${context.env.PRODUCT_BASE_DOMAIN}`,
    );
    context.res.headers.set("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
    context.res.headers.set("access-control-allow-headers", "Content-Type, Authorization");
    context.res.headers.set("access-control-allow-credentials", "true");
    context.res.headers.set("access-control-max-age", "86400");
    return context.body(null, 204);
  }
  await next();
});
router.use("*", async (context, next) => {
  await next();
  const responsePath = new URL(context.req.url).pathname;
  const publicProjectionResponse =
    responsePath === "/api/public/projection" &&
    (context.res.status === 200 || context.res.status === 304);
  const publicMediaResponse =
    responsePath.startsWith("/api/public/media/") &&
    (context.res.status === 200 || context.res.status === 304);
  context.header(
    "cache-control",
    publicProjectionResponse
      ? "public, max-age=60, stale-while-revalidate=300"
      : publicMediaResponse
        ? "public, max-age=31536000, immutable"
        : "no-store",
  );
  context.header(
    "referrer-policy",
    responsePath === "/api/calendar/feed" || responsePath === "/api/public/unsubscribe"
      ? "no-referrer"
      : "strict-origin-when-cross-origin",
  );
  context.header("x-content-type-options", "nosniff");
  context.header("x-frame-options", "DENY");
  context.res.headers.set(
    "access-control-allow-origin",
    context.env.PRODUCT_BASE_DOMAIN === "localhost"
      ? "*"
      : `https://${context.env.PRODUCT_BASE_DOMAIN}`,
  );
  context.res.headers.set("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
  context.res.headers.set("access-control-allow-headers", "Content-Type, Authorization");
  context.res.headers.set("access-control-allow-credentials", "true");
  context.res.headers.set("access-control-max-age", "86400");
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

// TODO: Add rate limiting for all /api/public/* routes before production launch
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

router.get("/api/public/media/:version/:fileId", async (context) => {
  validateStartupConfig(context.env);
  const version = z.coerce.number().int().positive().safeParse(context.req.param("version"));
  const fileId = z.uuid().safeParse(context.req.param("fileId"));
  const resolved = await resolveOrganization(new URL(context.req.url), context.env);
  if (!version.success || !fileId.success || !resolved.ok) {
    return context.json(
      {
        code: "not_found",
        message: "The published Organization image was not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const object = await readPublishedOrganizationMedia(
    context.env,
    resolved.value.organizationId,
    version.data,
    fileId.data,
  );
  if (!object) {
    return context.json(
      {
        code: "not_found",
        message: "The published Organization image was not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  context.header("etag", object.httpEtag);
  context.header("vary", "Host");
  if (context.req.header("if-none-match") === object.httpEtag) return context.body(null, 304);
  context.header("content-type", object.httpMetadata?.contentType ?? "application/octet-stream");
  return context.body(object.body);
});

router.post("/api/checkout/create-donation-session", async (context) => {
  validateStartupConfig(context.env);
  const resolved = await resolveOrganization(new URL(context.req.url), context.env);
  const checkout = donationCheckoutRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!resolved.ok) {
    return context.json(
      {
        code: "not_found",
        message: "Donations are not available for this hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  if (!checkout.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "Valid donation details are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    return context.json(
      await createDonationCheckoutSession(
        context.env,
        resolved.value.organizationId,
        new URL(context.req.url).origin,
        checkout.data,
      ),
      201,
    );
  } catch (error: unknown) {
    return context.json(
      {
        code: error instanceof DonationError ? error.code : "donation_checkout_unavailable",
        message:
          error instanceof DonationError
            ? error.message
            : "Online donation checkout is not available right now.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      error instanceof DonationError && (error.status === 409 || error.status === 501)
        ? error.status
        : 503,
    );
  }
});

router.post("/api/checkout/create-dues-session", async (context) => {
  validateStartupConfig(context.env);
  const resolved = await resolveOrganization(new URL(context.req.url), context.env);
  const checkout = duesCheckoutRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!resolved.ok) {
    return context.json(
      {
        code: "not_found",
        message: "Dues checkout is not available for this hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  if (!checkout.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "Valid dues checkout details are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    return context.json(
      await createDuesCheckoutSession(
        context.env,
        resolved.value.organizationId,
        new URL(context.req.url).origin,
        checkout.data,
      ),
      201,
    );
  } catch (error: unknown) {
    return context.json(
      {
        code: error instanceof SeasonError ? error.code : "dues_checkout_unavailable",
        message:
          error instanceof SeasonError
            ? error.message
            : "Dues checkout is not available right now.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      error instanceof SeasonError && error.status === 409 ? 409 : 503,
    );
  }
});

router.post("/api/public/tickets/checkout", async (context) => {
  validateStartupConfig(context.env);
  const resolved = await resolveOrganization(new URL(context.req.url), context.env);
  const checkout = ticketCheckoutRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!resolved.ok) {
    return context.json(
      {
        code: "not_found",
        message: "Ticket sales are not available for this hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  if (!checkout.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "Valid ticket order details are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    return context.json(
      await createPublicTicketCheckout(
        context.env,
        resolved.value.organizationId,
        new URL(context.req.url).origin,
        checkout.data,
      ),
      201,
    );
  } catch (error: unknown) {
    return context.json(
      {
        code: error instanceof TicketingError ? error.code : "ticket_checkout_unavailable",
        message:
          error instanceof TicketingError
            ? error.message
            : "Online ticket checkout is not available right now.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      error instanceof TicketingError && error.status === 409 ? 409 : 503,
    );
  }
});

router.get("/api/public/tickets/order", async (context) => {
  validateStartupConfig(context.env);
  const resolved = await resolveOrganization(new URL(context.req.url), context.env);
  const token = context.req.query("token") ?? "";
  if (!resolved.ok) {
    return context.json(
      {
        code: "not_found",
        message: "Ticket order not found.",
        requestId: context.get("requestId"),
      },
      404,
    );
  }
  const envelope = await verifySignedLinkScope(context.env.SIGNED_LINK_SECRET, token, {
    expectedOrganizationId: resolved.value.organizationId,
    expectedPurpose: "ticket_receipt",
  });
  if (!envelope?.resourceId) {
    return context.json(
      {
        code: "not_found",
        message: "Ticket order not found.",
        requestId: context.get("requestId"),
      },
      404,
    );
  }
  try {
    const purchase = await readPublicTicketPurchase(
      context.env,
      resolved.value.organizationId,
      envelope.resourceId,
    );
    return context.json({ ...purchase, requestId: context.get("requestId") });
  } catch {
    return context.json(
      {
        code: "not_found",
        message: "Ticket order not found.",
        requestId: context.get("requestId"),
      },
      404,
    );
  }
});

router.post("/api/public/rsvp-details", async (context) => {
  validateStartupConfig(context.env);
  const resolved = await resolveOrganization(new URL(context.req.url), context.env);
  if (!resolved.ok) {
    return context.json(
      {
        code: "not_found",
        message: "RSVP is not available for this hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const body = z
    .object({ token: z.string().min(1).max(4_096) })
    .safeParse(await context.req.json<unknown>().catch(() => null));
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid RSVP link is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const details = await resolveRsvpDetails(
    context.env,
    resolved.value.organizationId,
    body.data.token,
  );
  if (isErrorResponse(details)) {
    return context.json(
      {
        code: details.code,
        message:
          details.code === "invalid_link"
            ? "This RSVP link is invalid or expired."
            : "RSVP details not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  return context.json({ ...details, requestId: context.get("requestId") });
});

router.post("/api/public/quick-rsvp", async (context) => {
  validateStartupConfig(context.env);
  const resolved = await resolveOrganization(new URL(context.req.url), context.env);
  if (!resolved.ok) {
    return context.json(
      {
        code: "not_found",
        message: "RSVP is not available for this hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const body = publicQuickRsvpRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid RSVP and link are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const result = await submitQuickRsvp(
    context.env,
    resolved.value.organizationId,
    body.data.token,
    body.data.rsvp,
    body.data.rsvpNote,
  );
  if ("code" in result) {
    const status = result.code === "invalid_link" ? 404 : result.status;
    return context.json(
      {
        code: result.code,
        message:
          result.code === "invalid_link"
            ? "This RSVP link is invalid or expired."
            : "RSVP could not be submitted.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      status as Parameters<typeof context.json>[1],
    );
  }
  return context.json({ rsvp: body.data.rsvp, requestId: context.get("requestId") });
});

router.post("/api/public/poll-details", async (context) => {
  validateStartupConfig(context.env);
  const resolved = await resolveOrganization(new URL(context.req.url), context.env);
  if (!resolved.ok) {
    return context.json(
      {
        code: "not_found",
        message: "Poll is not available for this hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const body = z
    .object({ token: z.string().min(1).max(4_096) })
    .safeParse(await context.req.json<unknown>().catch(() => null));
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid poll link is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const details = await resolvePollDetails(
    context.env,
    resolved.value.organizationId,
    body.data.token,
  );
  if ("code" in details) {
    return context.json(
      {
        code: details.code,
        message:
          details.code === "invalid_link"
            ? "This poll link is invalid or expired."
            : "Poll details not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  return context.json({ ...details, requestId: context.get("requestId") });
});

router.post("/api/public/poll-vote", async (context) => {
  validateStartupConfig(context.env);
  const resolved = await resolveOrganization(new URL(context.req.url), context.env);
  if (!resolved.ok) {
    return context.json(
      {
        code: "not_found",
        message: "Poll is not available for this hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const body = publicPollSubmitRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid poll response and link are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const result = await submitPollResponse(
    context.env,
    resolved.value.organizationId,
    body.data.token,
    body.data.optionIds,
  );
  if ("code" in result) {
    return context.json(
      {
        code: result.code,
        message: "Poll response could not be submitted.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      result.code === "invalid_link" ? 404 : 503,
    );
  }
  return context.json({ submitted: true, requestId: context.get("requestId") });
});

router.post("/api/public/player-details", async (context) => {
  validateStartupConfig(context.env);
  const resolved = await resolveOrganization(new URL(context.req.url), context.env);
  if (!resolved.ok) {
    return context.json(
      {
        code: "not_found",
        message: "Player is not available for this hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const body = z
    .object({ token: z.string().min(1).max(4_096) })
    .safeParse(await context.req.json<unknown>().catch(() => null));
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid player link is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const details = await resolvePlayerDetails(
    context.env,
    resolved.value.organizationId,
    body.data.token,
  );
  if (isErrorResponse(details)) {
    const status: number = typeof details.status === "number" ? details.status : 404;
    return context.json(
      {
        code: details.code,
        message:
          details.code === "invalid_link"
            ? "This player link is invalid or expired."
            : "Player details not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      status as Parameters<typeof context.json>[1],
    );
  }
  return context.json({ ...details, requestId: context.get("requestId") });
});

router.get("/api/public/player/media/:fileId", async (context) => {
  const requestIdValue = context.get("requestId");
  const token = context.req.query("token");
  if (!token) {
    return context.json(
      {
        code: "missing_token",
        message: "A player link is required.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      400,
    );
  }
  const resolved = await resolveOrganization(new URL(context.req.url), context.env);
  if (!resolved.ok) {
    return context.json(
      {
        code: "not_found",
        message: "Player is not available for this hostname.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      404,
    );
  }
  const envelope = await verifySignedLinkScope(context.env.SIGNED_LINK_SECRET, token, {
    expectedOrganizationId: resolved.value.organizationId,
    expectedPurpose: "player",
  });
  if (!envelope?.resourceId) {
    return context.json(
      {
        code: "invalid_link",
        message: "This player link is invalid or expired.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      404,
    );
  }
  const fileId = context.req.param("fileId");
  if (!fileId) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid file is required.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const file = await readPrivateOrganizationFile(
      context.env,
      resolved.value.organizationId,
      fileId,
    );
    if (!file) {
      return context.json(
        {
          code: "file_not_found",
          message: "The requested file was not found.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        404,
      );
    }
    return new Response(file.object.body, {
      headers: {
        "cache-control": "private, max-age=3600",
        "content-type": file.metadata.contentType,
        "content-length": String(file.metadata.sizeBytes),
      },
    });
  } catch {
    return context.json(
      {
        code: "file_not_found",
        message: "The requested file was not found.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      404,
    );
  }
});

router.post("/api/public/audition-inquiry", async (context) => {
  const requestIdValue = context.get("requestId");
  const resolved = await resolveOrganization(new URL(context.req.url), context.env);
  if (!resolved.ok) {
    return context.json(
      {
        code: "not_found",
        message: "Auditions are not available for this hostname.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      404,
    );
  }
  const body = publicAuditionInquiryRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "Valid name and email are required.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const stub = context.env.ORGANIZATION_STORE.get(
      context.env.ORGANIZATION_STORE.idFromName(resolved.value.organizationId),
    );
    const url = new URL("https://organization.internal/internal/audition/create");
    const response = await stub.fetch(url, {
      body: JSON.stringify({
        availabilityNotes: body.data.availabilityNotes ?? "",
        email: body.data.email,
        experience: body.data.experience ?? "",
        name: body.data.name,
        phone: body.data.phone ?? "",
        voicePart: body.data.voicePart ?? "",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      return context.json(
        {
          code: "service_unavailable",
          message: "Your inquiry could not be submitted. Please try again later.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        503,
      );
    }
    const created: unknown = await response.json();
    const createdId =
      typeof created === "object" && created !== null && "id" in created ? String(created.id) : "";
    return context.json(
      { id: createdId, message: "Your audition inquiry has been received." },
      201,
    );
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Your inquiry could not be submitted. Please try again later.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.post("/api/public/audition-details", async (context) => {
  const requestIdValue = context.get("requestId");
  const resolved = await resolveOrganization(new URL(context.req.url), context.env);
  if (!resolved.ok) {
    return context.json(
      {
        code: "not_found",
        message: "Auditions are not available for this hostname.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      404,
    );
  }
  const body = z
    .object({ token: z.string().min(1).max(4_096) })
    .safeParse(await context.req.json<unknown>().catch(() => null));
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid audition link is required.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      400,
    );
  }
  const details = await resolveAuditionDetails(
    context.env,
    resolved.value.organizationId,
    body.data.token,
  );
  if (isErrorResponse(details)) {
    return context.json(
      {
        code: "not_found",
        message: "This audition link is invalid or expired.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      404,
    );
  }
  return context.json(details);
});

router.post("/api/public/audition-submit", async (context) => {
  const requestIdValue = context.get("requestId");
  const resolved = await resolveOrganization(new URL(context.req.url), context.env);
  if (!resolved.ok) {
    return context.json(
      {
        code: "not_found",
        message: "Auditions are not available for this hostname.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      404,
    );
  }
  const body = publicAuditionSubmitRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid audition link is required.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      400,
    );
  }
  const result = await submitAuditionUpdate(
    context.env,
    resolved.value.organizationId,
    body.data.token,
    body.data.availabilityNotes,
    body.data.voicePart,
  );
  if (isErrorResponse(result)) {
    return context.json(
      {
        code: "not_found",
        message: "This audition link is invalid or expired.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      404,
    );
  }
  return context.json(result);
});

router.post("/api/public/unsubscribe", async (context) => {
  const requestIdValue = context.get("requestId");
  const body = communicationUnsubscribeRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success)
    return context.json(
      {
        code: "invalid_unsubscribe_link",
        message: "This unsubscribe link is invalid or expired.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      400,
    );
  const resolved = await resolveOrganization(new URL(context.req.url), context.env);
  if (!resolved.ok)
    return context.json(
      {
        code: "not_found",
        message: "This unsubscribe link is invalid or expired.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      404,
    );
  const envelope = await verifySignedLinkScope(context.env.SIGNED_LINK_SECRET, body.data.token, {
    expectedOrganizationId: resolved.value.organizationId,
    expectedPurpose: "unsubscribe",
  });
  const profileId = z.uuid().safeParse(envelope?.subjectId);
  if (envelope?.revocation !== "email-v1" || !profileId.success)
    return context.json(
      {
        code: "invalid_unsubscribe_link",
        message: "This unsubscribe link is invalid or expired.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      400,
    );
  try {
    await unsubscribeOrganizationProfile(
      context.env,
      resolved.value.organizationId,
      profileId.data,
      requestIdValue,
    );
    return context.json({ requestId: requestIdValue, success: true as const });
  } catch {
    return context.json(
      {
        code: "not_found",
        message: "This unsubscribe link is invalid or expired.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      404,
    );
  }
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

type PrivateFileReadResult = NonNullable<Awaited<ReturnType<typeof readPrivateOrganizationFile>>>;

function privateFileDownloadResponse(file: PrivateFileReadResult): Response {
  const disposition = file.metadata.contentType.startsWith("audio/") ? "inline" : "attachment";
  const headers = new Headers({
    "accept-ranges": "bytes",
    "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.metadata.fileName)}`,
    "content-length": String(file.range?.length ?? file.metadata.sizeBytes),
    "content-type": file.metadata.contentType,
    etag: file.object.httpEtag,
  });
  if (file.range) {
    const end = file.range.offset + file.range.length - 1;
    headers.set(
      "content-range",
      `bytes ${String(file.range.offset)}-${String(end)}/${String(file.metadata.sizeBytes)}`,
    );
  }
  return new Response(file.object.body, { headers, status: file.range ? 206 : 200 });
}

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
    const file = await readPrivateOrganizationFile(
      context.env,
      organizationId,
      fileId.data,
      context.req.header("range") ?? null,
    );
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
    return privateFileDownloadResponse(file);
  } catch (error: unknown) {
    if (error instanceof PrivateFileStorageError && error.kind === "range_not_satisfiable") {
      context.header("content-range", `bytes */${String(error.sizeBytes ?? 0)}`);
      return context.body(null, 416);
    }
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

router.delete("/api/organization/files/:fileId", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  const fileId = privateFileIdSchema.safeParse(context.req.param("fileId"));
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  if (!fileId.success) {
    return context.json(
      {
        code: "not_found",
        message: "The private file was not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  try {
    const reclaimed = await reclaimPrivateOrganizationFile(context.env, {
      actorUserId: authorization.userId,
      fileId: fileId.data,
      organizationId: authorization.organizationId,
      requestId: context.get("requestId"),
      storageKey: privateOrganizationFileKey(authorization.organizationId, fileId.data),
    });
    return reclaimed
      ? context.json({
          fileId: fileId.data,
          requestId: context.get("requestId"),
          status: "deleted",
        })
      : context.json(
          {
            code: "conflict",
            message: "The private file is still in use or is unavailable.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          409,
        );
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The private file could not be reclaimed.",
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
  if (authorization.value.role === "member") {
    return context.json(
      {
        code: "forbidden",
        message: "Only Organization Owners and Administrators may view the full Profile roster.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
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

router.get("/api/organization/profiles/export.csv", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    const [profiles, emails] = await Promise.all([
      listOrganizationProfiles(context.env, authorization.organizationId),
      listOrganizationProfileEmails(context.env.CONTROL_DB, authorization.organizationId),
    ]);
    const csv = renderRosterCsv(
      profiles.map((profile) => ({
        displayName: profile.displayName,
        email: emails.get(profile.id) ?? "",
        globalStatus: profile.globalStatus,
        isSectionLeader: profile.isSectionLeader,
        phone: profile.phone,
        voicePart: profile.voicePart,
      })),
    );
    return context.body(csv, 200, {
      "cache-control": "private, no-store",
      "content-disposition": 'attachment; filename="choir_roster_export.csv"',
      "content-type": "text/csv; charset=utf-8",
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Organization roster export could not be generated.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.post("/api/organization/profiles/import", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const declaredLength = Number(context.req.header("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 2_000_000) {
    return context.json(
      {
        code: "validation_failed",
        message: "Roster CSV files may not exceed 2 MB.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      413,
    );
  }
  try {
    const csv = await context.req.text();
    if (new TextEncoder().encode(csv).byteLength > 2_000_000) {
      return context.json(
        {
          code: "validation_failed",
          message: "Roster CSV files may not exceed 2 MB.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        413,
      );
    }
    const parsed = parseRosterCsv(csv);
    if (parsed.length === 0) throw new RosterCsvError("The CSV contains no Profiles.");
    const imported = await importOrganizationProfiles(context.env, {
      actorUserId: authorization.userId,
      organizationId: authorization.organizationId,
      profiles: parsed.map((profile) => organizationProfileRequestSchema.parse(profile)),
      requestId: context.get("requestId"),
    });
    return context.json(
      {
        imported,
        invitationCandidates: parsed.filter(({ email }) => email !== "").length,
        requestId: context.get("requestId"),
      },
      201,
    );
  } catch (error: unknown) {
    if (error instanceof RosterCsvError) {
      const row = error.row === null ? "" : ` (row ${String(error.row)})`;
      return context.json(
        {
          code: "validation_failed",
          message: `${error.message}${row}`,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    if (error instanceof OrganizationProfileMutationError) {
      return context.json(
        { code: error.code, message: error.message, requestId: context.get("requestId") },
        400,
      );
    }
    return context.json(
      {
        code: "service_unavailable",
        message: "The roster CSV could not be imported.",
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
      organizationId,
      profile: parsedBody.data,
      requestId: context.get("requestId"),
    });
    return context.json({ ...profile, requestId: context.get("requestId") }, 201);
  } catch (error: unknown) {
    if (error instanceof OrganizationProfileMutationError) {
      return context.json(
        { code: error.code, message: error.message, requestId: context.get("requestId") },
        400,
      );
    }
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

router.put("/api/organization/profiles/:profileId", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const profileId = z.uuid().safeParse(context.req.param("profileId"));
  const profile = organizationProfileRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!profileId.success || !profile.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid Profile and Profile details are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const updated = await updateOrganizationProfile(context.env, {
      actorUserId: authorization.userId,
      organizationId: authorization.organizationId,
      profile: profile.data,
      profileId: profileId.data,
      requestId: context.get("requestId"),
    });
    return context.json({ ...updated, requestId: context.get("requestId") });
  } catch (error: unknown) {
    if (error instanceof OrganizationProfileMutationError) {
      return context.json(
        { code: error.code, message: error.message, requestId: context.get("requestId") },
        400,
      );
    }
    return context.json(
      {
        code: "service_unavailable",
        message: "The Organization Profile could not be updated.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.get("/api/singer/profile", async (context) => {
  const authorization = await authorizeCalendarRoute(context, false);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const profileId = await linkedOrganizationProfileId(
    context.env.CONTROL_DB,
    authorization.organizationId,
    authorization.userId,
  );
  if (!profileId) {
    return context.json(
      {
        code: "not_found",
        message: "A linked Organization Profile is required for self-service.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  try {
    const [profile, emails] = await Promise.all([
      readOrganizationMemberProfile(context.env, authorization.organizationId, profileId),
      listOrganizationProfileEmails(context.env.CONTROL_DB, authorization.organizationId),
    ]);
    const email = emails.get(profileId);
    if (!email) throw new Error("The linked Profile email is missing.");
    return context.json({
      displayName: profile.displayName,
      email,
      globalStatus: profile.globalStatus,
      id: profile.id,
      photoFileId: profile.photoFileId,
      phone: profile.phone,
      requestId: context.get("requestId"),
      showInDirectory: profile.showInDirectory,
      voicePart: profile.voicePart,
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Your Organization Profile is temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.put("/api/singer/profile", async (context) => {
  const authorization = await authorizeCalendarRoute(context, false);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const body = memberProfileUpdateRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid display name, phone, and directory preference are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const profileId = await linkedOrganizationProfileId(
    context.env.CONTROL_DB,
    authorization.organizationId,
    authorization.userId,
  );
  if (!profileId) {
    return context.json(
      {
        code: "not_found",
        message: "A linked Organization Profile is required for self-service.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  try {
    const [profile, emails] = await Promise.all([
      updateOrganizationMemberProfile(context.env, {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        profile: body.data,
        profileId,
        requestId: context.get("requestId"),
      }),
      listOrganizationProfileEmails(context.env.CONTROL_DB, authorization.organizationId),
    ]);
    const email = emails.get(profileId);
    if (!email) throw new Error("The linked Profile email is missing.");
    return context.json({
      displayName: profile.displayName,
      email,
      globalStatus: profile.globalStatus,
      id: profile.id,
      photoFileId: profile.photoFileId,
      phone: profile.phone,
      requestId: context.get("requestId"),
      showInDirectory: profile.showInDirectory,
      voicePart: profile.voicePart,
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Your Organization Profile could not be updated.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

async function profilePhotoTargetAllowed(
  context: Context<WorkerHonoEnvironment>,
  authorization: Extract<CalendarAuthorization, { readonly ok: true }>,
  profileId: string,
): Promise<boolean> {
  if (authorization.role !== "member") return true;
  return (
    (await linkedOrganizationProfileId(
      context.env.CONTROL_DB,
      authorization.organizationId,
      authorization.userId,
    )) === profileId
  );
}

async function updateProfilePhotoRoute(
  context: Context<WorkerHonoEnvironment>,
  fileId: string | null,
): Promise<Response> {
  const authorization = await authorizeCalendarRoute(context, false);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const profileId = z.uuid().safeParse(context.req.param("profileId"));
  const parsedFileId = fileId === null ? null : privateFileIdSchema.safeParse(fileId);
  if (!profileId.success || (parsedFileId !== null && !parsedFileId.success)) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid Profile and private image file are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  if (!(await profilePhotoTargetAllowed(context, authorization, profileId.data))) {
    return context.json(
      {
        code: "forbidden",
        message: "Members may update only their own linked Organization Profile photo.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }
  try {
    const result = await setOrganizationProfilePhoto(context.env, {
      actorUserId: authorization.userId,
      fileId: parsedFileId?.data ?? null,
      organizationId: authorization.organizationId,
      profileId: profileId.data,
      requestId: context.get("requestId"),
    });
    if (result.previousFileId && result.previousFileId !== result.profile.photoFileId) {
      await reclaimPrivateOrganizationFile(context.env, {
        actorUserId: authorization.userId,
        fileId: result.previousFileId,
        organizationId: authorization.organizationId,
        requestId: crypto.randomUUID(),
        storageKey: privateOrganizationFileKey(authorization.organizationId, result.previousFileId),
      });
    }
    return context.json({
      photoFileId: result.profile.photoFileId,
      profileId: result.profile.id,
      requestId: context.get("requestId"),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Profile photo could not be updated safely.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
}

router.put("/api/organization/profiles/:profileId/photo/:fileId", (context) =>
  updateProfilePhotoRoute(context, context.req.param("fileId")),
);

router.delete("/api/organization/profiles/:profileId/photo", (context) =>
  updateProfilePhotoRoute(context, null),
);

router.get("/api/singer/directory", async (context) => {
  const authorization = await authorizeCalendarRoute(context, false);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    return context.json({
      profiles: await listOrganizationDirectoryProfiles(
        context.env,
        context.env.CONTROL_DB,
        authorization.organizationId,
      ),
      requestId: context.get("requestId"),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Organization directory is temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

function resourceProblem(error: unknown, requestIdValue: string, message: string) {
  const status = error instanceof ResourceRepositoryError ? error.status : 503;
  return {
    problem: {
      code: error instanceof ResourceRepositoryError ? error.code : "service_unavailable",
      message,
      requestId: requestIdValue,
    } satisfies ProblemDetails,
    status,
  };
}

function publicWebsiteProblem(error: unknown, requestIdValue: string, message: string) {
  return {
    problem: {
      code: error instanceof PublicWebsiteError ? "public_website_error" : "service_unavailable",
      message: error instanceof PublicWebsiteError ? error.message : message,
      requestId: requestIdValue,
    } satisfies ProblemDetails,
    status: error instanceof PublicWebsiteError ? error.status : 503,
  };
}

router.get("/api/organization/website", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  try {
    const settings = await readOrganizationPublicWebsiteSettings(
      context.env,
      authorization.organizationId,
    );
    return context.json({ ...settings, requestId: context.get("requestId") });
  } catch (error: unknown) {
    const result = publicWebsiteProblem(
      error,
      context.get("requestId"),
      "The public website settings are temporarily unavailable.",
    );
    return context.json(result.problem, result.status);
  }
});

router.put("/api/organization/website", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  const body = publicWebsiteSettingsRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success)
    return context.json(
      {
        code: "validation_failed",
        message: "Valid public website settings are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  try {
    const settings = await updateOrganizationPublicWebsiteSettings(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      body.data,
    );
    return context.json({ ...settings, requestId: context.get("requestId") });
  } catch (error: unknown) {
    const result = publicWebsiteProblem(
      error,
      context.get("requestId"),
      "The public website settings could not be saved.",
    );
    return context.json(result.problem, result.status);
  }
});

router.post("/api/organization/website/publish", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  try {
    const publication = await publishOrganizationPublicWebsite(context.env, {
      actorUserId: authorization.userId,
      organizationId: authorization.organizationId,
      requestId: context.get("requestId"),
    });
    return context.json({ ...publication, requestId: context.get("requestId") });
  } catch (error: unknown) {
    const result = publicWebsiteProblem(
      error,
      context.get("requestId"),
      "The public website could not be published.",
    );
    return context.json(result.problem, result.status);
  }
});

router.get("/api/organization/tickets/orders", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    const orders = await listOrganizationTicketOrders(context.env, authorization.organizationId);
    return context.json({ orders, requestId: context.get("requestId") });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Ticket orders are temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.get("/api/organization/tickets/bundles", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    const bundles = await listOrganizationTicketBundles(context.env, authorization.organizationId);
    return context.json({ bundles, requestId: context.get("requestId") });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Ticket bundles are temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

async function saveTicketBundleRoute(context: Context<WorkerHonoEnvironment>, bundleId: string) {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const bundle = ticketBundleRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!bundle.success || !z.uuid().safeParse(bundleId).success) {
    return context.json(
      {
        code: "validation_failed",
        message: "Valid ticket bundle details are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const saved = await saveOrganizationTicketBundle(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      bundleId,
      bundle.data,
    );
    return context.json({ ...saved, requestId: context.get("requestId") });
  } catch (error: unknown) {
    return context.json(
      {
        code: error instanceof TicketingError ? error.code : "ticket_bundle_unavailable",
        message:
          error instanceof TicketingError ? error.message : "The ticket bundle could not be saved.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      error instanceof TicketingError && error.status === 409 ? 409 : 503,
    );
  }
}

router.post("/api/organization/tickets/bundles", (context) =>
  saveTicketBundleRoute(context, crypto.randomUUID()),
);

router.put("/api/organization/tickets/bundles/:bundleId", (context) =>
  saveTicketBundleRoute(context, context.req.param("bundleId")),
);

router.delete("/api/organization/tickets/bundles/:bundleId", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const bundleId = z.uuid().safeParse(context.req.param("bundleId"));
  if (!bundleId.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid ticket bundle is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    await deleteOrganizationTicketBundle(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      bundleId.data,
    );
    return context.json({ deleted: true, requestId: context.get("requestId") });
  } catch (error: unknown) {
    return context.json(
      {
        code: error instanceof TicketingError ? error.code : "ticket_bundle_unavailable",
        message:
          error instanceof TicketingError
            ? error.message
            : "The ticket bundle could not be deleted.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      error instanceof TicketingError && error.status === 404
        ? 404
        : error instanceof TicketingError && error.status === 409
          ? 409
          : 503,
    );
  }
});

router.get("/api/organization/tickets/will-call", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const eventId = z.uuid().safeParse(context.req.query("eventId"));
  if (!eventId.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid ticketed event is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const csv = await readOrganizationTicketWillCallCsv(
      context.env,
      authorization.organizationId,
      eventId.data,
    );
    context.header("content-disposition", `attachment; filename="${csv.filename}"`);
    context.header("content-type", "text/csv; charset=utf-8");
    return context.body(csv.content);
  } catch (error: unknown) {
    return context.json(
      {
        code: error instanceof TicketingError ? error.code : "ticket_export_unavailable",
        message:
          error instanceof TicketingError
            ? error.message
            : "The will-call list is temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      error instanceof TicketingError && error.status === 404 ? 404 : 503,
    );
  }
});

router.post("/api/organization/tickets/scan", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const scan = ticketScanRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!scan.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid event and ticket credential are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const result = await validateOrganizationTicketScan(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      scan.data.eventId,
      scan.data.token,
    );
    return context.json({ ...result, requestId: context.get("requestId") });
  } catch (error: unknown) {
    return context.json(
      {
        code: error instanceof TicketingError ? error.code : "ticket_scan_unavailable",
        message:
          error instanceof TicketingError
            ? error.message
            : "Ticket validation is temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      error instanceof TicketingError && error.status === 404 ? 404 : 503,
    );
  }
});

router.get("/api/organization/donations", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    const donations = await listOrganizationDonations(context.env, authorization.organizationId);
    return context.json({ donations, requestId: context.get("requestId") });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Donations are temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.get("/api/organization/patrons", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    const patrons = await listOrganizationPatrons(context.env, authorization.organizationId);
    return context.json({ patrons, requestId: context.get("requestId") });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Patrons are temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.get("/api/organization/seasons", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    const seasons = await listSeasons(context.env, authorization.organizationId);
    return context.json({ seasons, requestId: context.get("requestId") });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Seasons are temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.get("/api/organization/dues", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    const dues = await listDues(context.env, authorization.organizationId);
    return context.json({ dues, requestId: context.get("requestId") });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Dues are temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.post("/api/admin/refund-dues", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const body = z
    .object({ duesId: z.uuid() })
    .safeParse(await context.req.json<unknown>().catch(() => null));
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid dues record is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const duesRecord = await refundDues(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      body.data.duesId,
    );
    return context.json({ ...duesRecord, requestId: context.get("requestId") });
  } catch (error: unknown) {
    return context.json(
      {
        code: error instanceof SeasonError ? error.code : "dues_refund_unavailable",
        message: error instanceof SeasonError ? error.message : "The dues could not be refunded.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      error instanceof SeasonError && error.status === 404
        ? 404
        : error instanceof SeasonError && error.status === 409
          ? 409
          : 503,
    );
  }
});

router.post("/api/admin/refund-donation", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const body = donationRefundRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid donation is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const donation = await refundOrganizationDonation(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      body.data.donationId,
    );
    return context.json({ ...donation, requestId: context.get("requestId") });
  } catch (error: unknown) {
    return context.json(
      {
        code: error instanceof DonationError ? error.code : "donation_refund_unavailable",
        message:
          error instanceof DonationError ? error.message : "The donation could not be refunded.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      error instanceof DonationError && error.status === 404
        ? 404
        : error instanceof DonationError && error.status === 409
          ? 409
          : 503,
    );
  }
});

router.post("/api/organization/tickets/:purchaseId/refund", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const purchaseId = z.uuid().safeParse(context.req.param("purchaseId"));
  if (!purchaseId.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid ticket order is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const order = await refundFakeTicketPurchase(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      purchaseId.data,
    );
    return context.json({ ...order, requestId: context.get("requestId") });
  } catch (error: unknown) {
    return context.json(
      {
        code: error instanceof TicketingError ? error.code : "ticket_refund_unavailable",
        message:
          error instanceof TicketingError
            ? error.message
            : "The ticket order could not be refunded.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      error instanceof TicketingError && error.status === 404
        ? 404
        : error instanceof TicketingError && error.status === 409
          ? 409
          : 503,
    );
  }
});

router.post("/api/organization/tickets/:purchaseId/confirmation", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const purchaseId = z.uuid().safeParse(context.req.param("purchaseId"));
  if (!purchaseId.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid ticket order is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    await resendOrganizationTicketConfirmation(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      purchaseId.data,
    );
    return context.json({ queued: true, requestId: context.get("requestId") });
  } catch (error: unknown) {
    return context.json(
      {
        code: error instanceof TicketingError ? error.code : "ticket_confirmation_unavailable",
        message:
          error instanceof TicketingError
            ? error.message
            : "The ticket confirmation could not be queued.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      error instanceof TicketingError && error.status === 404
        ? 404
        : error instanceof TicketingError && error.status === 409
          ? 409
          : 503,
    );
  }
});

router.get("/api/organization/resources", async (context) => {
  const authorization = await authorizeCalendarRoute(context, false);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  try {
    return context.json({
      resources: await listOrganizationResources(context.env, authorization.organizationId),
      requestId: context.get("requestId"),
    });
  } catch (error: unknown) {
    const result = resourceProblem(
      error,
      context.get("requestId"),
      "Organization resources are temporarily unavailable.",
    );
    return context.json(result.problem, result.status);
  }
});

router.post("/api/organization/resources", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  const body = organizationResourceRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success)
    return context.json(
      {
        code: "validation_failed",
        message: "A valid private file or HTTPS resource link is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  try {
    const resource = await createOrganizationResource(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      body.data,
    );
    return context.json({ ...resource, requestId: context.get("requestId") }, 201);
  } catch (error: unknown) {
    const result = resourceProblem(
      error,
      context.get("requestId"),
      "The resource could not be created.",
    );
    return context.json(result.problem, result.status);
  }
});

router.put("/api/organization/resources/order", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  const body = organizationResourceOrderRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success)
    return context.json(
      {
        code: "validation_failed",
        message: "A complete valid resource order is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  try {
    await reorderOrganizationResources(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      body.data.resourceIds,
    );
    return context.json({ requestId: context.get("requestId"), status: "updated" as const });
  } catch (error: unknown) {
    const result = resourceProblem(
      error,
      context.get("requestId"),
      "The resource order could not be updated.",
    );
    return context.json(result.problem, result.status);
  }
});

router.put("/api/organization/resources/:resourceId", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  const resourceId = z.uuid().safeParse(context.req.param("resourceId"));
  const body = organizationResourceRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!resourceId.success || !body.success)
    return context.json(
      {
        code: "validation_failed",
        message: "A valid resource and details are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  try {
    const resource = await updateOrganizationResource(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      resourceId.data,
      body.data,
    );
    return context.json({ ...resource, requestId: context.get("requestId") });
  } catch (error: unknown) {
    const result = resourceProblem(
      error,
      context.get("requestId"),
      "The resource could not be updated.",
    );
    return context.json(result.problem, result.status);
  }
});

router.delete("/api/organization/resources/:resourceId", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  const resourceId = z.uuid().safeParse(context.req.param("resourceId"));
  if (!resourceId.success)
    return context.json(
      {
        code: "validation_failed",
        message: "A valid resource is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  try {
    const deleted = await deleteOrganizationResource(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      resourceId.data,
    );
    if (deleted.fileId)
      await reclaimPrivateOrganizationFile(context.env, {
        actorUserId: authorization.userId,
        fileId: deleted.fileId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
        storageKey: privateOrganizationFileKey(authorization.organizationId, deleted.fileId),
      });
    return context.json({
      requestId: context.get("requestId"),
      resourceId: resourceId.data,
      status: "deleted" as const,
    });
  } catch (error: unknown) {
    const result = resourceProblem(
      error,
      context.get("requestId"),
      "The resource could not be deleted.",
    );
    return context.json(result.problem, result.status);
  }
});

function communicationProblem(error: unknown, requestIdValue: string, message: string) {
  const status = error instanceof CommunicationRepositoryError ? error.status : 503;
  return {
    problem: {
      code: error instanceof CommunicationRepositoryError ? error.code : "service_unavailable",
      message,
      requestId: requestIdValue,
    } satisfies ProblemDetails,
    status,
  };
}

router.get("/api/organization/communications", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  try {
    return context.json({
      messages: await listOrganizationCommunications(context.env, authorization.organizationId),
      requestId: context.get("requestId"),
    });
  } catch (error: unknown) {
    const result = communicationProblem(
      error,
      context.get("requestId"),
      "Communication history is temporarily unavailable.",
    );
    return context.json(result.problem, result.status);
  }
});

router.get("/api/organization/communications/templates", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  try {
    return context.json({
      requestId: context.get("requestId"),
      templates: await listCommunicationTemplates(context.env, authorization.organizationId),
    });
  } catch (error: unknown) {
    const result = communicationProblem(
      error,
      context.get("requestId"),
      "Communication templates are temporarily unavailable.",
    );
    return context.json(result.problem, result.status);
  }
});

router.post("/api/organization/communications/templates", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  const body = communicationTemplateRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success)
    return context.json(
      {
        code: "validation_failed",
        message: "Valid communication template details are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  try {
    const template = await saveCommunicationTemplate(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      body.data,
    );
    return context.json({ ...template, requestId: context.get("requestId") }, 201);
  } catch (error: unknown) {
    const result = communicationProblem(
      error,
      context.get("requestId"),
      "The communication template could not be saved.",
    );
    return context.json(result.problem, result.status);
  }
});

router.delete("/api/organization/communications/templates/:templateId", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  const templateId = z.uuid().safeParse(context.req.param("templateId"));
  if (!templateId.success)
    return context.json(
      {
        code: "validation_failed",
        message: "A valid communication template is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  try {
    await deleteCommunicationTemplate(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      templateId.data,
    );
    return context.json({
      id: templateId.data,
      requestId: context.get("requestId"),
      status: "deleted" as const,
    });
  } catch (error: unknown) {
    const result = communicationProblem(
      error,
      context.get("requestId"),
      "The communication template could not be deleted.",
    );
    return context.json(result.problem, result.status);
  }
});

router.delete("/api/organization/communications/drafts/:messageId", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  const messageId = z.uuid().safeParse(context.req.param("messageId"));
  if (!messageId.success)
    return context.json(
      {
        code: "validation_failed",
        message: "A valid draft is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  try {
    await deleteCommunicationDraft(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      messageId.data,
    );
    return context.json({
      id: messageId.data,
      requestId: context.get("requestId"),
      status: "deleted" as const,
    });
  } catch (error: unknown) {
    const result = communicationProblem(
      error,
      context.get("requestId"),
      "The communication draft could not be deleted.",
    );
    return context.json(result.problem, result.status);
  }
});

router.post("/api/organization/communications/reach-preview", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  const body = z
    .object({
      audience: communicationAudienceRequestSchema,
      channel: z.enum(["Email", "SMS", "Both"]),
    })
    .safeParse(await context.req.json<unknown>().catch(() => null));
  if (!body.success)
    return context.json(
      {
        code: "validation_failed",
        message: "Valid communication audience filters and a channel are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  try {
    return context.json({
      ...(await previewCommunicationReach(
        context.env,
        context.env.CONTROL_DB,
        authorization.organizationId,
        body.data,
      )),
      requestId: context.get("requestId"),
    });
  } catch (error: unknown) {
    const result = communicationProblem(
      error,
      context.get("requestId"),
      "Communication reach could not be calculated.",
    );
    return context.json(result.problem, result.status);
  }
});

router.post("/api/organization/communications/drafts", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  const body = communicationDraftRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success)
    return context.json(
      {
        code: "validation_failed",
        message: "Valid draft details are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  try {
    const message = await saveCommunicationDraft(
      context.env,
      context.env.CONTROL_DB,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      body.data,
    );
    return context.json({ ...message, requestId: context.get("requestId") }, 201);
  } catch (error: unknown) {
    const result = communicationProblem(
      error,
      context.get("requestId"),
      "The communication draft could not be saved.",
    );
    return context.json(result.problem, result.status);
  }
});

router.post("/api/organization/communications/send", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  const body = communicationSendRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success)
    return context.json(
      {
        code: "validation_failed",
        message: "A valid message, audience, and delivery channel are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  try {
    const message = await sendOrganizationCommunication(
      context.env,
      context.env.CONTROL_DB,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        organizationOrigin: new URL(context.req.url).origin,
        requestId: context.get("requestId"),
      },
      body.data,
    );
    return context.json({ ...message, requestId: context.get("requestId") }, 202);
  } catch (error: unknown) {
    const result = communicationProblem(
      error,
      context.get("requestId"),
      "The communication could not be queued.",
    );
    return context.json(result.problem, result.status);
  }
});

router.get("/api/organization/communications/:messageId/delivery-summary", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  const messageId = z.uuid().safeParse(context.req.param("messageId"));
  if (!messageId.success)
    return context.json(
      {
        code: "validation_failed",
        message: "A valid communication is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  try {
    return context.json({
      ...(await readCommunicationDeliverySummary(
        context.env,
        authorization.organizationId,
        messageId.data,
      )),
      requestId: context.get("requestId"),
    });
  } catch (error: unknown) {
    const result = communicationProblem(
      error,
      context.get("requestId"),
      "Communication delivery status is temporarily unavailable.",
    );
    return context.json(result.problem, result.status);
  }
});

router.post("/api/organization/communications/:messageId/retry-failed", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok)
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  const messageId = z.uuid().safeParse(context.req.param("messageId"));
  if (!messageId.success)
    return context.json(
      {
        code: "validation_failed",
        message: "A valid communication is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  try {
    const retried = await retryCommunicationDeliveries(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      messageId.data,
    );
    return context.json({
      messageId: messageId.data,
      requestId: context.get("requestId"),
      retried,
    });
  } catch (error: unknown) {
    const result = communicationProblem(
      error,
      context.get("requestId"),
      "Failed deliveries could not be queued for retry.",
    );
    return context.json(result.problem, result.status);
  }
});

router.get("/api/organization/music", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    return context.json({
      pieces: await listOrganizationMusicPieces(context.env, authorization.organizationId),
      requestId: context.get("requestId"),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Organization music catalog is temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.get("/api/singer/music", async (context) => {
  const authorization = await authorizeCalendarRoute(context, false);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    const pieces = await listOrganizationMusicPieces(context.env, authorization.organizationId);
    return context.json({
      pieces: pieces.map((piece) => singerLearningTrackPieceSchema.parse(piece)),
      requestId: context.get("requestId"),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Organization practice library is temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.get("/api/organization/music/export", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    const pieces = await listOrganizationMusicPieces(context.env, authorization.organizationId);
    return context.body(renderMusicCsv(pieces), 200, {
      "cache-control": "private, no-store",
      "content-disposition": 'attachment; filename="music_library.csv"',
      "content-type": "text/csv; charset=utf-8",
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The music catalog export is temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

function musicImportProblem(
  error: unknown,
  requestIdValue: string,
): { readonly problem: ProblemDetails; readonly status: 400 | 404 | 409 | 500 | 503 } {
  if (error instanceof MusicRepositoryError) {
    return {
      problem: {
        code: error.code,
        message: "The music catalog import could not be completed.",
        requestId: requestIdValue,
      },
      status: error.status,
    };
  }
  if (error instanceof MusicCsvError) {
    const row = error.row === null ? "" : ` (row ${String(error.row)})`;
    return {
      problem: {
        code: "validation_failed",
        message: `${error.message}${row}`,
        requestId: requestIdValue,
      },
      status: 400,
    };
  }
  if (error instanceof z.ZodError) {
    return {
      problem: {
        code: "validation_failed",
        message: "The music CSV contains invalid values.",
        requestId: requestIdValue,
      },
      status: 400,
    };
  }
  return {
    problem: {
      code: "service_unavailable",
      message: "The music catalog import could not be completed.",
      requestId: requestIdValue,
    },
    status: 503,
  };
}

router.post("/api/organization/music/import", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const declaredLength = Number(context.req.header("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 2_000_000) {
    return context.json(
      {
        code: "validation_failed",
        message: "Music CSV files may not exceed 2 MB.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      413,
    );
  }
  const csv = await context.req.text();
  if (new TextEncoder().encode(csv).byteLength > 2_000_000) {
    return context.json(
      {
        code: "validation_failed",
        message: "Music CSV files may not exceed 2 MB.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      413,
    );
  }
  try {
    const parsed = parseMusicCsv(csv).map((piece) =>
      organizationMusicPieceRequestSchema.parse({
        ...piece,
        parentId: null,
        trackFileIds: {},
      }),
    );
    if (parsed.length === 0) throw new MusicCsvError("The CSV contains no music pieces.");
    const imported = await importOrganizationMusicPieces(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      parsed,
    );
    return context.json({ imported, requestId: context.get("requestId") }, 201);
  } catch (error: unknown) {
    const failure = musicImportProblem(error, context.get("requestId"));
    return context.json(failure.problem, failure.status);
  }
});

router.post("/api/organization/music", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const body = organizationMusicPieceRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "Valid music-piece details are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const piece = await createOrganizationMusicPiece(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      body.data,
    );
    return context.json({ ...piece, requestId: context.get("requestId") }, 201);
  } catch (error: unknown) {
    const status = error instanceof MusicRepositoryError ? error.status : 503;
    return context.json(
      {
        code: error instanceof MusicRepositoryError ? error.code : "service_unavailable",
        message: "The music piece could not be created.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      status,
    );
  }
});

router.put("/api/organization/music/:pieceId", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const pieceId = z.uuid().safeParse(context.req.param("pieceId"));
  const body = organizationMusicPieceRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!pieceId.success || !body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid music piece and details are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const piece = await updateOrganizationMusicPiece(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      pieceId.data,
      body.data,
    );
    return context.json({ ...piece, requestId: context.get("requestId") });
  } catch (error: unknown) {
    const status = error instanceof MusicRepositoryError ? error.status : 503;
    return context.json(
      {
        code: error instanceof MusicRepositoryError ? error.code : "service_unavailable",
        message: "The music piece could not be updated.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      status,
    );
  }
});

router.delete("/api/organization/music/:pieceId", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const pieceId = z.uuid().safeParse(context.req.param("pieceId"));
  if (!pieceId.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid music piece is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    await deleteOrganizationMusicPiece(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      pieceId.data,
      context.req.query("unlinkChildren") === "true",
    );
    return context.json({
      pieceId: pieceId.data,
      requestId: context.get("requestId"),
      status: "deleted" as const,
    });
  } catch (error: unknown) {
    const status = error instanceof MusicRepositoryError ? error.status : 503;
    return context.json(
      {
        code: error instanceof MusicRepositoryError ? error.code : "service_unavailable",
        message: "The music piece could not be deleted.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      status,
    );
  }
});

router.get("/api/singer/events", async (context) => {
  const authorization = await authorizeCalendarRoute(context, false);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const profileId = await linkedOrganizationProfileId(
    context.env.CONTROL_DB,
    authorization.organizationId,
    authorization.userId,
  );
  if (!profileId) {
    return context.json(
      {
        code: "not_found",
        message: "A linked Organization Profile is required for a personal schedule.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  try {
    const [events, settings] = await Promise.all([
      listMemberSchedule(context.env, authorization.organizationId, profileId),
      readOrganizationCalendarSettings(context.env, authorization.organizationId),
    ]);
    return context.json({
      events,
      profileId,
      requestId: context.get("requestId"),
      timezone: settings.timezone,
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The personal Organization schedule is temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.put("/api/singer/events/:eventId/rsvp", async (context) => {
  const authorization = await authorizeCalendarRoute(context, false);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const eventId = z.uuid().safeParse(context.req.param("eventId"));
  const body = singerRsvpRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!eventId.success || !body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid event and RSVP are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const profileId = await linkedOrganizationProfileId(
    context.env.CONTROL_DB,
    authorization.organizationId,
    authorization.userId,
  );
  if (!profileId) {
    return context.json(
      {
        code: "not_found",
        message: "A linked Organization Profile is required to RSVP.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
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
      { profileId, rsvp: body.data.rsvp, rsvpNote: body.data.rsvpNote },
    );
    return context.json({ ...rsvp, requestId: context.get("requestId") });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The RSVP could not be updated.",
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

router.get("/api/organization/roster-configuration", async (context) => {
  const authorization = await authorizeCalendarRoute(context, false);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    return context.json({
      ...(await readOrganizationRosterConfiguration(context.env, authorization.organizationId)),
      requestId: context.get("requestId"),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Organization roster configuration is temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.put("/api/organization/roster-configuration", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const body = organizationRosterConfigurationRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "Valid, uniquely labeled sections and voice parts are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const configuration = await updateOrganizationRosterConfiguration(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      body.data,
    );
    if (configuration === "voice_part_in_use") {
      return context.json(
        {
          code: "voice_part_in_use",
          message: "A voice part assigned to an Organization Profile cannot be removed or renamed.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        409,
      );
    }
    return context.json({ ...configuration, requestId: context.get("requestId") });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Organization roster configuration could not be updated.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.get("/api/organization/seating-configuration", async (context) => {
  const authorization = await authorizeCalendarRoute(context, false);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    return context.json({
      configuration: await readOrganizationSeatingConfiguration(
        context.env,
        authorization.organizationId,
      ),
      requestId: context.get("requestId"),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Organization seating configuration is temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.put("/api/organization/seating-configuration", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const body = seatingConfigurationRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "Valid seating formations and a default formation are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const configuration = await updateOrganizationSeatingConfiguration(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      body.data,
    );
    return context.json({ configuration, requestId: context.get("requestId") });
  } catch (error: unknown) {
    const status = error instanceof SeatingRepositoryError ? error.status : 503;
    return context.json(
      {
        code: error instanceof SeatingRepositoryError ? error.code : "service_unavailable",
        message:
          status === 409
            ? "A formation is invalid or is still used by a seating chart."
            : "The Organization seating configuration could not be updated.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      status,
    );
  }
});

router.get("/api/organization/events/:eventId/seating-charts", async (context) => {
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
        message: "A valid performance is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    return context.json({
      charts: await listOrganizationSeatingCharts(
        context.env,
        authorization.organizationId,
        eventId.data,
      ),
      requestId: context.get("requestId"),
    });
  } catch (error: unknown) {
    const status = error instanceof SeatingRepositoryError ? error.status : 503;
    return context.json(
      {
        code: error instanceof SeatingRepositoryError ? error.code : "service_unavailable",
        message:
          status === 404 ? "The performance was not found." : "Seating charts are unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      status,
    );
  }
});

router.post("/api/organization/events/:eventId/seating-charts", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const eventId = z.uuid().safeParse(context.req.param("eventId"));
  const chart = organizationSeatingChartRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!eventId.success || !chart.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid performance and seating chart are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const created = await createOrganizationSeatingChart(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      eventId.data,
      chart.data,
    );
    return context.json({ ...created, requestId: context.get("requestId") }, 201);
  } catch (error: unknown) {
    const status = error instanceof SeatingRepositoryError ? error.status : 503;
    return context.json(
      {
        code: error instanceof SeatingRepositoryError ? error.code : "service_unavailable",
        message:
          status === 409
            ? "The chart contains an invalid formation, venue, seat, or performer assignment."
            : "The seating chart could not be created.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      status,
    );
  }
});

router.put("/api/organization/events/:eventId/seating-charts/:chartId", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const eventId = z.uuid().safeParse(context.req.param("eventId"));
  const chartId = z.uuid().safeParse(context.req.param("chartId"));
  const chart = organizationSeatingChartRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!eventId.success || !chartId.success || !chart.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid performance and seating chart are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const updated = await updateOrganizationSeatingChart(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      eventId.data,
      chartId.data,
      chart.data,
    );
    return context.json({ ...updated, requestId: context.get("requestId") });
  } catch (error: unknown) {
    const status = error instanceof SeatingRepositoryError ? error.status : 503;
    return context.json(
      {
        code: error instanceof SeatingRepositoryError ? error.code : "service_unavailable",
        message:
          status === 409
            ? "The chart contains an invalid formation, venue, seat, or performer assignment."
            : status === 404
              ? "The seating chart was not found."
              : "The seating chart could not be updated.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      status,
    );
  }
});

router.delete("/api/organization/events/:eventId/seating-charts/:chartId", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const eventId = z.uuid().safeParse(context.req.param("eventId"));
  const chartId = z.uuid().safeParse(context.req.param("chartId"));
  if (!eventId.success || !chartId.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid performance and seating chart are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    await deleteOrganizationSeatingChart(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      eventId.data,
      chartId.data,
    );
    return context.json({
      chartId: chartId.data,
      requestId: context.get("requestId"),
      status: "deleted",
    });
  } catch (error: unknown) {
    const status = error instanceof SeatingRepositoryError ? error.status : 503;
    return context.json(
      {
        code: error instanceof SeatingRepositoryError ? error.code : "service_unavailable",
        message:
          status === 404
            ? "The seating chart was not found."
            : "The seating chart could not be deleted.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      status,
    );
  }
});

router.get("/api/singer/events/:eventId/seating", async (context) => {
  const authorization = await authorizeCalendarRoute(context, false);
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
        message: "A valid performance is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const profileId = await linkedOrganizationProfileId(
    context.env.CONTROL_DB,
    authorization.organizationId,
    authorization.userId,
  );
  if (!profileId) {
    return context.json(
      {
        code: "not_found",
        message: "A linked Organization Profile is required for seating.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  try {
    const result = await readSingerSeating(
      context.env,
      authorization.organizationId,
      eventId.data,
      null,
      profileId,
    );
    return context.json({ ...result, requestId: context.get("requestId") });
  } catch (error: unknown) {
    const status = error instanceof SeatingRepositoryError ? error.status : 503;
    return context.json(
      {
        code: error instanceof SeatingRepositoryError ? error.code : "service_unavailable",
        message:
          status === 403
            ? "Only Profiles on this performance roster may view its seating."
            : "Performance seating is unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      status,
    );
  }
});

router.get("/api/singer/seating-profiles", async (context) => {
  const authorization = await authorizeCalendarRoute(context, false);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const eventId = z.uuid().safeParse(context.req.query("eventId"));
  const chartId = z.uuid().safeParse(context.req.query("chartId"));
  if (!eventId.success || !chartId.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid performance and seating chart are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const profileId = await linkedOrganizationProfileId(
    context.env.CONTROL_DB,
    authorization.organizationId,
    authorization.userId,
  );
  if (!profileId) {
    return context.json(
      {
        code: "forbidden",
        message: "A linked Organization Profile is required for seating.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      403,
    );
  }
  try {
    const result = await readSingerSeating(
      context.env,
      authorization.organizationId,
      eventId.data,
      chartId.data,
      profileId,
    );
    return context.json({
      profiles: result.profiles.map(({ displayName, id, voicePart }) => ({
        id,
        name: displayName,
        voicePart,
      })),
      requestId: context.get("requestId"),
    });
  } catch (error: unknown) {
    const status = error instanceof SeatingRepositoryError ? error.status : 503;
    return context.json(
      {
        code: error instanceof SeatingRepositoryError ? error.code : "service_unavailable",
        message:
          status === 403
            ? "Only rostered Profiles may view seating."
            : "Seating Profiles are unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      status,
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

router.delete("/api/organization/venues/:venueId", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const venueId = z.uuid().safeParse(context.req.param("venueId"));
  if (!venueId.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid venue is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const status = await deleteOrganizationVenue(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      venueId.data,
    );
    if (status === "in_use") {
      return context.json(
        {
          code: "venue_in_use",
          message: "This venue is linked to an event and cannot be deleted.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        409,
      );
    }
    if (status === "not_found") {
      return context.json(
        {
          code: "venue_not_found",
          message: "The venue was not found in this Organization.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    return context.json({ requestId: context.get("requestId"), status, venueId: venueId.data });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Organization venue could not be deleted.",
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

router.get("/api/organization/dashboard-summary", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    return context.json({
      ...(await readOrganizationDashboardSummary(context.env, authorization.organizationId)),
      requestId: context.get("requestId"),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The Organization dashboard summary is temporarily unavailable.",
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
  } catch (error: unknown) {
    if (error instanceof CalendarMutationError && error.status === 409) {
      return context.json(
        {
          code: error.code,
          message: calendarMutationMessage(error.code),
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        409,
      );
    }
    if (error instanceof CalendarMutationError && error.status === 404) {
      return context.json(
        {
          code: error.code,
          message: calendarMutationMessage(error.code),
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
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
  } catch (error: unknown) {
    if (error instanceof CalendarMutationError && error.status === 409) {
      return context.json(
        {
          code: error.code,
          message: calendarMutationMessage(error.code),
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        409,
      );
    }
    if (error instanceof CalendarMutationError && error.status === 404) {
      return context.json(
        {
          code: error.code,
          message: calendarMutationMessage(error.code),
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
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

router.post("/api/organization/rsvp-tokens", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const body = generateRsvpTokensRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "Valid event and profile IDs are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    return context.json({
      ...(await generateRsvpTokens(
        context.env,
        authorization.organizationId,
        body.data.eventId,
        body.data.profileIds,
      )),
      requestId: context.get("requestId"),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "RSVP tokens could not be generated.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.post("/api/organization/poll-tokens", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const body = generatePollTokensRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "Valid poll and profile IDs are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    return context.json({
      ...(await generatePollTokens(
        context.env,
        authorization.organizationId,
        body.data.pollId,
        body.data.profileIds,
      )),
      requestId: context.get("requestId"),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Poll tokens could not be generated.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.post("/api/organization/player-tokens", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const body = generatePlayerTokensRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "Valid event and profile IDs are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    return context.json({
      ...(await generatePlayerTokens(
        context.env,
        authorization.organizationId,
        body.data.eventId,
        body.data.profileIds,
      )),
      requestId: context.get("requestId"),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Player tokens could not be generated.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.get("/api/organization/auditions", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    const stub = context.env.ORGANIZATION_STORE.get(
      context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
    );
    const response = await stub.fetch("https://organization.internal/internal/auditions/list");
    const bodyJson: unknown = await response.json();
    const auditionsList =
      bodyJson && typeof bodyJson === "object" && !Array.isArray(bodyJson)
        ? Object.assign(bodyJson, {})
        : {};
    return context.json({ requestId: context.get("requestId"), ...auditionsList });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Auditions could not be retrieved.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.post("/api/organization/audition-tokens", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const body = generateAuditionTokensRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "Valid audition IDs are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    return context.json({
      ...(await generateAuditionTokens(
        context.env,
        authorization.organizationId,
        body.data.auditionIds,
      )),
      requestId: context.get("requestId"),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Audition tokens could not be generated.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.put("/api/organization/auditions/:auditionId", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const auditionId = context.req.param("auditionId");
  if (!auditionId) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid audition ID is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const body = organizationAuditionUpdateRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "Valid audition update fields are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const stub = context.env.ORGANIZATION_STORE.get(
      context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
    );
    const url = new URL("https://organization.internal/internal/audition/update");
    url.searchParams.set("auditionId", auditionId);
    if (body.data.adminNotes !== undefined)
      url.searchParams.set("adminNotes", body.data.adminNotes);
    if (body.data.status !== undefined) url.searchParams.set("status", body.data.status);
    const response = await stub.fetch(url, { method: "POST" });
    if (!response.ok) {
      return context.json(
        {
          code: "service_unavailable",
          message: "Audition could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
    const updated: unknown = await response.json();
    const updatedObj =
      updated && typeof updated === "object" && !Array.isArray(updated)
        ? Object.assign(updated, {})
        : {};
    return context.json({ requestId: context.get("requestId"), ...updatedObj });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Audition could not be updated.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.get("/api/organization/events/:eventId/rsvp-export.csv", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const eventId = z.uuid().safeParse(context.req.param("eventId"));
  const sort = context.req.query("sort") ?? "lastName";
  if (!eventId.success || (sort !== "lastName" && sort !== "section")) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid event and RSVP export sort are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const data = await readOrganizationEventRsvpExport(
      context.env,
      authorization.organizationId,
      eventId.data,
    );
    if (!data) {
      return context.json(
        {
          code: "not_found",
          message: "The Organization event was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const csv = renderEventRsvpCsv({ ...data, sort });
    return context.body(csv, 200, {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="${eventRsvpExportFilename(data.eventTitle, data.eventType)}"`,
      "content-type": "text/csv; charset=utf-8",
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The event RSVP export could not be generated.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.get("/api/organization/polls", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const archived = context.req.query("archived") === "true";
  const url = new URL(
    archived
      ? "https://organization.internal/internal/polls/archived"
      : "https://organization.internal/internal/polls",
  );
  url.searchParams.set("organizationId", authorization.organizationId);
  const stub = context.env.ORGANIZATION_STORE.get(
    context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
  );
  const response = await stub.fetch(url);
  if (!response.ok) {
    return context.json(
      {
        code: "service_unavailable",
        message: "Polls could not be listed.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
  return context.json({ polls: await response.json(), requestId: context.get("requestId") });
});

router.get("/api/organization/polls/:pollId", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const pollId = z.uuid().safeParse(context.req.param("pollId"));
  if (!pollId.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid poll ID is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  const url = new URL("https://organization.internal/internal/polls/poll");
  url.searchParams.set("organizationId", authorization.organizationId);
  url.searchParams.set("pollId", pollId.data);
  const stub = context.env.ORGANIZATION_STORE.get(
    context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
  );
  const response = await stub.fetch(url);
  if (!response.ok) {
    return context.json(
      {
        code: "not_found",
        message: "Poll not found.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  const poll: object = await response.json();
  return context.json({ ...poll, requestId: context.get("requestId") });
});

router.post("/api/organization/polls", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const body = organizationPollRequestSchema
    .extend({ id: z.uuid() })
    .safeParse(await context.req.json<unknown>().catch(() => null));
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid poll is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const stub = context.env.ORGANIZATION_STORE.get(
      context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
    );
    const response = await stub.fetch("https://organization.internal/internal/polls/manage", {
      body: JSON.stringify({
        action: "create_poll",
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        poll: body.data,
        requestId: context.get("requestId"),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      return context.json(
        {
          code: "validation_failed",
          message: "The poll could not be created.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const created: object = await response.json();
    return context.json(
      {
        ...created,
        requestId: context.get("requestId"),
      },
      201,
    );
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The poll could not be created.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.put("/api/organization/polls/:pollId", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const pollId = z.uuid().safeParse(context.req.param("pollId"));
  const body = organizationPollRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!pollId.success || !body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid poll and ID are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const stub = context.env.ORGANIZATION_STORE.get(
      context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
    );
    const response = await stub.fetch("https://organization.internal/internal/polls/manage", {
      body: JSON.stringify({
        action: "update_poll",
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        poll: { id: pollId.data, ...body.data },
        requestId: context.get("requestId"),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      return context.json(
        {
          code: "validation_failed",
          message: "The poll could not be updated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const updated: object = await response.json();
    return context.json({
      ...updated,
      requestId: context.get("requestId"),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The poll could not be updated.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.post("/api/organization/polls/:pollId/archive", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const pollId = z.uuid().safeParse(context.req.param("pollId"));
  if (!pollId.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid poll ID is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const stub = context.env.ORGANIZATION_STORE.get(
      context.env.ORGANIZATION_STORE.idFromName(authorization.organizationId),
    );
    const response = await stub.fetch("https://organization.internal/internal/polls/manage", {
      body: JSON.stringify({
        action: "archive_poll",
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        pollId: pollId.data,
        requestId: context.get("requestId"),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      return context.json(
        {
          code: "not_found",
          message: "Poll not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }
    const archived: object = await response.json();
    return context.json({
      ...archived,
      requestId: context.get("requestId"),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "The poll could not be archived.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.get("/api/organization/events/:eventId/attendance", async (context) => {
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
    return context.json({
      eventId: eventId.data,
      requestId: context.get("requestId"),
      rows: await listOrganizationEventAttendance(
        context.env,
        authorization.organizationId,
        eventId.data,
      ),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Organization attendance is temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.put("/api/organization/events/:eventId/attendance", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const eventId = z.uuid().safeParse(context.req.param("eventId"));
  const body = organizationAttendanceBulkRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!eventId.success || !body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid event and attendance updates are required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    return context.json({
      eventId: eventId.data,
      requestId: context.get("requestId"),
      rows: await updateOrganizationEventAttendance(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        eventId.data,
        body.data.updates,
      ),
    });
  } catch {
    return context.json(
      {
        code: "service_unavailable",
        message: "Organization attendance could not be updated.",
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

router.post("/api/test-smtp", async (context) => {
  const auth = createAuth({
    env: context.env,
    requestUrl: new URL(context.req.url),
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Authentication required.",
        requestId: context.get("requestId"),
      },
      401,
    );
  }
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return context.json({ error: "Invalid request body" }, 400);
  }
  const parsed = z.object({ to: z.string().min(3).max(320) }).safeParse(body);
  if (!parsed.success || !parsed.data.to.includes("@"))
    return context.json({ error: "Invalid email address" }, 400);
  const mode: string = context.env.EXTERNAL_EFFECTS_MODE || "fake";
  if (mode === "fake") {
    return context.json({
      sent: true,
      mode: "fake",
      to: parsed.data.to,
      requestId: context.get("requestId"),
    });
  }
  return context.json({ error: "Real email sending not configured" }, 501);
});

router.post("/api/test-sms", async (context) => {
  const auth = createAuth({
    env: context.env,
    requestUrl: new URL(context.req.url),
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Authentication required.",
        requestId: context.get("requestId"),
      },
      401,
    );
  }
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return context.json({ error: "Invalid request body" }, 400);
  }
  const parsed = z.object({ to: z.string().min(1).max(20) }).safeParse(body);
  if (!parsed.success) return context.json({ error: "Invalid phone number" }, 400);
  const mode: string = context.env.EXTERNAL_EFFECTS_MODE || "fake";
  if (mode === "fake") {
    return context.json({
      sent: true,
      mode: "fake",
      to: parsed.data.to,
      requestId: context.get("requestId"),
    });
  }
  return context.json({ error: "Real SMS sending not configured" }, 501);
});

router.get("/api/admin/queue-settings", async (context) => {
  const auth = createAuth({
    env: context.env,
    requestUrl: new URL(context.req.url),
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Authentication required.",
        requestId: context.get("requestId"),
      },
      401,
    );
  }
  return context.json({
    queue: "choir-management-jobs-local",
    deadLetterQueue: "choir-management-jobs-dlq-local",
    mode: context.env.EXTERNAL_EFFECTS_MODE || "fake",
    requestId: context.get("requestId"),
  });
});

router.post("/api/admin/queue-settings/generate", async (context) => {
  const auth = createAuth({
    env: context.env,
    requestUrl: new URL(context.req.url),
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Authentication required.",
        requestId: context.get("requestId"),
      },
      401,
    );
  }
  return context.json({ generated: true, requestId: context.get("requestId") });
});

router.post("/api/admin/bulk-update-rsvps", async (context) => {
  const auth = createAuth({
    env: context.env,
    requestUrl: new URL(context.req.url),
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Authentication required.",
        requestId: context.get("requestId"),
      },
      401,
    );
  }
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "No Organization is registered for this hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  return context.json({ updated: 0, requestId: context.get("requestId") });
});

router.post("/api/singer/resolve-placeholders", async (context) => {
  const auth = createAuth({
    env: context.env,
    requestUrl: new URL(context.req.url),
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Authentication required.",
        requestId: context.get("requestId"),
      },
      401,
    );
  }
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "No Organization is registered for this hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  return context.json({ resolved: [], requestId: context.get("requestId") });
});

router.post("/api/checkout/rsvp", async (context) => {
  const auth = createAuth({
    env: context.env,
    requestUrl: new URL(context.req.url),
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Authentication required.",
        requestId: context.get("requestId"),
      },
      401,
    );
  }
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "No Organization is registered for this hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return context.json({ error: "Invalid request body" }, 400);
  }
  const parsed = z
    .object({
      name: z.string().min(1).max(200),
      email: z.string().min(3).max(320),
      rsvp: z.enum(["Yes", "No", "Pending"]),
    })
    .safeParse(body);
  if (!parsed.success) return context.json({ error: "Invalid RSVP request" }, 400);
  return context.json({ rsvp: parsed.data.rsvp, requestId: context.get("requestId") });
});

router.get("/api/singer/player-playlist", async (context) => {
  const auth = createAuth({
    env: context.env,
    requestUrl: new URL(context.req.url),
    waitUntil: (promise) => {
      context.executionCtx.waitUntil(promise);
    },
  });
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  if (!session) {
    return context.json(
      {
        code: "unauthorized",
        message: "Authentication required.",
        requestId: context.get("requestId"),
      },
      401,
    );
  }
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return context.json(
      {
        code: "not_found",
        message: "No Organization is registered for this hostname.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      404,
    );
  }
  return context.json({ playlist: [], requestId: context.get("requestId") });
});

router.get("/api/setup/status", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    const status = await getSetupStatus(context.env, authorization.organizationId);
    return context.json(status);
  } catch {
    return context.json(
      {
        code: "setup_unavailable",
        message: "Setup status is temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.post("/api/setup/claim", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    const result = await claimSetup(context.env, {
      actorUserId: authorization.userId,
      organizationId: authorization.organizationId,
      requestId: context.get("requestId"),
    });
    return context.json(result);
  } catch (error: unknown) {
    return context.json(
      {
        code: error instanceof SetupError ? error.code : "setup_claim_unavailable",
        message: error instanceof SetupError ? error.message : "Setup could not be claimed.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      error instanceof SetupError && error.status === 409 ? 409 : 503,
    );
  }
});

router.post("/api/setup/progress", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  const body = setupProgressRequestSchema.safeParse(
    await context.req.json<unknown>().catch(() => null),
  );
  if (!body.success) {
    return context.json(
      {
        code: "validation_failed",
        message: "A valid setup step is required.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      400,
    );
  }
  try {
    const result = await saveSetupProgress(
      context.env,
      {
        actorUserId: authorization.userId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      },
      body.data,
    );
    return context.json(result);
  } catch (error: unknown) {
    return context.json(
      {
        code: error instanceof SetupError ? error.code : "setup_progress_unavailable",
        message: error instanceof SetupError ? error.message : "Setup progress could not be saved.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      error instanceof SetupError && error.status === 409 ? 409 : 503,
    );
  }
});

router.post("/api/setup/complete", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    const result = await completeSetup(context.env, {
      actorUserId: authorization.userId,
      organizationId: authorization.organizationId,
      requestId: context.get("requestId"),
    });
    return context.json(result);
  } catch (error: unknown) {
    return context.json(
      {
        code: error instanceof SetupError ? error.code : "setup_complete_unavailable",
        message: error instanceof SetupError ? error.message : "Setup could not be completed.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      error instanceof SetupError && error.status === 409 ? 409 : 503,
    );
  }
});

router.get("/api/modules/state", async (context) => {
  const authorization = await authorizeCalendarRoute(context, true);
  if (!authorization.ok) {
    return context.json(
      { ...authorization, requestId: context.get("requestId") },
      authorization.status,
    );
  }
  try {
    const modules = await getModuleState(context.env, authorization.organizationId);
    return context.json({ modules });
  } catch {
    return context.json(
      {
        code: "modules_unavailable",
        message: "Module state is temporarily unavailable.",
        requestId: context.get("requestId"),
      } satisfies ProblemDetails,
      503,
    );
  }
});

router.notFound((context) => {
  const problem: ProblemDetails = {
    code: "not_found",
    message: "The requested API route was not found.",
    requestId: context.get("requestId"),
  };
  return context.json(problem, 404);
});
