import {
  type PlatformOrganizationSummary,
  type PlatformJobDeadLetterSummary,
  type PlatformFleetSchemaPreparation,
  type OrganizationProviderStatusResponse,
  type ProblemDetails,
} from "@choir/contracts";
import { type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { createAuth } from "../../auth/config";
import { authorizePlatformAdministratorSession } from "../../auth/platformAdministrator";
import { getPlatformOrganizationContext } from "../../auth/platformElevation";
import type { Env } from "../../env";
import { validateStartupConfig } from "../../env";
import { authorizeOrganizationMember } from "../../tenancy/authorizeOrganization";
import { organizationExportKey } from "../../organization/exportStore";
import { invokeOrganizationRpc, organizationStoreStub } from "../../organization/rpc/client";

import { resolveCanonicalOrganizationId } from "./tenancyHelpers";

export function setupFailureStatus(status: number): ContentfulStatusCode {
  switch (status) {
    case 400:
      return 400;
    case 401:
      return 401;
    case 403:
      return 403;
    case 404:
      return 404;
    case 409:
      return 409;
    case 422:
      return 422;
    case 429:
      return 429;
    case 500:
      return 500;
    case 502:
      return 502;
    case 504:
      return 504;
    default:
      return 503;
  }
}

export interface WorkerHonoEnvironment {
  Bindings: Env;
  Variables: {
    requestId: string;
  };
}

export const MAX_JSON_BODY_BYTES = 1_048_576;
const JSON_BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface JsonRequestContext {
  req: {
    method: string;
    header(name: string): string | undefined;
    raw: Request;
  };
}

function jsonContentType(contentType: string | undefined): boolean {
  if (!contentType) return true;
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" || mediaType?.endsWith("+json") === true;
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<ArrayBuffer | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    let result = await reader.read();
    while (!result.done) {
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("json_body_too_large");
        return null;
      }
      chunks.push(result.value);
      result = await reader.read();
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const buffer = new ArrayBuffer(totalBytes);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

export async function boundJsonRequestBody(context: JsonRequestContext): Promise<boolean> {
  const method = context.req.method.toUpperCase();
  if (!JSON_BODY_METHODS.has(method)) return true;
  if (!jsonContentType(context.req.header("content-type"))) return true;

  const contentLengthHeader = context.req.header("content-length");
  if (contentLengthHeader !== undefined) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) return false;
    if (contentLength > MAX_JSON_BODY_BYTES) return false;
  }

  const body = context.req.raw.body;
  if (!body) return true;
  const boundedBody = await readBoundedBody(body, MAX_JSON_BODY_BYTES);
  if (!boundedBody) return false;
  context.req.raw = new Request(context.req.raw, { body: boundedBody });
  return true;
}

async function readJsonValue(context: Context<WorkerHonoEnvironment>): Promise<unknown> {
  const value: unknown = await context.req.json<unknown>().catch(() => null);
  return value;
}

export async function readJsonObject(
  context: Context<WorkerHonoEnvironment>,
): Promise<Record<string, unknown> | null> {
  const value = await readJsonValue(context);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value));
}

export function isErrorResponse(
  value: unknown,
): value is { readonly code: string; readonly status?: number } {
  return typeof value === "object" && value !== null && "code" in value;
}

export const PLATFORM_ORGANIZATION_PAGE_SIZE = 25;

export const PLATFORM_DEAD_LETTER_PAGE_SIZE = 25;

export const ORGANIZATION_INVITATION_PAGE_SIZE = 50;

export const browserOrganizationAuthAllowlist = new Set([
  "/api/auth/organization/list",
  "/api/auth/organization/set-active",
]);

export const invitationIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);

export const platformOrganizationCursorSchema = z.tuple([
  z.iso.datetime(),
  z.string().min(1).max(128),
]);

export const platformDeadLetterCursorSchema = z.tuple([
  z.iso.datetime(),
  z.string().min(1).max(512),
]);

export type ProviderSetupChecks = Pick<OrganizationProviderStatusResponse, "brevo" | "stripe">;

// eslint-disable-next-line complexity -- reports independent readiness states for the provider lanes.
export function providerSetupChecks(
  env: Pick<
    Env,
    | "BREVO_API_KEY"
    | "BREVO_SMS_ALLOWED_RECIPIENTS"
    | "BREVO_SMS_SENDER"
    | "EXTERNAL_EFFECTS_MODE"
    | "PLATFORM_EMAIL"
    | "PLATFORM_EMAIL_ALLOWED_RECIPIENTS"
    | "PLATFORM_EMAIL_FROM"
    | "PLATFORM_EMAIL_MODE"
    | "STRIPE_SECRET_KEY"
    | "STRIPE_WEBHOOK_SECRET"
    | "STRIPE_V2_EVENT_DESTINATION_SECRET"
  >,
  mode: "disabled" | "fake" | "sandbox",
): ProviderSetupChecks {
  const platformEmailReady =
    Boolean(env.PLATFORM_EMAIL) &&
    z.email().safeParse(env.PLATFORM_EMAIL_FROM).success &&
    env.PLATFORM_EMAIL_MODE !== "disabled";
  const brevoApiKeyConfigured = Boolean(env.BREVO_API_KEY?.trim());
  const brevoSmsSenderConfigured = Boolean(env.BREVO_SMS_SENDER?.trim());
  const stripeWebhookReady = Boolean(env.STRIPE_WEBHOOK_SECRET?.trim());
  const stripePlatformReady = Boolean(env.STRIPE_SECRET_KEY?.trim());

  const brevo =
    mode === "fake"
      ? {
          detail:
            "Fake mode is active, so no provider request is sent. Configure the Cloudflare email binding and Brevo SMS sender before live delivery.",
          status: "attention" as const,
        }
      : mode === "disabled"
        ? {
            detail: "External delivery is disabled for this environment. No email or SMS is sent.",
            status: "attention" as const,
          }
        : platformEmailReady
          ? {
              detail:
                brevoApiKeyConfigured && brevoSmsSenderConfigured
                  ? "Email sends through the Cloudflare Email Sending binding. SMS delivery is configured via Brevo."
                  : brevoApiKeyConfigured
                    ? "Email sends through the Cloudflare Email Sending binding. Set BREVO_SMS_SENDER if transactional SMS is needed."
                    : "Email sends through the Cloudflare Email Sending binding. Brevo API key can be added if SMS delivery is needed.",
              status: "ok" as const,
            }
          : {
              detail:
                "Configure the PLATFORM_EMAIL binding and a valid PLATFORM_EMAIL_FROM sender before email delivery.",
              status: "error" as const,
            };

  const stripe =
    mode === "fake"
      ? {
          detail:
            stripePlatformReady && stripeWebhookReady
              ? "Stripe Connect platform credentials are configured, but checkout remains simulated in fake mode."
              : "Fake mode is active. Configure STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET before enabling Stripe Connect payments.",
          status: "attention" as const,
        }
      : mode === "disabled"
        ? {
            detail:
              "Stripe checkout is disabled for this environment. A webhook secret alone does not enable live Organization payments.",
            status: "attention" as const,
          }
        : stripePlatformReady && stripeWebhookReady
          ? {
              detail:
                "Stripe Connect platform credentials and webhook verification are configured. Organization Stripe Connect onboarding is available.",
              status: "ok" as const,
            }
          : {
              detail:
                !stripePlatformReady && !stripeWebhookReady
                  ? "Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET for Stripe Connect onboarding and signed webhook verification."
                  : !stripePlatformReady
                    ? "Add STRIPE_SECRET_KEY for Stripe Connect onboarding."
                    : "Add STRIPE_WEBHOOK_SECRET for signed payment webhook verification.",
              status: "error" as const,
            };

  return { brevo, stripe };
}

export type CalendarAuthorization =
  | {
      readonly ok: true;
      readonly organizationId: string;
      readonly role: "administrator" | "member" | "owner";
      readonly email: string;
      readonly sessionId?: string | undefined;
      readonly userId: string;
    }
  | {
      readonly code: string;
      readonly message: string;
      readonly ok: false;
      readonly status: 401 | 403 | 404;
    };

export function calendarMutationMessage(code: string): string {
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
  if (code === "parent_performance_requires_rehearsal") {
    return "A parent performance can only be selected for a rehearsal.";
  }
  if (code === "event_not_found") return "The event was not found in this Organization.";
  if (code === "event_canceled") return "Canceled events cannot accept RSVP changes.";
  if (code === "profile_not_found") {
    return "The selected Profile was not found in this Organization.";
  }
  if (code === "duplicate_profile") {
    return "Each selected Profile can only appear once in a bulk change.";
  }
  if (code === "rsvp_voice_part_required") {
    return "Assign a voice part to the Profile before recording an RSVP.";
  }
  return "The Organization rejected an invalid event reference.";
}

export function auditionSettingsValidationMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Review the audition settings and try again.";
  const slotIndex =
    issue.path[0] === "slots" && typeof issue.path[1] === "number" ? issue.path[1] + 1 : null;
  if (slotIndex !== null) return `Check audition time slot ${String(slotIndex)}: ${issue.message}`;
  if (issue.path[0] === "defaultPerformanceId") {
    return "Choose an available target Performance for the audition settings.";
  }
  if (issue.path[0] === "venueId") {
    return "Choose an Organization venue for the auditions.";
  }
  return `Review the audition settings: ${issue.message}`;
}

export function auditionSettingsStoreMessage(code: string, status: number): string {
  if (code === "venue_required") {
    return "Choose an Organization venue for the auditions before saving.";
  }
  if (code === "venue_not_found") {
    return "The selected audition venue is no longer available. Choose another venue.";
  }
  if (code === "rehearsal_venue_required") {
    return "Choose an Organization venue for each regular rehearsal before saving.";
  }
  if (code === "rehearsal_venue_not_found") {
    return "A regular rehearsal references a venue that is no longer available. Choose another venue.";
  }
  if (code === "performance_not_found") {
    return "The selected target Performance is no longer available. Choose another Performance.";
  }
  if (code === "organization_identity_conflict") {
    return "The audition settings belong to a different Organization. Refresh and try again.";
  }
  if (code === "validation_failed") {
    return "The Organization rejected the audition settings. Check the target Performance and time slots.";
  }
  if (status >= 500) {
    return "The Organization service could not save the audition settings. Try again shortly.";
  }
  return "The audition settings were rejected. Check the target Performance and time slots.";
}

export async function authorizeCalendarRoute(
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
    email: session?.user.email ?? "",
    ok: true,
    organizationId,
    role: authorization.value.role,
    sessionId: session?.session.id,
    userId: authorization.value.userId,
  };
}

export type ExportAuthorization =
  | {
      readonly actorType: "owner" | "platform_administrator";
      readonly organizationId: string;
      readonly ok: true;
      readonly userId: string;
    }
  | {
      readonly code: string;
      readonly message: string;
      readonly ok: false;
      readonly status: 401 | 403 | 404;
    };

export async function authorizeExportRoute(
  context: Context<WorkerHonoEnvironment>,
): Promise<ExportAuthorization> {
  validateStartupConfig(context.env);
  const requestUrl = new URL(context.req.url);
  const organizationId = await resolveCanonicalOrganizationId(requestUrl, context.env);
  if (!organizationId) {
    return {
      code: "not_found",
      message: "Organization exports require a registered canonical hostname.",
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
  const member = await authorizeOrganizationMember(
    context.env.CONTROL_DB,
    organizationId,
    session?.session.id,
    session?.user.id,
  );
  if (member.ok && member.value.role === "owner") {
    return {
      actorType: "owner",
      ok: true,
      organizationId,
      userId: member.value.userId,
    };
  }
  const platform = await authorizePlatformAdministratorSession(
    context.env.CONTROL_DB,
    session?.session.id ?? null,
    session?.user.id ?? null,
  );
  if (!session) {
    return {
      code: "unauthorized",
      message: "Sign in is required.",
      ok: false,
      status: 401,
    };
  }
  if (!platform.ok) {
    if (member.ok) {
      return {
        code: "forbidden",
        message: "Only an Organization Owner or elevated Platform Administrator may export data.",
        ok: false,
        status: 403,
      };
    }
    return {
      code: platform.error.code,
      message: platform.error.message,
      ok: false,
      status: platform.error.code === "unauthorized" ? 401 : 403,
    };
  }
  const elevation = await getPlatformOrganizationContext(
    context.env.CONTROL_DB,
    organizationId,
    session.session.id,
    platform.value.userId,
  );
  if (!elevation.canEdit) {
    return {
      code: "platform_elevation_required",
      message:
        "Enable a current Platform Administrator elevation before exporting this Organization.",
      ok: false,
      status: 403,
    };
  }
  return {
    actorType: "platform_administrator",
    ok: true,
    organizationId,
    userId: platform.value.userId,
  };
}

export const organizationExportJobResponseSchema = z.object({
  actorType: z.enum(["organization_member", "platform_administrator"]),
  actorUserId: z.string().min(1).max(128),
  archiveKey: z.string().nullable(),
  byteCount: z.number().int().nonnegative().nullable(),
  checksumSha256: z.string().nullable(),
  errorCode: z.string().nullable(),
  exportId: z.uuid(),
  format: z.literal("json"),
  requestId: z.uuid(),
  status: z.enum(["queued", "processing", "completed", "failed"]),
});

export async function downloadOrganizationExportFile(
  env: Env,
  organizationId: string,
  exportId: string,
  requestId: string,
): Promise<Response> {
  try {
    const jobUrl = new URL("https://organization.internal/internal/export/job");
    jobUrl.searchParams.set("organizationId", organizationId);
    jobUrl.searchParams.set("exportId", exportId);
    const jobResponse = await invokeOrganizationRpc(
      organizationStoreStub(env, organizationId),
      jobUrl,
    );
    const job = organizationExportJobResponseSchema.safeParse(
      await jobResponse.json().catch(() => null),
    );
    if (
      !jobResponse.ok ||
      !job.success ||
      job.data.status !== "completed" ||
      !job.data.archiveKey
    ) {
      return Response.json(
        {
          code: "export_not_ready",
          message: "The export is not ready to download.",
          requestId,
        } satisfies ProblemDetails,
        { status: job.success && job.data.status === "queued" ? 409 : 404 },
      );
    }
    const expectedKey = organizationExportKey(organizationId, exportId);
    if (job.data.archiveKey !== expectedKey) {
      return Response.json(
        {
          code: "export_scope_conflict",
          message: "The export storage scope was rejected.",
          requestId,
        } satisfies ProblemDetails,
        { status: 409 },
      );
    }
    const object = await env.ORGANIZATION_FILES.get(expectedKey);
    if (
      !object ||
      object.customMetadata?.organizationId !== organizationId ||
      object.customMetadata.exportId !== exportId
    ) {
      return Response.json(
        {
          code: "export_not_found",
          message: "The export file was not found.",
          requestId,
        } satisfies ProblemDetails,
        { status: 404 },
      );
    }
    return new Response(object.body, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="organization-export-${exportId}.json"`,
        "content-length": String(object.size),
        "content-type": "application/json; charset=utf-8",
        "x-export-checksum-sha256": job.data.checksumSha256 ?? "",
      },
    });
  } catch {
    return Response.json(
      {
        code: "service_unavailable",
        message: "The export download is unavailable.",
        requestId,
      } satisfies ProblemDetails,
      { status: 503 },
    );
  }
}

export interface PlatformOrganizationRow extends PlatformOrganizationSummary {
  readonly createdAt: string;
}

export interface PlatformDeadLetterRow {
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

export interface PlatformCountRow {
  readonly count: number;
}

export interface PlatformSchemaStatusRow {
  readonly completedAt: string | null;
  readonly processedCount: number;
  readonly runId: string;
  readonly startedAt: string;
  readonly status: PlatformFleetSchemaPreparation["status"];
  readonly targetVersion: number;
  readonly updatedAt: string;
}

export type PlatformFleetSchemaPreparationRow = PlatformFleetSchemaPreparation;
