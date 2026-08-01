import {
  communicationAudienceRequestSchema,
  communicationDraftRequestSchema,
  communicationSendRequestSchema,
  communicationTestEmailRequestSchema,
  communicationTemplateRequestSchema,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";
import { deliverOrganizationCommunication } from "../communications/provider";
import {
  listOrganizationCommunications,
  listOrganizationScheduledMessages,
  listCommunicationTemplates,
  previewCommunicationReach,
  readCommunicationDeliverySummary,
  retryCommunicationDeliveries,
  deleteCommunicationDraft,
  deleteCommunicationTemplate,
  saveCommunicationTemplate,
  updateCommunicationTemplate,
  saveCommunicationDraft,
  sendOrganizationCommunication,
} from "../organization/organizationCommunications";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute, communicationProblem } from "./helpers";

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
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

  router.get("/api/organization/communications/scheduled", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok)
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    try {
      return context.json({
        messages: await listOrganizationScheduledMessages(
          context.env,
          authorization.organizationId,
        ),
        requestId: context.get("requestId"),
      });
    } catch (error: unknown) {
      const result = communicationProblem(
        error,
        context.get("requestId"),
        "Scheduled communications are temporarily unavailable.",
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

  router.put("/api/organization/communications/templates/:templateId", async (context) => {
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
      const template = await updateCommunicationTemplate(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        templateId.data,
        body.data,
      );
      return context.json({ ...template, requestId: context.get("requestId") });
    } catch (error: unknown) {
      const result = communicationProblem(
        error,
        context.get("requestId"),
        "The communication template could not be updated.",
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

  router.post("/api/organization/communications/test-email", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok)
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    const body = communicationTestEmailRequestSchema.safeParse(
      await context.req.json<unknown>().catch(() => null),
    );
    if (!body.success)
      return context.json(
        {
          code: "validation_failed",
          message: "A valid recipient email, subject, and message are required.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    try {
      const delivery = await deliverOrganizationCommunication(context.env, {
        channel: "email",
        contentMarkdown: body.data.contentMarkdown,
        deliveryId: crypto.randomUUID(),
        destination: body.data.email,
        messageId: crypto.randomUUID(),
        recipientName: "Test recipient",
        subject: `[Test] ${body.data.subject}`,
        unsubscribeUrl: null,
      });
      if (delivery.status === "suppressed") {
        throw new Error("Organization email delivery is disabled.");
      }
      if (delivery.status === "failed") {
        throw new Error(
          delivery.failureDetail || "The Organization email provider rejected the test.",
        );
      }
      return context.json({ requestId: context.get("requestId"), sent: true as const }, 202);
    } catch (error: unknown) {
      const result = communicationProblem(
        error,
        context.get("requestId"),
        "The test email could not be sent. Check the email delivery setup and try again.",
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
}
