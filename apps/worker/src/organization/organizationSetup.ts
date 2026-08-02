import {
  moduleStatesResponseSchema,
  setupClaimResponseSchema,
  setupProgressRequestSchema,
  setupStatusSchema,
  type SetupProgressRequest,
  type SetupStatus,
  type ModuleState,
} from "@choir/contracts";

import type { Env } from "../env";

interface ActorContext {
  readonly actorUserId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

export class SetupError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SetupError";
  }
}

function stub(env: Pick<Env, "ORGANIZATION_STORE">, organizationId: string) {
  return env.ORGANIZATION_STORE.get(env.ORGANIZATION_STORE.idFromName(organizationId));
}

async function errorCode(response: Response): Promise<string> {
  const value: unknown = await response.json().catch(() => null);
  return typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string"
    ? value.code
    : "setup_error";
}

export async function getSetupStatus(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): Promise<SetupStatus> {
  const url = new URL("https://organization.internal/internal/setup/state");
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) {
    const code = await errorCode(response);
    throw new SetupError(code, response.status, "Setup status unavailable.");
  }
  return setupStatusSchema.parse(await response.json());
}

export async function claimSetup(
  env: Pick<Env, "ORGANIZATION_STORE">,
  actor: ActorContext,
): Promise<{ readonly claimed: boolean; readonly organizationId: string }> {
  const response = await stub(env, actor.organizationId).fetch(
    "https://organization.internal/internal/setup/manage",
    {
      body: JSON.stringify({
        action: "claim_setup",
        ...actor,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    const code = await errorCode(response);
    throw new SetupError(code, response.status, "Setup could not be claimed.");
  }
  return setupClaimResponseSchema.parse(await response.json());
}

export async function saveSetupProgress(
  env: Pick<Env, "ORGANIZATION_STORE">,
  actor: ActorContext,
  progress: SetupProgressRequest,
): Promise<{ readonly saved: boolean }> {
  const validatedProgress = setupProgressRequestSchema.parse(progress);
  const response = await stub(env, actor.organizationId).fetch(
    "https://organization.internal/internal/setup/manage",
    {
      body: JSON.stringify({
        action: "save_progress",
        ...actor,
        step: validatedProgress.step,
        data: validatedProgress.data,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    const code = await errorCode(response);
    throw new SetupError(code, response.status, "Setup progress could not be saved.");
  }
  return { saved: true };
}

export async function completeSetup(
  env: Pick<Env, "ORGANIZATION_STORE">,
  actor: ActorContext,
): Promise<{ readonly completed: boolean }> {
  const response = await stub(env, actor.organizationId).fetch(
    "https://organization.internal/internal/setup/manage",
    {
      body: JSON.stringify({
        action: "complete_setup",
        ...actor,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    const code = await errorCode(response);
    throw new SetupError(code, response.status, "Setup could not be completed.");
  }
  return { completed: true };
}

export async function getModuleState(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): Promise<readonly ModuleState[]> {
  const url = new URL("https://organization.internal/internal/setup/modules");
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) throw new SetupError("modules_unavailable", 503, "Module state unavailable.");
  return moduleStatesResponseSchema.parse(await response.json()).modules;
}
