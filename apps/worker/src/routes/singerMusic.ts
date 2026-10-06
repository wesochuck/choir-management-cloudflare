import type {
  OrganizationEvent,
  OrganizationMusicPiece,
  OrganizationRosterConfiguration,
  ProblemDetails,
} from "@choir/contracts";
import { singerLearningTrackPieceSchema } from "@choir/contracts";
import {
  digitalScoreFileName,
  resolveMemberScoreFile,
  SCORE_BUNDLE_MAX_BYTES,
} from "@choir/domain";
import { z } from "zod";
import {
  listOrganizationEvents,
  readOrganizationRosterConfiguration,
} from "../calendar/organizationCalendar";
import { listOrganizationMusicPieces } from "../organization/organizationMusic";
import { readOrganizationStore } from "../organization/rpc/repository";
import { createZipArchive } from "../organization/zipArchive";
import {
  readPrivateOrganizationFile,
  readPrivateOrganizationFileMetadata,
} from "../storage/privateFiles";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute, resolveEffectiveMemberProfileId } from "./helpers";

const memberProfileSchema = z.object({
  displayName: z.string().min(1).max(200),
  id: z.uuid(),
  voicePart: z.string().max(100),
});

async function resolveVoicePartForProfile(
  env: WorkerHonoEnvironment["Bindings"],
  organizationId: string,
  profileId: string | null,
): Promise<string | null> {
  if (!profileId) return null;
  try {
    const profileResponse = await readOrganizationStore(
      env,
      organizationId,
      "/internal/profiles/member",
      { profileId },
    );
    if (!profileResponse.ok) return null;
    const parsed = memberProfileSchema.safeParse(await profileResponse.json());
    if (parsed.success && parsed.data.voicePart.trim()) {
      return parsed.data.voicePart.trim();
    }
  } catch {
    // Fall back to no voice part filter
  }
  return null;
}

function resolveEffectiveSetList(
  targetEvent: OrganizationEvent,
  events: readonly OrganizationEvent[],
): {
  readonly effectiveApproved: boolean;
  readonly effectiveSetList: OrganizationEvent["setList"];
} {
  let effectiveSetList = targetEvent.setList;
  let effectiveApproved = targetEvent.setListApproved;
  if (targetEvent.type === "Rehearsal" && !effectiveApproved && targetEvent.parentPerformanceId) {
    const parentEvent = events.find((e) => e.id === targetEvent.parentPerformanceId);
    if (parentEvent?.setListApproved && !parentEvent.isCanceled) {
      effectiveSetList = parentEvent.setList;
      effectiveApproved = true;
    }
  }
  return { effectiveApproved, effectiveSetList };
}

async function collectZipFilesForSetList(
  env: WorkerHonoEnvironment["Bindings"],
  organizationId: string,
  setList: OrganizationEvent["setList"],
  pieces: readonly OrganizationMusicPiece[],
  memberVoicePart: string | null,
  rosterConfig: OrganizationRosterConfiguration,
): Promise<
  | { readonly files: { data: Uint8Array; fileName: string }[]; readonly status: "ready" }
  | { readonly status: "too_large"; readonly totalBytes: number }
> {
  const piecesMap = new Map(pieces.map((p) => [p.id, p]));
  const resolved: { fileId: string; fileName: string }[] = [];
  const seenFileIds = new Set<string>();

  for (const setItem of setList) {
    if (!setItem.pieceId) continue;
    const piece = piecesMap.get(setItem.pieceId);
    if (!piece) continue;

    const parentPiece = piece.parentId ? (piecesMap.get(piece.parentId) ?? null) : null;
    const resolvedScore = resolveMemberScoreFile(piece, memberVoicePart, parentPiece);
    if (!resolvedScore) continue;

    if (seenFileIds.has(resolvedScore.fileId)) continue;
    seenFileIds.add(resolvedScore.fileId);

    resolved.push({
      fileId: resolvedScore.fileId,
      fileName: digitalScoreFileName(
        piece.title,
        parentPiece?.title,
        resolvedScore.key,
        rosterConfig,
      ),
    });
  }

  let totalBytes = 0;
  const presentFileIds = new Set<string>();
  for (const item of resolved) {
    const metadata = await readPrivateOrganizationFileMetadata(env, organizationId, item.fileId);
    if (!metadata) continue;
    presentFileIds.add(item.fileId);
    totalBytes += metadata.sizeBytes;
  }
  if (totalBytes > SCORE_BUNDLE_MAX_BYTES) {
    return { status: "too_large", totalBytes };
  }

  const filesToZip: { data: Uint8Array; fileName: string }[] = [];
  for (const item of resolved) {
    if (!presentFileIds.has(item.fileId)) continue;
    const fileRecord = await readPrivateOrganizationFile(env, organizationId, item.fileId);
    if (!fileRecord) continue;
    const buffer = await fileRecord.object.arrayBuffer();
    filesToZip.push({
      data: new Uint8Array(buffer),
      fileName: item.fileName,
    });
  }
  return { files: filesToZip, status: "ready" };
}

function memberCanAccessPiece(
  piece: OrganizationMusicPiece,
  events: readonly OrganizationEvent[],
): boolean {
  const isPieceInSetList = (setList: readonly { readonly pieceId?: string | undefined }[]) =>
    setList.some(
      (item) =>
        item.pieceId !== undefined &&
        (item.pieceId === piece.id || (piece.parentId !== null && item.pieceId === piece.parentId)),
    );

  return events.some((event) => {
    if (event.isCanceled) return false;
    const { effectiveApproved, effectiveSetList } = resolveEffectiveSetList(event, events);
    if (!effectiveApproved) return false;
    return isPieceInSetList(effectiveSetList);
  });
}

function resolveScoreKeyAndFile(
  piece: OrganizationMusicPiece,
  parentPiece: OrganizationMusicPiece | null,
  memberVoicePart: string | null,
  requestedKey?: string,
): { fileId: string; key: string } | null {
  if (requestedKey && piece.scoreFileIds[requestedKey]) {
    return { fileId: piece.scoreFileIds[requestedKey], key: requestedKey };
  }
  return resolveMemberScoreFile(piece, memberVoicePart, parentPiece);
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
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

  router.get("/api/singer/events/:eventId/scores/bundle", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const eventIdParam = z.uuid().safeParse(context.req.param("eventId"));
    if (!eventIdParam.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid event ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const eventId = eventIdParam.data;
    const { profileId } = await resolveEffectiveMemberProfileId(context, authorization);

    try {
      const [events, pieces, rosterConfig] = await Promise.all([
        listOrganizationEvents(context.env, authorization.organizationId),
        listOrganizationMusicPieces(context.env, authorization.organizationId),
        readOrganizationRosterConfiguration(context.env, authorization.organizationId),
      ]);

      const targetEvent = events.find((e) => e.id === eventId);
      if (!targetEvent || targetEvent.isCanceled) {
        return context.json(
          {
            code: "not_found",
            message: "The requested event was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }

      const { effectiveApproved, effectiveSetList } = resolveEffectiveSetList(targetEvent, events);
      if (!effectiveApproved && authorization.role === "member") {
        return context.json(
          {
            code: "forbidden",
            message: "Digital scores are not published until the set list is approved.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          403,
        );
      }

      const memberVoicePart = await resolveVoicePartForProfile(
        context.env,
        authorization.organizationId,
        profileId,
      );

      const collected = await collectZipFilesForSetList(
        context.env,
        authorization.organizationId,
        effectiveSetList,
        pieces,
        memberVoicePart,
        rosterConfig,
      );

      if (collected.status === "too_large") {
        const totalMiB = (collected.totalBytes / (1024 * 1024)).toFixed(1);
        const limitMiB = (SCORE_BUNDLE_MAX_BYTES / (1024 * 1024)).toFixed(0);
        return context.json(
          {
            code: "score_bundle_too_large",
            message: `This score bundle totals ${totalMiB} MB, which exceeds the ${limitMiB} MB download limit. Download individual scores instead.`,
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          413,
        );
      }

      if (collected.files.length === 0) {
        return context.json(
          {
            code: "not_found",
            message: "No digital scores are available for this event.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }

      const zipBuffer = createZipArchive(collected.files);
      const safeEventTitle = targetEvent.title.replace(/[\\/:*?"<>|]/g, "_").trim() || "event";

      return new Response(zipBuffer, {
        headers: {
          "content-disposition": `attachment; filename="${encodeURIComponent(safeEventTitle)}-scores.zip"`,
          "content-length": String(zipBuffer.byteLength),
          "content-type": "application/zip",
        },
      });
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The score bundle could not be generated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });

  router.get("/api/singer/pieces/:pieceId/score", async (context) => {
    const authorization = await authorizeCalendarRoute(context, false);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const pieceIdParam = z.uuid().safeParse(context.req.param("pieceId"));
    if (!pieceIdParam.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid piece ID is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const pieceId = pieceIdParam.data;
    const { profileId } = await resolveEffectiveMemberProfileId(context, authorization);

    try {
      const [events, pieces, rosterConfig] = await Promise.all([
        listOrganizationEvents(context.env, authorization.organizationId),
        listOrganizationMusicPieces(context.env, authorization.organizationId),
        readOrganizationRosterConfiguration(context.env, authorization.organizationId),
      ]);

      const piece = pieces.find((p) => p.id === pieceId);
      if (!piece) {
        return context.json(
          {
            code: "not_found",
            message: "The requested piece was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }

      if (authorization.role === "member" && !memberCanAccessPiece(piece, events)) {
        return context.json(
          {
            code: "forbidden",
            message: "Digital scores are only accessible for pieces on approved set lists.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          403,
        );
      }

      const memberVoicePart = await resolveVoicePartForProfile(
        context.env,
        authorization.organizationId,
        profileId,
      );

      const parentPiece = piece.parentId
        ? (pieces.find((p) => p.id === piece.parentId) ?? null)
        : null;
      const requestedKey = context.req.query("key");
      const resolved = resolveScoreKeyAndFile(piece, parentPiece, memberVoicePart, requestedKey);

      if (!resolved) {
        return context.json(
          {
            code: "not_found",
            message: "No digital score is available for this piece.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }

      const fileRecord = await readPrivateOrganizationFile(
        context.env,
        authorization.organizationId,
        resolved.fileId,
      );

      if (!fileRecord) {
        return context.json(
          {
            code: "not_found",
            message: "The requested score file was not found.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          404,
        );
      }

      const fileName = digitalScoreFileName(
        piece.title,
        parentPiece?.title,
        resolved.key,
        rosterConfig,
      );

      const isDownload = context.req.query("download") === "1";
      const disposition = isDownload ? "attachment" : "inline";

      context.header("content-type", "application/pdf");
      context.header(
        "content-disposition",
        `${disposition}; filename="${encodeURIComponent(fileName)}"`,
      );
      if (typeof fileRecord.object.size === "number") {
        context.header("content-length", String(fileRecord.object.size));
      }
      return context.body(fileRecord.object.body);
    } catch {
      return context.json(
        {
          code: "service_unavailable",
          message: "The digital score could not be retrieved.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        503,
      );
    }
  });
}
