import { type ProblemDetails } from "@choir/contracts";
import type { Context } from "hono";

import { createAuth } from "../../auth/config";
import { authorizePlatformAdministratorSession } from "../../auth/platformAdministrator";
import type { WorkerHonoEnvironment } from "../helpers";

export type WorkerContext = Context<WorkerHonoEnvironment>;

export async function authorizePlatformRead(
  context: WorkerContext,
  requestUrl: URL,
): Promise<{ readonly userId: string } | Response> {
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
  if (authorization.ok) return { userId: authorization.value.userId };
  return context.json(
    {
      code: authorization.error.code,
      message: authorization.error.message,
      requestId: context.get("requestId"),
    } satisfies ProblemDetails,
    authorization.error.code === "unauthorized" ? 401 : 403,
  );
}
