import {
  communicationAudienceRequestSchema,
  communicationDraftRequestSchema,
  communicationSendRequestSchema,
  communicationTestEmailRequestSchema,
  communicationTemplateRequestSchema,
  type CommunicationTestEmailRequest,
  type OrganizationEvent,
  type ProblemDetails,
} from "@choir/contracts";
import {
  renderCommunicationTemplate,
  renderOrganizationLogoPlaceholder,
  validateCommunicationContext,
} from "@choir/domain";
import { z } from "zod";
import { assertEmailProviderRecipientAvailable } from "../communications/emailFeedback";
import { deliverOrganizationCommunication } from "../communications/provider";
import {
  readOrganizationBrandingConfig,
  readOrganizationEmailSenderConfig,
} from "../jobs/deliveries/shared";
import { listOrganizationEvents } from "../calendar/organizationCalendar";
import {
  CommunicationRepositoryError,
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
  cancelOrganizationCommunication,
} from "../organization/organizationCommunications";

import type { Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute, communicationProblem } from "./helpers";

const communicationIdempotencyKeySchema = z.string().trim().min(1).max(256);

interface TestEmailTemplateOptions {
  readonly baseDomain: string;
  readonly branding: { readonly logoFileId: string | null; readonly organizationName: string };
  readonly contentMarkdown: string;
  readonly event: OrganizationEvent | null;
  readonly fromName: string | null;
  readonly subject: string;
}

function renderTestEmailPayload(options: TestEmailTemplateOptions): {
  fromName: string | undefined;
  templatedContent: string;
  templatedSubject: string;
} {
  const testRecipientName = "Test recipient";
  const trimmedOrgName = options.branding.organizationName.trim();
  const orgName =
    trimmedOrgName.length > 0 ? trimmedOrgName : (options.fromName ?? "Choir Management");
  const logoUrl = options.branding.logoFileId
    ? `https://${options.baseDomain || "localhost"}/api/public/logo`
    : null;
  const logoPlaceholder = renderOrganizationLogoPlaceholder({
    channel: "email",
    logoUrl,
    organizationName: orgName,
  });

  const eventContext = options.event
    ? {
        eventCallTime: options.event.callTime,
        eventDate: new Intl.DateTimeFormat("en-US", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: "UTC",
        }).format(new Date(options.event.startsAt)),
        eventDetails: options.event.details,
        eventId: options.event.id,
        eventLocation: options.event.location,
        eventTitle: options.event.title,
        eventType: options.event.type,
      }
    : {};

  const testRsvpLink = `[Open RSVP page](https://${options.baseDomain || "localhost"}/rsvp?sample=1)\n\n(No login required.)`;
  const testPlayerLink = `[Open practice player](https://${options.baseDomain || "localhost"}/player?sample=1)\n\n(No login required.)`;

  const preparedContent = options.contentMarkdown
    .split("{{RSVP_LINKS}}")
    .join(testRsvpLink)
    .split("{{PLAYER_LINK}}")
    .join(testPlayerLink);

  const templatedContent = renderCommunicationTemplate(preparedContent, testRecipientName, {
    organizationLogo: logoPlaceholder,
    organizationName: orgName,
    ...eventContext,
  });

  const templatedSubject = renderCommunicationTemplate(options.subject, testRecipientName, {
    organizationName: orgName,
    ...eventContext,
  });

  return {
    fromName: options.fromName ?? undefined,
    templatedContent,
    templatedSubject,
  };
}

async function handleTestEmailDelivery(
  env: WorkerHonoEnvironment["Bindings"],
  organizationId: string,
  data: CommunicationTestEmailRequest,
  idempotencyKey?: string,
): Promise<void> {
  await assertEmailProviderRecipientAvailable(env.CONTROL_DB, data.email);
  const [senderConfig, branding, events] = await Promise.all([
    readOrganizationEmailSenderConfig(env, organizationId),
    readOrganizationBrandingConfig(env, organizationId),
    data.audience?.eventId
      ? listOrganizationEvents(env, organizationId).catch(() => [])
      : Promise.resolve([]),
  ]);

  const selectedEvent = data.audience?.eventId
    ? (events.find((e) => e.id === data.audience?.eventId) ?? null)
    : null;

  const { fromName, templatedContent, templatedSubject } = renderTestEmailPayload({
    baseDomain: env.PRODUCT_BASE_DOMAIN || "localhost",
    branding,
    contentMarkdown: data.contentMarkdown,
    event: selectedEvent,
    fromName: senderConfig.fromName,
    subject: data.subject,
  });

  const delivery = await deliverOrganizationCommunication(env, {
    channel: "email",
    contentMarkdown: templatedContent,
    deliveryId: crypto.randomUUID(),
    destination: data.email,
    fromName,
    messageId: crypto.randomUUID(),
    organizationId,
    recipientName: "Test recipient",
    replyTo: senderConfig.replyTo ?? undefined,
    sendingDomain: senderConfig.sendingDomain ?? undefined,
    sourceId: idempotencyKey ?? crypto.randomUUID(),
    sourceKind: "test_email",
    subject: "[Test] " + templatedSubject,
    unsubscribeUrl: null,
  });
  if (delivery.status === "suppressed") {
    throw new Error(delivery.failureDetail || "Organization email delivery is disabled.");
  }
}

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
    const validationIssues = validateCommunicationContext(body.data);
    if (validationIssues.length > 0) {
      return context.json(
        {
          code: "invalid_communication_context",
          message: validationIssues[0]?.message ?? "Invalid communication context.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    }
    const idempotencyKey = communicationIdempotencyKeySchema
      .optional()
      .safeParse(context.req.header("idempotency-key"));
    if (!idempotencyKey.success)
      return context.json(
        {
          code: "validation_failed",
          message: "The Idempotency-Key header must be between 1 and 256 characters.",
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
        idempotencyKey.data,
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
    const idempotencyKey = communicationIdempotencyKeySchema
      .optional()
      .safeParse(context.req.header("idempotency-key"));
    if (!idempotencyKey.success)
      return context.json(
        {
          code: "validation_failed",
          message: "The Idempotency-Key header must be between 1 and 256 characters.",
          requestId: context.get("requestId"),
        } satisfies ProblemDetails,
        400,
      );
    try {
      await handleTestEmailDelivery(
        context.env,
        authorization.organizationId,
        body.data,
        idempotencyKey.data,
      );
      return context.json({ requestId: context.get("requestId"), sent: true as const }, 202);
    } catch (error: unknown) {
      const result = communicationProblem(
        error,
        context.get("requestId"),
        error instanceof Error
          ? `The test email could not be sent. ${error.message}`
          : "The test email could not be sent. Check the email delivery setup and try again.",
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

  router.post("/api/organization/communications/:messageId/cancel", async (context) => {
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
      const message = await cancelOrganizationCommunication(
        context.env,
        {
          actorUserId: authorization.userId,
          organizationId: authorization.organizationId,
          requestId: context.get("requestId"),
        },
        messageId.data,
      );
      return context.json({ ...message, requestId: context.get("requestId") });
    } catch (error: unknown) {
      const result = communicationProblem(
        error,
        context.get("requestId"),
        error instanceof CommunicationRepositoryError &&
          error.code === "communication_delivery_started"
          ? "Delivery has already started, so this message can no longer be canceled."
          : "The queued communication could not be canceled.",
      );
      return context.json(result.problem, result.status);
    }
  });
}
