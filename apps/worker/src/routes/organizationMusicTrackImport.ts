import {
  musicTrackImportAttachRequestSchema,
  musicTrackImportMatchRequestSchema,
  type MusicTrackImportGroupSuggestion,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";
import {
  CLEF_TRACK_MATCH_MODEL,
  suggestClefTrackMatches,
  TrackMatchingError,
} from "../music/clefTrackMatching";
import {
  attachOrganizationMusicTracks,
  MusicRepositoryError,
} from "../organization/organizationMusic";
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
    score += 25;
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
              "Clef Flash is unavailable in this environment. Continue with manual matching.",
            requestId: context.get("requestId"),
          } satisfies ProblemDetails,
          503,
        );
      }
      try {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(authorization.organizationId),
        );
        const organizationTag = `org:${Array.from(new Uint8Array(digest).slice(0, 20), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
        const suggestions = await suggestClefTrackMatches(body.data, (input, signal) =>
          ai.run(CLEF_TRACK_MATCH_MODEL, input, {
            signal,
            tags: ["music-track-import", organizationTag],
          }),
        );
        return context.json({
          model: CLEF_TRACK_MATCH_MODEL,
          requestId: context.get("requestId"),
          suggestions,
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
      suggestions,
    });
  });
}
