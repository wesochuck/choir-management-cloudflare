import { ticketBundleRequestSchema, type ProblemDetails } from "@choir/contracts";
import type { Context } from "hono";
import { z } from "zod";

import {
  saveOrganizationTicketBundle,
  TicketingError,
} from "../../organization/organizationTicketing";
import { authorizeCalendarRoute, type WorkerHonoEnvironment } from "./routeContracts";

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
