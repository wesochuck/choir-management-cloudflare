import { MUSIC_TRACK_IMPORT_MAX_BYTES } from "@choir/domain";
import {
  musicTrackImportAttachRequestSchema,
  musicTrackImportCommitRequestSchema,
  musicTrackImportCreateSessionRequestSchema,
  musicTrackImportMatchRequestSchema,
  musicTrackImportUpdateAssignmentsRequestSchema,
  type MusicTrackImportGroupSuggestion,
  type MusicTrackImportSessionDetail,
  type MusicTrackImportSessionSummary,
  type ProblemDetails,
} from "@choir/contracts";
import { readOrganizationRosterConfiguration } from "../calendar/organizationCalendar";
import type { Hono } from "hono";
import {
  CLEF_TRACK_MATCH_MODEL,
  suggestClefTrackMatches,
  TrackMatchingError,
} from "../music/clefTrackMatching";
import {
  attachOrganizationMusicTracks,
  listOrganizationMusicPieces,
  MusicRepositoryError,
} from "../organization/organizationMusic";
import { organizationStoreStub } from "../organization/rpc/client";
import {
  MusicTrackImportStoreError,
  type MusicTrackImportStoreErrorCode,
  type SessionDetailView,
  type SessionSummaryView,
} from "../organization/music/trackImportStore";
import {
  uploadMusicTrackImportFile,
  TrackImportUploadError,
} from "../organization/music/trackImportUpload";
import type { WorkerHonoEnvironment } from "./helpers";
import { authorizeCalendarRoute } from "./helpers";

function scoreCandidate(
  candidate: (typeof musicTrackImportMatchRequestSchema)["_output"]["candidates"][number],
  normalizedGroupTitle: string,
  groupDuration: number | null | undefined,
): number {
  let score = 0;
  const normalizedCandidateTitle = candidate.title.toLowerCase().trim();
  if (normalizedGroupTitle && normalizedCandidateTitle === normalizedGroupTitle) {
    score += 50;
  } else if (
    normalizedGroupTitle &&
    (normalizedCandidateTitle.includes(normalizedGroupTitle) ||
      normalizedGroupTitle.includes(normalizedCandidateTitle))
  ) {
    score += 30;
  }

  if (
    typeof candidate.durationSeconds === "number" &&
    typeof groupDuration === "number" &&
    Math.abs(candidate.durationSeconds - groupDuration) <= 4
  ) {
    if (score > 0) score += 25;
  }
  return score;
}

function findBestCandidateForGroup(
  group: (typeof musicTrackImportMatchRequestSchema)["_output"]["groups"][number],
  candidates: (typeof musicTrackImportMatchRequestSchema)["_output"]["candidates"],
): MusicTrackImportGroupSuggestion {
  let bestCandidate: (typeof candidates)[number] | null = null;
  let bestScore = 0;
  const normalizedGroupTitle = (group.inferredTitle ?? "").toLowerCase().trim();

  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, normalizedGroupTitle, group.durationSeconds);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  const confidence: "high" | "medium" | "low" | "none" =
    bestScore >= 50 ? "high" : bestScore >= 25 ? "medium" : bestScore > 0 ? "low" : "none";

  const rationale =
    bestScore >= 50
      ? "Exact or strong title match"
      : bestScore >= 25
        ? "Duration and title alignment"
        : bestScore > 0
          ? "Possible title match"
          : "No matching piece found in library";

  return {
    confidence,
    groupId: group.groupId,
    rationale,
    suggestedPieceId: bestCandidate ? bestCandidate.pieceId : null,
  };
}

function buildFallbackSuggestions(
  groups: (typeof musicTrackImportMatchRequestSchema)["_output"]["groups"],
  candidates: (typeof musicTrackImportMatchRequestSchema)["_output"]["candidates"],
): MusicTrackImportGroupSuggestion[] {
  return groups.map((group) => findBestCandidateForGroup(group, candidates));
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.post("/api/organization/music/track-import/attach", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }

    const body = musicTrackImportAttachRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid track attachment assignments are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    try {
      const response = await attachOrganizationMusicTracks(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        body.data,
      );
      return context.json({
        requestId: context.get("requestId"),
        results: response.results,
        summary: response.summary,
      });
    } catch (error: unknown) {
      const status = error instanceof MusicRepositoryError ? error.status : 503;
      return context.json(
        {
          code: error instanceof MusicRepositoryError ? error.code : "service_unavailable",
          message: "The practice tracks could not be attached.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }
  });

  router.post("/api/organization/music/track-import/match", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }

    const body = musicTrackImportMatchRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Valid match candidate data is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    if (body.data.useAi) {
      const ai = context.env.AI;
      if (
        !ai ||
        context.env.APP_ENV === "local" ||
        context.env.EXTERNAL_EFFECTS_MODE === "disabled" ||
        context.env.EXTERNAL_EFFECTS_MODE === "fake"
      ) {
        return context.json(
          {
            code: "service_unavailable",
            message:
              "AI matching is unavailable in this environment. Continue with manual matching.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          503,
        );
      }
      try {
        const startedAt = Date.now();
        let providerCalls = 0;
        let questions = 0;
        let inputBytes = 0;
        const [catalog, roster] = await Promise.all([
          listOrganizationMusicPieces(context.env, authorization.organizationId),
          readOrganizationRosterConfiguration(context.env, authorization.organizationId),
        ]);
        const catalogById = new Map(catalog.map((piece) => [piece.id, piece]));
        if (body.data.candidates.some((candidate) => !catalogById.has(candidate.pieceId))) {
          throw new TrackMatchingError(
            "validation_failed",
            "Choose pieces from this Organization's Music Library.",
          );
        }
        const configuredParts = [
          ...roster.voiceParts.map((part) => ({
            key: part.label,
            kind: "voice_part" as const,
            label: part.fullName,
          })),
          ...roster.sections.map((section) => ({
            key: section.code,
            kind: "section" as const,
            label: section.name,
          })),
        ];
        const activeConfiguredParts =
          body.data.configuredParts && body.data.configuredParts.length > 0
            ? body.data.configuredParts
            : configuredParts;
        const trustedRequest = {
          ...body.data,
          configuredParts: activeConfiguredParts,
          configuredPartKeys: [...new Set(activeConfiguredParts.map((part) => part.key))],
          candidates: body.data.candidates.map((candidate) => {
            const piece = catalogById.get(candidate.pieceId);
            if (!piece) throw new TrackMatchingError("validation_failed", "Unknown piece.");
            return {
              arranger: piece.arranger,
              composer: piece.composer,
              durationSeconds: piece.durationSeconds,
              occupiedPartKeys: Object.keys(piece.trackFileIds),
              pieceId: piece.id,
              title: piece.title,
            };
          }),
        };
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(authorization.organizationId),
        );
        const organizationTag = `org:${Array.from(new Uint8Array(digest).slice(0, 20), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
        const matchResult = await suggestClefTrackMatches(
          trustedRequest,
          (input, signal) => {
            providerCalls += 1;
            questions +=
              typeof input.questions === "object" && input.questions !== null
                ? Object.keys(input.questions).length
                : 0;
            inputBytes += new TextEncoder().encode(JSON.stringify(input)).length;
            return ai.run(CLEF_TRACK_MATCH_MODEL, input, {
              signal,
              tags: ["music-track-import", organizationTag],
            });
          },
          context.req.raw.signal,
        );
        return context.json({
          completedFileIds: matchResult.completedFileIds,
          completedGroupIds: matchResult.completedGroupIds,
          diagnostics: {
            estimatedInputTokens: Math.ceil(inputBytes / 4),
            inputBytes,
            latencyMs: Date.now() - startedAt,
            providerCalls,
            questions,
          },
          failedCount: matchResult.failedCount,
          groupRepairSuggestions: matchResult.groupRepairSuggestions,
          model: CLEF_TRACK_MATCH_MODEL,
          reason: matchResult.reason,
          requestId: context.get("requestId"),
          stage: matchResult.stage,
          stageStatus: matchResult.stageStatus,
          suggestions: matchResult,
          unansweredCount: matchResult.unansweredCount,
        });
      } catch (error: unknown) {
        if (!(error instanceof TrackMatchingError)) throw error;
        return context.json(
          {
            code: error.code,
            message: error.message,
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          error.code === "validation_failed" ? 400 : 503,
        );
      }
    }
    const suggestions = buildFallbackSuggestions(body.data.groups, body.data.candidates);
    return context.json({
      model: "heuristic-v1",
      requestId: context.get("requestId"),
      stage: body.data.stage,
      stageStatus: "complete",
      suggestions,
    });
  });

  router.post("/api/organization/music/track-import/sessions", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const body = musicTrackImportCreateSessionRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid import manifest of up to 100 MP3 rows is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const manifestDigest = await sha256Hex(
        JSON.stringify(
          [...body.data.items]
            .sort((left, right) => left.clientFileId.localeCompare(right.clientFileId))
            .map((item) => [
              item.clientFileId,
              item.fileName,
              item.sizeBytes,
              item.lastModifiedMs,
              item.sha256Hex,
              item.contentType,
              item.pieceId,
              item.partKey,
              item.durationSeconds,
            ]),
        ),
      );
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const created = await stub.createMusicTrackImportSession({
        actorUserId: authorization.userId,
        clientBatchKey: body.data.clientBatchKey,
        items: body.data.items,
        manifestDigest,
        now: new Date().toISOString(),
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      });
      return context.json(
        {
          counts: created.counts,
          expiresAt: created.expiresAt,
          items: created.items,
          manifestRevision: created.manifestRevision,
          requestId: context.get("requestId"),
          sessionId: created.sessionId,
        },
        201,
      );
    } catch (error: unknown) {
      const result = importSessionProblem(error, context.get("requestId"));
      return context.json(result.problem, result.status);
    }
  });

  router.get("/api/organization/music/track-import/sessions", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const active = context.req.query("active");
    if (active !== undefined && active !== "1") {
      return context.json(
        {
          code: "validation_failed",
          message: "Only the active resume view is supported.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const listed = await stub.listMusicTrackImportSessions({
        actorUserId: authorization.userId,
        now: new Date().toISOString(),
        organizationId: authorization.organizationId,
      });
      return context.json({
        requestId: context.get("requestId"),
        sessions: listed.map(toSessionSummary),
      });
    } catch (error: unknown) {
      const result = importSessionProblem(error, context.get("requestId"));
      return context.json(result.problem, result.status);
    }
  });

  router.get("/api/organization/music/track-import/sessions/:sessionId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const sessionId = parseTrackImportUuid(context.req.param("sessionId"));
    if (!sessionId) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid import session is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const detail = await stub.getMusicTrackImportSession({
        actorUserId: authorization.userId,
        now: new Date().toISOString(),
        organizationId: authorization.organizationId,
        sessionId,
      });
      return context.json({
        requestId: context.get("requestId"),
        session: toSessionDetail(detail),
      });
    } catch (error: unknown) {
      const result = importSessionProblem(error, context.get("requestId"));
      return context.json(result.problem, result.status);
    }
  });

  type TrackImportUploadHeaderError = "content_type" | "file_name" | "size" | "too_large";

  type TrackImportUploadHeaders =
    | { readonly error: TrackImportUploadHeaderError }
    | {
        readonly contentType: "audio/mpeg";
        readonly fileName: string;
        readonly sizeBytes: number;
      };

  function parseTrackImportUploadHeaders(
    contentType: string | undefined,
    contentLength: string | undefined,
    fileNameHeader: string | null | undefined,
  ): TrackImportUploadHeaders {
    if ((contentType ?? "").split(";")[0]?.trim().toLowerCase() !== "audio/mpeg") {
      return { error: "content_type" };
    }
    const declaredSize = Number(contentLength ?? "0");
    if (!Number.isInteger(declaredSize) || declaredSize < 1) {
      return { error: "size" };
    }
    if (declaredSize > MUSIC_TRACK_IMPORT_MAX_BYTES) {
      return { error: "too_large" };
    }
    const fileName = decodeImportFileName(fileNameHeader);
    if (!fileName) {
      return { error: "file_name" };
    }
    return { contentType: "audio/mpeg", fileName, sizeBytes: declaredSize };
  }

  function trackImportUploadHeaderProblem(
    error: TrackImportUploadHeaderError,
    requestId: string,
  ): { readonly problem: ProblemDetails; readonly status: 400 | 413 } {
    if (error === "too_large") {
      return {
        problem: {
          code: "file_too_large",
          message: `Practice tracks are capped at ${String(MUSIC_TRACK_IMPORT_MAX_BYTES)} bytes.`,
          requestId,
        },
        status: 413,
      };
    }
    const message =
      error === "content_type"
        ? "Only MP3 uploads are accepted."
        : error === "size"
          ? "A valid content length is required."
          : "A valid encoded file name is required.";
    return { problem: { code: "validation_failed", message, requestId }, status: 400 };
  }

  router.put(
    "/api/organization/music/track-import/sessions/:sessionId/files/:clientFileId",
    async (context) => {
      const authorization = await authorizeCalendarRoute(context, true);
      if (!authorization.ok) {
        return context.json(
          { ...authorization, requestId: context.get("requestId") },
          authorization.status,
        );
      }
      const sessionId = parseTrackImportUuid(context.req.param("sessionId"));
      const clientFileId = context.req.param("clientFileId");
      if (!sessionId || !clientFileId || clientFileId.length > 100) {
        return context.json(
          {
            code: "validation_failed",
            message: "A valid import session and manifest row are required.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }
      const parsedHeaders = parseTrackImportUploadHeaders(
        context.req.header("content-type"),
        context.req.header("content-length"),
        context.req.header("x-file-name"),
      );
      if ("error" in parsedHeaders) {
        const headerProblem = trackImportUploadHeaderProblem(
          parsedHeaders.error,
          context.get("requestId"),
        );
        return context.json(headerProblem.problem, headerProblem.status);
      }
      try {
        const uploaded = await uploadMusicTrackImportFile(context.env, {
          actorUserId: authorization.userId,
          body: context.req.raw.body,
          clientFileId,
          contentType: parsedHeaders.contentType,
          fileName: parsedHeaders.fileName,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
          sessionId,
          sizeBytes: parsedHeaders.sizeBytes,
        });
        return context.json({
          bytesReceived: uploaded.bytesReceived,
          fileId: uploaded.fileId,
          requestId: context.get("requestId"),
          status: uploaded.status,
        });
      } catch (error: unknown) {
        if (error instanceof TrackImportUploadError) {
          if (error.code === "validation") {
            return context.json(
              {
                code: "validation_failed",
                message: error.message,
                requestId: context.get("requestId"),
              } satisfies ProblemDetails,
              400,
            );
          }
          if (error.code === "gone") {
            return context.json(
              {
                code: "upload_in_progress",
                message: error.message,
                requestId: context.get("requestId"),
              } satisfies ProblemDetails,
              409,
            );
          }
          return context.json(
            {
              code: "service_unavailable",
              message: "The practice track could not be stored safely.",
              requestId: context.get("requestId"),
            } satisfies ProblemDetails,
            503,
          );
        }
        const result = importSessionProblem(error, context.get("requestId"));
        if (result.code === "upload_in_progress") {
          context.header("Retry-After", "60");
        }
        return context.json(result.problem, result.status);
      }
    },
  );

  router.patch(
    "/api/organization/music/track-import/sessions/:sessionId/assignments",
    async (context) => {
      const authorization = await authorizeCalendarRoute(context, true);
      if (!authorization.ok) {
        return context.json(
          { ...authorization, requestId: context.get("requestId") },
          authorization.status,
        );
      }
      const sessionId = parseTrackImportUuid(context.req.param("sessionId"));
      if (!sessionId) {
        return context.json(
          {
            code: "validation_failed",
            message: "A valid import session is required.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }
      const body = musicTrackImportUpdateAssignmentsRequestSchema.safeParse(
        await context.req.json<unknown>().catch(() => null),
      );
      if (!body.success) {
        return context.json(
          {
            code: "validation_failed",
            message: "Valid remapped assignments and the reviewed revision are required.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }
      try {
        const stub = organizationStoreStub(context.env, authorization.organizationId);
        const updated = await stub.updateMusicTrackImportAssignments({
          actorUserId: authorization.userId,
          assignments: body.data.assignments,
          expectedRevision: body.data.expectedRevision,
          now: new Date().toISOString(),
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
          sessionId,
        });
        return context.json({
          requestId: context.get("requestId"),
          session: toSessionDetail(updated),
        });
      } catch (error: unknown) {
        const result = importSessionProblem(error, context.get("requestId"));
        return context.json(result.problem, result.status);
      }
    },
  );

  router.post(
    "/api/organization/music/track-import/sessions/:sessionId/commit",
    async (context) => {
      const authorization = await authorizeCalendarRoute(context, true);
      if (!authorization.ok) {
        return context.json(
          { ...authorization, requestId: context.get("requestId") },
          authorization.status,
        );
      }
      const sessionId = parseTrackImportUuid(context.req.param("sessionId"));
      if (!sessionId) {
        return context.json(
          {
            code: "validation_failed",
            message: "A valid import session is required.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }
      const body = musicTrackImportCommitRequestSchema.safeParse(
        await context.req.json<unknown>().catch(() => null),
      );
      if (!body.success) {
        return context.json(
          {
            code: "validation_failed",
            message: "A valid commit key and the reviewed revision are required.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }
      try {
        const stub = organizationStoreStub(context.env, authorization.organizationId);
        const committed = await stub.commitMusicTrackImport({
          actorUserId: authorization.userId,
          commitKey: body.data.commitKey,
          expectedRevision: body.data.expectedRevision,
          now: new Date().toISOString(),
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
          sessionId,
        });
        return context.json({
          committedAt: committed.committedAt,
          commitKey: committed.commitKey,
          manifestRevision: committed.manifestRevision,
          requestId: context.get("requestId"),
          results: committed.results,
          sessionId: committed.sessionId,
          summary: committed.summary,
        });
      } catch (error: unknown) {
        const result = importSessionProblem(error, context.get("requestId"));
        return context.json(result.problem, result.status);
      }
    },
  );

  router.post(
    "/api/organization/music/track-import/sessions/:sessionId/discard",
    async (context) => {
      const authorization = await authorizeCalendarRoute(context, true);
      if (!authorization.ok) {
        return context.json(
          { ...authorization, requestId: context.get("requestId") },
          authorization.status,
        );
      }
      const sessionId = parseTrackImportUuid(context.req.param("sessionId"));
      if (!sessionId) {
        return context.json(
          {
            code: "validation_failed",
            message: "A valid import session is required.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          400,
        );
      }
      try {
        const stub = organizationStoreStub(context.env, authorization.organizationId);
        const discarded = await stub.discardMusicTrackImportSession({
          actorUserId: authorization.userId,
          now: new Date().toISOString(),
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
          sessionId,
        });
        return context.json(
          {
            requestId: context.get("requestId"),
            sessionId: discarded.sessionId,
            state: discarded.state,
            statuses: discarded.statuses,
          },
          202,
        );
      } catch (error: unknown) {
        const result = importSessionProblem(error, context.get("requestId"));
        return context.json(result.problem, result.status);
      }
    },
  );
}

type TrackImportStoreErrorCode = MusicTrackImportStoreErrorCode;

const TRACK_IMPORT_STORE_ERROR_CODES: readonly TrackImportStoreErrorCode[] = [
  "validation_failed",
  "organization_identity_conflict",
  "forbidden",
  "session_not_found",
  "session_expired",
  "session_closed",
  "idempotency_conflict",
  "stale_revision",
  "upload_in_progress",
  "slot_conflict",
];

function matchTrackImportStoreErrorCode(value: string): TrackImportStoreErrorCode | null {
  return isTrackImportStoreErrorCode(value) ? value : null;
}

function isTrackImportStoreErrorCode(value: string): value is TrackImportStoreErrorCode {
  return (TRACK_IMPORT_STORE_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Durable Object RPC does not preserve the store error prototype, so the
 * route-side mapping reads the typed error code instead of `instanceof`.
 * The store error always prefixes its message with `${code}: `, which lets
 * the boundary preserve the code without leaking storage details.
 */
function trackImportStoreErrorCode(error: unknown): TrackImportStoreErrorCode | null {
  if (error instanceof MusicTrackImportStoreError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code: unknown = error.code;
    if (typeof code === "string") {
      const matched = matchTrackImportStoreErrorCode(code);
      if (matched !== null) return matched;
    }
  }
  if (error instanceof Error) {
    const prefix = error.message.split(":", 1)[0]?.trim() ?? "";
    const matched = matchTrackImportStoreErrorCode(prefix);
    if (matched !== null) return matched;
  }
  return null;
}

function importSessionProblem(
  error: unknown,
  requestId: string,
): {
  readonly code: string;
  readonly problem: ProblemDetails;
  readonly status: 400 | 403 | 404 | 409 | 503;
} {
  const code = trackImportStoreErrorCode(error);
  switch (code) {
    case "validation_failed":
      return {
        code,
        problem: {
          code,
          message: "The import session request was invalid.",
          requestId,
        },
        status: 400,
      };
    case "session_not_found":
      return {
        code,
        problem: { code, message: "The import session was not found.", requestId },
        status: 404,
      };
    case "forbidden":
      return {
        code,
        problem: {
          code,
          message: "Only the session owner may change this import.",
          requestId,
        },
        status: 403,
      };
    case "idempotency_conflict":
      return {
        code,
        problem: {
          code,
          message: "This import was already recorded with different content.",
          requestId,
        },
        status: 409,
      };
    case "stale_revision":
      return {
        code,
        problem: {
          code,
          message: "Assignments changed since this revision was reviewed. Refresh and retry.",
          requestId,
        },
        status: 409,
      };
    case "upload_in_progress":
      return {
        code,
        problem: {
          code,
          message: "An upload attempt is already in progress for this file.",
          requestId,
        },
        status: 409,
      };
    case "slot_conflict":
      return {
        code,
        problem: {
          code,
          message: "The destination slot is occupied by another track.",
          requestId,
        },
        status: 409,
      };
    case "session_expired":
      return {
        code,
        problem: {
          code,
          message: "The import session has expired. Start a new import.",
          requestId,
        },
        status: 409,
      };
    case "session_closed":
      return {
        code,
        problem: {
          code,
          message: "The import session is no longer active.",
          requestId,
        },
        status: 409,
      };
    case "organization_identity_conflict":
      return {
        code,
        problem: {
          code,
          message: "The import session belongs to a different Organization.",
          requestId,
        },
        status: 409,
      };
    default:
      return {
        code: "service_unavailable",
        problem: {
          code: "service_unavailable",
          message: "The practice track import is temporarily unavailable.",
          requestId,
        },
        status: 503,
      };
  }
}

function parseTrackImportUuid(value: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function decodeImportFileName(header: string | null | undefined): string | null {
  if (!header) return null;
  try {
    const decoded = decodeURIComponent(header);
    if (decoded.length === 0 || decoded.length > 500) return null;
    return decoded;
  } catch {
    return null;
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toSessionSummary(summary: SessionSummaryView): MusicTrackImportSessionSummary {
  return {
    absoluteExpiresAt: summary.absoluteExpiresAt,
    clientBatchKey: summary.clientBatchKey,
    closedAt: summary.closedAt,
    counts: { ...summary.counts },
    expiresAt: summary.expiresAt,
    lastFailureCode: summary.lastFailureCode,
    manifestRevision: summary.manifestRevision,
    sessionId: summary.sessionId,
    state: summary.state,
  };
}

function toSessionDetail(detail: SessionDetailView): MusicTrackImportSessionDetail {
  return {
    ...toSessionSummary(detail),
    items: detail.items.map((item) => ({
      attempts: item.attempts.map((attempt) => ({
        attemptNumber: attempt.attemptNumber,
        fileId: attempt.fileId,
        leaseExpiresAt: attempt.leaseExpiresAt,
        status: parseAttemptStatus(attempt.status),
      })),
      clientFileId: item.clientFileId,
      contentType: item.contentType,
      currentFileId: item.currentFileId,
      durationSeconds: item.durationSeconds,
      errorCode: item.errorCode,
      fileName: item.fileName,
      partKey: item.partKey,
      pieceId: item.pieceId,
      sha256Hex: item.sha256Hex,
      sizeBytes: item.sizeBytes,
      status: item.status,
    })),
  };
}

function parseAttemptStatus(
  status: string,
): MusicTrackImportSessionDetail["items"][number]["attempts"][number]["status"] {
  switch (status) {
    case "reserved":
    case "uploading":
    case "ready":
    case "failed":
    case "cleanup_pending":
    case "reclaimed":
      return status;
    default:
      throw new MusicTrackImportStoreError("validation_failed", "Unknown upload attempt status.");
  }
}
