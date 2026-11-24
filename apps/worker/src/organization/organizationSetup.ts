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
import { mutateOrganizationStore, readOrganizationStore, storeErrorCode } from "./rpc/repository";
import { verifyPublicLogoCandidate } from "../storage/publicLogo";

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

export async function getSetupStatus(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): Promise<SetupStatus> {
  const response = await readOrganizationStore(env, organizationId, "/internal/setup/state");
  if (!response.ok) {
    const code = await storeErrorCode(response, "setup_error");
    throw new SetupError(code, response.status, "Setup status unavailable.");
  }
  return setupStatusSchema.parse(await response.json());
}

export async function claimSetup(
  env: Pick<Env, "ORGANIZATION_STORE">,
  actor: ActorContext,
): Promise<{ readonly claimed: boolean; readonly organizationId: string }> {
  const response = await mutateOrganizationStore(
    env,
    actor.organizationId,
    "/internal/setup/manage",
    {
      action: "claim_setup",
      ...actor,
    },
  );
  if (!response.ok) {
    const code = await storeErrorCode(response, "setup_error");
    throw new SetupError(code, response.status, "Setup could not be claimed.");
  }
  return setupClaimResponseSchema.parse(await response.json());
}

export async function saveSetupProgress(
  env: Pick<Env, "ORGANIZATION_FILES" | "ORGANIZATION_STORE">,
  actor: ActorContext,
  progress: SetupProgressRequest,
): Promise<{ readonly saved: boolean }> {
  const validatedProgress = setupProgressRequestSchema.parse(progress);
  let logoVerifiedContentType: "image/jpeg" | "image/png" | "image/webp" | null | undefined;
  if (validatedProgress.data && "logoFileId" in validatedProgress.data) {
    const rawLogoFileId = validatedProgress.data.logoFileId;
    if (typeof rawLogoFileId === "string" && rawLogoFileId.trim().length > 0) {
      const verified = await verifyPublicLogoCandidate(env, actor.organizationId, rawLogoFileId);
      if (!verified.ok) {
        throw new SetupError(
          "invalid_logo_image",
          400,
          "Organization logos must be valid PNG, JPEG, or WebP images up to 5 MB.",
        );
      }
      logoVerifiedContentType = verified.verifiedContentType;
    } else {
      logoVerifiedContentType = null;
    }
  }
  const response = await mutateOrganizationStore(
    env,
    actor.organizationId,
    "/internal/setup/manage",
    {
      action: "save_progress",
      ...actor,
      step: validatedProgress.step,
      data: validatedProgress.data,
      ...(logoVerifiedContentType !== undefined ? { logoVerifiedContentType } : {}),
    },
  );
  if (!response.ok) {
    const code = await storeErrorCode(response, "setup_error");
    throw new SetupError(code, response.status, "Setup progress could not be saved.");
  }
  return { saved: true };
}

export async function completeSetup(
  env: Pick<Env, "ORGANIZATION_STORE">,
  actor: ActorContext,
): Promise<{ readonly completed: boolean }> {
  const response = await mutateOrganizationStore(
    env,
    actor.organizationId,
    "/internal/setup/manage",
    {
      action: "complete_setup",
      ...actor,
    },
  );
  if (!response.ok) {
    const code = await storeErrorCode(response, "setup_error");
    throw new SetupError(code, response.status, "Setup could not be completed.");
  }
  return { completed: true };
}

export async function getModuleState(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
): Promise<readonly ModuleState[]> {
  const response = await readOrganizationStore(env, organizationId, "/internal/setup/modules");
  if (!response.ok) throw new SetupError("modules_unavailable", 503, "Module state unavailable.");
  return moduleStatesResponseSchema.parse(await response.json()).modules;
}
