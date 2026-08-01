import type { publicAuditionInquiryRequestSchema } from "@choir/contracts";
import {
  ticketBundleRequestSchema,
  organizationAuditionSettingsSchema,
  type OrganizationInvitationSummary,
  type ProblemDetails,
} from "@choir/contracts";
import { type Context } from "hono";
import { z } from "zod";
import type { createAuth } from "../../auth/config";
import { isCanonicalAuthHost, isProductBaseHost } from "../../auth/config";
import type { Env } from "../../env";
import { ResourceRepositoryError } from "../../organization/organizationResources";
import { setOrganizationProfilePhoto } from "../../organization/profiles";
import type { readPrivateOrganizationFile } from "../../storage/privateFiles";
import {
  MAX_PRIVATE_FILE_BYTES,
  privateFileContentTypeSchema,
  privateFileIdSchema,
  privateFileNameSchema,
  reclaimPrivateOrganizationFile,
} from "../../storage/privateFiles";
import { linkedOrganizationProfileId } from "../../tenancy/linkedOrganizationProfile";
import { resolveOrganization } from "../../tenancy/resolveOrganization";
import { PublicWebsiteError } from "../../organization/organizationPublicWebsite";
import {
  saveOrganizationTicketBundle,
  TicketingError,
} from "../../organization/organizationTicketing";
import { SeasonError } from "../../organization/organizationSeasons";

import {
  platformOrganizationCursorSchema,
  platformDeadLetterCursorSchema,
  authorizeCalendarRoute,
} from "./routeContracts";

import type {
  WorkerHonoEnvironment,
  CalendarAuthorization,
  PlatformOrganizationRow,
  PlatformDeadLetterRow,
} from "./routeContracts";

export interface InvitationControlRow {
  readonly createdAt: number | string;
  readonly email: string;
  readonly expiresAt: number | string;
  readonly id: string;
  readonly inviterId: string;
  readonly organizationId: string;
  readonly role: string | null;
  readonly status: string;
}

export interface AccountSessionRow {
  readonly activeOrganizationId: string | null;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly id: string;
  readonly ipAddress: string | null;
  readonly token: string;
  readonly updatedAt: number;
  readonly userAgent: string | null;
  readonly userId: string;
}

export function normalizeInvitationRole(
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

export function invitationDate(value: number | string): string {
  return new Date(value).toISOString();
}

export function decodePrivateFileName(value: string | undefined): string | null {
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

export function parsePrivateFileUploadHeaders(headers: Headers): {
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

export async function findInvitationForOrganization(
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

export async function recordInvitationAudit(
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

export function parsePlatformOrganizationCursor(
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

export function encodePlatformOrganizationCursor(row: PlatformOrganizationRow): string {
  return `${row.createdAt}|${row.organizationId}`;
}

export function parsePlatformDeadLetterCursor(
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

export function encodePlatformDeadLetterCursor(row: PlatformDeadLetterRow): string {
  return `${row.lastSeenAt}|${row.id}`;
}

export async function ensurePendingInvitationIdentity(
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

export async function isAuthorizedPlatformHostname(requestUrl: URL, env: Env): Promise<boolean> {
  if (isProductBaseHost(requestUrl.hostname, env.PRODUCT_BASE_DOMAIN)) {
    return true;
  }
  if (!isCanonicalAuthHost(requestUrl.hostname, env.PRODUCT_BASE_DOMAIN)) {
    return false;
  }
  const resolvedOrganization = await resolveOrganization(requestUrl, env);
  return resolvedOrganization.ok && resolvedOrganization.value.routeKind === "canonical";
}

export async function resolveCanonicalOrganizationId(
  requestUrl: URL,
  env: Env,
): Promise<string | null> {
  if (!isCanonicalAuthHost(requestUrl.hostname, env.PRODUCT_BASE_DOMAIN)) {
    return null;
  }
  const resolvedOrganization = await resolveOrganization(requestUrl, env);
  return resolvedOrganization.ok && resolvedOrganization.value.routeKind === "canonical"
    ? resolvedOrganization.value.organizationId
    : null;
}

export async function verifySecondFactor(
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

export function publicAuditionInquiryProblem(
  settings: z.infer<typeof organizationAuditionSettingsSchema>,
  requestedSlots: readonly string[],
  requestIdValue: string,
): { readonly problem: ProblemDetails; readonly status: 400 | 409 } | null {
  if (!settings.enabled) {
    return {
      problem: {
        code: "auditions_closed",
        message: "Audition requests are not currently being accepted.",
        requestId: requestIdValue,
      },
      status: 409,
    };
  }
  const allowedSlots = new Set(settings.slots.map(({ startsAt }) => startsAt));
  if (requestedSlots.some((slot) => !allowedSlots.has(slot))) {
    return {
      problem: {
        code: "invalid_audition_slot",
        message: "Choose only from the available audition time slots.",
        requestId: requestIdValue,
      },
      status: 400,
    };
  }
  return null;
}

export function createdAuditionId(value: unknown): string {
  if (typeof value === "object" && value !== null && "id" in value) return String(value.id);
  return "";
}

export async function submitPublicAuditionInquiry(
  env: Env,
  organizationId: string,
  body: z.infer<typeof publicAuditionInquiryRequestSchema>,
  requestIdValue: string,
): Promise<Response> {
  try {
    const stub = env.ORGANIZATION_STORE.get(env.ORGANIZATION_STORE.idFromName(organizationId));
    const settingsUrl = new URL("https://organization.internal/internal/audition/settings");
    settingsUrl.searchParams.set("organizationId", organizationId);
    const settingsResponse = await stub.fetch(settingsUrl);
    const settings = organizationAuditionSettingsSchema.safeParse(await settingsResponse.json());
    if (!settingsResponse.ok || !settings.success) throw new Error("settings_unavailable");
    const settingsProblem = publicAuditionInquiryProblem(
      settings.data,
      body.requestedSlots,
      requestIdValue,
    );
    if (settingsProblem)
      return Response.json(settingsProblem.problem, { status: settingsProblem.status });
    const response = await stub.fetch("https://organization.internal/internal/audition/create", {
      body: JSON.stringify({
        availabilityNotes: body.availabilityNotes ?? "",
        email: body.email,
        experience: body.experience ?? "",
        name: body.name,
        performanceId: settings.data.defaultPerformanceId,
        phone: body.phone ?? "",
        requestedSlots: body.requestedSlots,
        voicePart: body.voicePart ?? "",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      return Response.json(
        {
          code: response.status === 400 ? "validation_failed" : "audition_create_failed",
          message:
            response.status === 400
              ? "Choose only configured audition times."
              : "Your inquiry could not be submitted. Please try again later.",
          requestId: requestIdValue,
        } satisfies ProblemDetails,
        { status: response.status === 400 ? 400 : 503 },
      );
    }
    const created: unknown = await response.json();
    const createdId = createdAuditionId(created);
    return Response.json(
      { id: createdId, message: "Your audition inquiry has been received." },
      { status: 201 },
    );
  } catch {
    return Response.json(
      {
        code: "service_unavailable",
        message: "Your inquiry could not be submitted. Please try again later.",
        requestId: requestIdValue,
      } satisfies ProblemDetails,
      { status: 503 },
    );
  }
}

export type PrivateFileReadResult = NonNullable<
  Awaited<ReturnType<typeof readPrivateOrganizationFile>>
>;

export function privateFileDownloadResponse(file: PrivateFileReadResult): Response {
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

export async function profilePhotoTargetAllowed(
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

export async function updateProfilePhotoRoute(
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

export function resourceProblem(error: unknown, requestIdValue: string, message: string) {
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

export function publicWebsiteProblem(error: unknown, requestIdValue: string, message: string) {
  return {
    problem: {
      code: error instanceof PublicWebsiteError ? "public_website_error" : "service_unavailable",
      message: error instanceof PublicWebsiteError ? error.message : message,
      requestId: requestIdValue,
    } satisfies ProblemDetails,
    status: error instanceof PublicWebsiteError ? error.status : 503,
  };
}

export async function saveTicketBundleRoute(
  context: Context<WorkerHonoEnvironment>,
  bundleId: string,
) {
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

export function seasonMutationFailure(
  error: unknown,
  requestIdValue: string,
  fallback: string,
): { readonly problem: ProblemDetails; readonly status: 400 | 404 | 409 | 503 } {
  const status =
    error instanceof SeasonError &&
    (error.status === 400 || error.status === 404 || error.status === 409)
      ? error.status
      : 503;
  return {
    problem: {
      code: error instanceof SeasonError ? error.code : "season_unavailable",
      message: error instanceof SeasonError ? error.message : fallback,
      requestId: requestIdValue,
    },
    status,
  };
}
