import {
  platformSetupStatusResponseSchema,
  setupStatusSchema,
  type PlatformSetupStatusResponse,
  type SetupProgressRequest,
  type SetupStatus,
} from "@choir/contracts";
import { z } from "zod";

import { requestJson } from "./client";

export async function getPlatformSetupStatus(
  signal?: AbortSignal,
): Promise<PlatformSetupStatusResponse> {
  return requestJson("/api/platform/setup-status", platformSetupStatusResponseSchema, {
    signal: signal ?? null,
  });
}

export async function getSetupStatus(signal?: AbortSignal): Promise<SetupStatus> {
  return requestJson("/api/setup/status", setupStatusSchema, { signal: signal ?? null });
}

export async function saveSetupProgress(
  progress: SetupProgressRequest,
): Promise<{ readonly saved: boolean }> {
  return requestJson("/api/setup/progress", z.object({ saved: z.boolean() }), {
    body: JSON.stringify(progress),
    method: "POST",
  });
}

export async function completeSetup(): Promise<{ readonly launched: boolean }> {
  return requestJson("/api/setup/complete", z.object({ launched: z.boolean() }), {
    body: JSON.stringify({}),
    method: "POST",
  });
}
