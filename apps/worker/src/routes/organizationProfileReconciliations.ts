import {
  profileReconciliationExecuteRequestSchema,
  profileReconciliationPreviewRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import type { Hono } from "hono";

import {
  executeProfileReconciliation,
  getProfileReconciliationStatus,
} from "../control/profileReconciliationService";
import { organizationStoreStub } from "../organization/rpc/client";
import { authorizeCalendarRoute, type WorkerHonoEnvironment } from "./helpers";

interface MemberWithUserRow {
  readonly email: string;
  readonly id: string;
  readonly name: string;
  readonly profileId: string | null;
  readonly role: string;
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  // 1. Preview
  router.post("/api/organization/profile-reconciliations/preview", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }

    const body: unknown = await context.req.json().catch(() => null);
    const parsed = profileReconciliationPreviewRequestSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "A valid membership ID and target profile ID are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const member = await context.env.CONTROL_DB.prepare(
      `SELECT m.id, m.profileId, m.role, u.email, u.name
       FROM member m
       JOIN user u ON u.id = m.userId
       WHERE m.id = ? AND m.organizationId = ? LIMIT 1`,
    )
      .bind(parsed.data.membershipId, authorization.organizationId)
      .first<MemberWithUserRow>();

    if (!member) {
      return context.json(
        {
          code: "not_found",
          message: "The Organization Membership was not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    if (!member.profileId) {
      return context.json(
        {
          code: "validation_failed",
          message: "The Membership does not have a linked Profile to reconcile.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const targetMember = await context.env.CONTROL_DB.prepare(
      `SELECT id FROM member
       WHERE profileId = ? AND organizationId = ? AND id <> ? LIMIT 1`,
    )
      .bind(parsed.data.targetProfileId, authorization.organizationId, member.id)
      .first<{ id: string }>();

    const stub = organizationStoreStub(context.env, authorization.organizationId);
    const previewResult = await stub.previewProfileReconciliation({
      membershipEmail: member.email,
      membershipId: member.id,
      memberName: member.name,
      memberRole: member.role,
      organizationId: authorization.organizationId,
      requestId: context.get("requestId"),
      sourceProfileId: member.profileId,
      targetProfileId: parsed.data.targetProfileId,
    });

    if (!previewResult.ok || !previewResult.preview) {
      const code = previewResult.error?.code ?? "preview_failed";
      return context.json(
        {
          code,
          message: previewResult.error?.message ?? "Preview could not be generated.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        code === "not_found" || code === "source_not_found" || code === "target_not_found"
          ? 404
          : 400,
      );
    }

    const preview = previewResult.preview;
    if (targetMember) {
      return context.json({
        ...preview,
        canReconcile: false,
        conflictInventory: {
          ...preview.conflictInventory,
          blockers: [
            ...preview.conflictInventory.blockers,
            "Target profile is already linked to another active Membership.",
          ],
        },
        status: "blocked",
      });
    }

    return context.json(preview);
  });

  // 2. Execute reconciliation
  router.post("/api/organization/profile-reconciliations", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }

    const body: unknown = await context.req.json().catch(() => null);
    const parsed = profileReconciliationExecuteRequestSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          code: "validation_failed",
          message: "Invalid reconciliation request payload.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const result = await executeProfileReconciliation(context.env, {
      ...parsed.data,
      actorUserId: authorization.userId,
      organizationId: authorization.organizationId,
      requestId: context.get("requestId"),
    });

    if (!result.ok) {
      const status =
        result.error.code === "conflict" ? 409 : result.error.code === "not_found" ? 404 : 400;
      return context.json(
        {
          code: result.error.code,
          message: result.error.message,
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        status,
      );
    }

    return context.json(result.value);
  });

  // 3. Candidate suggestions
  router.get("/api/organization/profile-reconciliations/candidates", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }

    const membershipId = context.req.query("membershipId");
    if (!membershipId) {
      return context.json(
        {
          code: "validation_failed",
          message: "membershipId query parameter is required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }

    const member = await context.env.CONTROL_DB.prepare(
      `SELECT profileId FROM member
       WHERE id = ? AND organizationId = ? LIMIT 1`,
    )
      .bind(membershipId, authorization.organizationId)
      .first<{ profileId: string | null }>();

    if (!member?.profileId) {
      return context.json({
        candidates: [],
        requestId: context.get("requestId"),
      });
    }

    const rawQuery = context.req.query("q");
    const query = rawQuery ? rawQuery.trim().slice(0, 100) : undefined;
    const stub = organizationStoreStub(context.env, authorization.organizationId);
    const candidates = await stub.findReconciliationCandidates({
      query,
      sourceProfileId: member.profileId,
    });

    return context.json({
      candidates,
      requestId: context.get("requestId"),
    });
  });

  // 4. Status read
  router.get("/api/organization/profile-reconciliations/:id", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }

    const id = context.req.param("id");
    const record = await getProfileReconciliationStatus(context.env.CONTROL_DB, {
      id,
      organizationId: authorization.organizationId,
    });

    if (!record) {
      return context.json(
        {
          code: "not_found",
          message: "Profile reconciliation record not found.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        404,
      );
    }

    const publicStatus =
      record.state === "completed"
        ? "completed"
        : record.state === "failed"
          ? "failed"
          : "pending_repair";

    return context.json({
      actorUserId: record.actor_user_id,
      createdAt: new Date(record.created_at).toISOString(),
      id: record.id,
      membershipId: record.membership_id,
      previewRevision: record.preview_revision,
      requestId: context.get("requestId"),
      sourceProfileId: record.source_profile_id,
      state: record.state,
      status: publicStatus,
      targetProfileId: record.target_profile_id,
      updatedAt: new Date(record.updated_at).toISOString(),
    });
  });
}
