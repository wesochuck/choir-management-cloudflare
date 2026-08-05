import { memberDashboardResponseSchema, type MemberDashboardResponse } from "@choir/contracts";

import { request } from "./client";

export async function getMemberDashboard(signal?: AbortSignal): Promise<MemberDashboardResponse> {
  const response = await request("/api/singer/dashboard", { signal: signal ?? null });
  return memberDashboardResponseSchema.parse(await response.json());
}

export async function getMemberPracticeLink(eventId: string): Promise<string> {
  const response = await request(`/api/singer/practice-links/${encodeURIComponent(eventId)}`);
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("token" in body) ||
    typeof body.token !== "string" ||
    body.token.length === 0
  ) {
    throw new Error("The practice player link response was invalid.");
  }
  return `/player?mode=set-list&token=${encodeURIComponent(body.token)}`;
}
