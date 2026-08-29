import {
  organizationPollResultsResponseSchema,
  organizationPollSchema,
  organizationPollSummariesResponseSchema,
  type OrganizationPoll,
  type OrganizationPollRequest,
  type OrganizationPollResultsResponse,
  type OrganizationPollSummary,
} from "@choir/contracts";
import { request, requestJson } from "./client";

export async function listOrganizationPolls(
  showArchived = false,
  signal?: AbortSignal,
): Promise<readonly OrganizationPollSummary[]> {
  const endpoint = showArchived
    ? "/api/organization/polls?archived=true"
    : "/api/organization/polls";
  const result = await requestJson(endpoint, organizationPollSummariesResponseSchema, {
    signal: signal ?? null,
  });
  return result.polls;
}

export async function getOrganizationPoll(
  pollId: string,
  signal?: AbortSignal,
): Promise<OrganizationPoll> {
  return requestJson(
    `/api/organization/polls/${encodeURIComponent(pollId)}`,
    organizationPollSchema,
    { signal: signal ?? null },
  );
}

export async function getOrganizationPollResults(
  pollId: string,
  signal?: AbortSignal,
): Promise<OrganizationPollResultsResponse> {
  return requestJson(
    `/api/organization/polls/${encodeURIComponent(pollId)}/results`,
    organizationPollResultsResponseSchema,
    { signal: signal ?? null },
  );
}

export async function createOrganizationPoll(
  poll: OrganizationPollRequest & { readonly id?: string },
): Promise<OrganizationPoll> {
  return requestJson("/api/organization/polls", organizationPollSchema, {
    body: JSON.stringify(poll),
    method: "POST",
  });
}

export async function updateOrganizationPoll(
  pollId: string,
  poll: OrganizationPollRequest,
): Promise<OrganizationPoll> {
  return requestJson(
    `/api/organization/polls/${encodeURIComponent(pollId)}`,
    organizationPollSchema,
    {
      body: JSON.stringify(poll),
      method: "PUT",
    },
  );
}

export async function deleteOrganizationPoll(pollId: string): Promise<void> {
  await request(`/api/organization/polls/${encodeURIComponent(pollId)}`, {
    method: "DELETE",
  });
}
