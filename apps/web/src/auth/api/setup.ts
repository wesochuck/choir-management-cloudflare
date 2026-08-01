import {
  platformSetupStatusResponseSchema,
  type PlatformSetupStatusResponse,
} from "@choir/contracts";

import { request } from "./client";

export async function getPlatformSetupStatus(
  signal?: AbortSignal,
): Promise<PlatformSetupStatusResponse> {
  const response = await request("/api/platform/setup-status", { signal: signal ?? null });
  return platformSetupStatusResponseSchema.parse(await response.json());
}
