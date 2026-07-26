import { issueSignedLink, verifySignedLinkScope } from "../security/signedLinks";
import type { Env } from "../env";

const stub = (env: Pick<Env, "ORGANIZATION_STORE">, organizationId: string) =>
  env.ORGANIZATION_STORE.get(env.ORGANIZATION_STORE.idFromName(organizationId));

export async function generateAuditionTokens(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  auditionIds: readonly string[],
): Promise<{ tokens: Record<string, string> }> {
  const now = Math.floor(Date.now() / 1000);
  const tokens: Record<string, string> = {};
  const objectStub = stub(env, organizationId);
  for (const auditionId of auditionIds) {
    const detailsUrl = new URL("https://organization.internal/internal/audition/details");
    detailsUrl.searchParams.set("organizationId", organizationId);
    detailsUrl.searchParams.set("auditionId", auditionId);
    const details = await objectStub.fetch(detailsUrl);
    if (!details.ok) return { tokens: {} };
  }
  for (const auditionId of auditionIds) {
    tokens[auditionId] = await issueSignedLink(env.SIGNED_LINK_SECRET, {
      algorithm: "HS256",
      expiresAt: now + 90 * 24 * 60 * 60,
      issuedAt: now,
      nonce: crypto.randomUUID(),
      organizationId,
      purpose: "audition",
      resourceId: auditionId,
      subjectId: auditionId,
      version: 1,
    });
  }
  return { tokens };
}

type AuditionDetailResponse = Record<string, unknown>;

export async function resolveAuditionDetails(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  token: string,
): Promise<AuditionDetailResponse | { readonly code: string; readonly status: number }> {
  const envelope = await verifySignedLinkScope(env.SIGNED_LINK_SECRET, token, {
    expectedOrganizationId: organizationId,
    expectedPurpose: "audition",
  });
  if (!envelope?.resourceId || !envelope.subjectId) {
    return { code: "invalid_link", status: 404 };
  }
  const url = new URL("https://organization.internal/internal/audition/details");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("auditionId", envelope.resourceId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) {
    return { code: "audition_details_failed", status: response.status };
  }
  return await response.json();
}

export async function submitAuditionUpdate(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  token: string,
  availabilityNotes: string | undefined,
  voicePart: string | undefined,
): Promise<AuditionDetailResponse | { readonly code: string; readonly status: number }> {
  const envelope = await verifySignedLinkScope(env.SIGNED_LINK_SECRET, token, {
    expectedOrganizationId: organizationId,
    expectedPurpose: "audition",
  });
  if (!envelope?.resourceId) {
    return { code: "invalid_link", status: 404 };
  }
  const url = new URL("https://organization.internal/internal/audition/update");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("auditionId", envelope.resourceId);
  if (availabilityNotes !== undefined) {
    url.searchParams.set("availabilityNotes", availabilityNotes);
  }
  if (voicePart !== undefined) {
    url.searchParams.set("voicePart", voicePart);
  }
  const response = await stub(env, organizationId).fetch(url, { method: "POST" });
  if (!response.ok) {
    return { code: "audition_update_failed", status: response.status };
  }
  return await response.json();
}
