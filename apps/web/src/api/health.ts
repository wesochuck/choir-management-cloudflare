import { healthResponseSchema, type HealthResponse } from "@choir/contracts";
import { requestJson } from "./client";

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return requestJson("/api/health", healthResponseSchema, { signal: signal ?? null });
}
