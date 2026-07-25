import { z } from "zod";
import { issueSignedLink, verifySignedLinkScope } from "../security/signedLinks";
import type { Env } from "../env";

const stub = (env: Pick<Env, "ORGANIZATION_STORE">, organizationId: string) =>
  env.ORGANIZATION_STORE.get(env.ORGANIZATION_STORE.idFromName(organizationId));

function readJsonSafe(response: Response): Promise<unknown> {
  return response.json();
}

interface PollDetailsResponse {
  readonly canSubmit: boolean;
  readonly description: string;
  readonly expiresAt: string;
  readonly multipleChoice: boolean;
  readonly options: readonly {
    readonly id: string;
    readonly label: string;
    readonly sortOrder: number;
  }[];
  readonly pollId: string;
  readonly profileId: string;
  readonly profileName: string;
  readonly responseOptionIds: readonly string[];
  readonly title: string;
}

async function readProfilePoll(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
  pollId: string,
  profileId: string,
): Promise<PollDetailsResponse | null> {
  const url = new URL("https://organization.internal/internal/polls/profile-poll");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("pollId", pollId);
  url.searchParams.set("profileId", profileId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) return null;
  return response.json();
}

export async function generatePollTokens(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  pollId: string,
  profileIds: readonly string[],
): Promise<{ readonly tokens: Record<string, string> }> {
  const tokens: Record<string, string> = {};
  for (const profileId of profileIds) {
    tokens[profileId] = await issueSignedLink(env.SIGNED_LINK_SECRET, {
      algorithm: "HS256",
      expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      issuedAt: Math.floor(Date.now() / 1000),
      nonce: crypto.randomUUID(),
      organizationId,
      purpose: "poll",
      resourceId: pollId,
      subjectId: profileId,
      version: 1,
    });
  }
  return { tokens };
}

export async function resolvePollDetails(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  token: string,
): Promise<PollDetailsResponse | { readonly code: string; readonly status: number }> {
  const envelope = await verifySignedLinkScope(env.SIGNED_LINK_SECRET, token, {
    expectedOrganizationId: organizationId,
    expectedPurpose: "poll",
  });
  if (!envelope?.resourceId || !envelope.subjectId) {
    return { code: "invalid_link", status: 404 };
  }
  const details = await readProfilePoll(
    env,
    organizationId,
    envelope.resourceId,
    envelope.subjectId,
  );
  if (!details) {
    return { code: "profile_poll_not_found", status: 404 };
  }
  return details;
}

export async function submitPollResponse(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  token: string,
  optionIds: readonly string[],
): Promise<{ readonly status: number } | { readonly code: string; readonly status: number }> {
  const envelope = await verifySignedLinkScope(env.SIGNED_LINK_SECRET, token, {
    expectedOrganizationId: organizationId,
    expectedPurpose: "poll",
  });
  if (!envelope?.resourceId || !envelope.subjectId) {
    return { code: "invalid_link", status: 404 };
  }
  const profileRow = await stub(env, organizationId).fetch(
    `https://organization.internal/internal/profiles/member?profileId=${encodeURIComponent(envelope.subjectId)}`,
  );
  const raw: unknown = profileRow.ok ? await readJsonSafe(profileRow) : null;
  const profile =
    raw !== null && typeof raw === "object"
      ? z.object({ displayName: z.string().optional() }).safeParse(raw).data ?? null
      : null;

  const objectStub = stub(env, organizationId);
  const response = await objectStub.fetch("https://organization.internal/internal/polls/manage", {
    body: JSON.stringify({
      action: "submit_poll_response",
      actorUserId: `public:${envelope.subjectId}`,
      organizationId,
      pollId: envelope.resourceId,
      requestId: crypto.randomUUID(),
      response: {
        optionIds,
        profileId: envelope.subjectId,
        profileName: profile?.displayName ?? "",
      },
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    return { code: "poll_response_failed", status: response.status };
  }
  return { status: response.status };
}
