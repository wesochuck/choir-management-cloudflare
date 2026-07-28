import { issueSignedLink, verifySignedLinkScope } from "../security/signedLinks";
import type { Env } from "../env";

const stub = (env: Pick<Env, "ORGANIZATION_STORE">, organizationId: string) =>
  env.ORGANIZATION_STORE.get(env.ORGANIZATION_STORE.idFromName(organizationId));

export async function generatePlayerTokens(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  eventId: string,
  profileIds: readonly string[],
): Promise<{ tokens: Record<string, string> }> {
  const now = Math.floor(Date.now() / 1000);
  const tokens: Record<string, string> = {};
  for (const profileId of profileIds) {
    tokens[profileId] = await issueSignedLink(env.SIGNED_LINK_SECRET, {
      algorithm: "HS256",
      expiresAt: now + 7 * 24 * 60 * 60,
      issuedAt: now,
      nonce: crypto.randomUUID(),
      organizationId,
      purpose: "player",
      resourceId: eventId,
      subjectId: profileId,
      version: 1,
    });
  }
  return { tokens };
}

export async function generatePublicPlayerToken(
  env: Pick<Env, "SIGNED_LINK_SECRET">,
  organizationId: string,
  eventId: string,
): Promise<{ token: string }> {
  const now = Math.floor(Date.now() / 1000);
  return {
    token: await issueSignedLink(env.SIGNED_LINK_SECRET, {
      algorithm: "HS256",
      expiresAt: now + 7 * 24 * 60 * 60,
      issuedAt: now,
      nonce: crypto.randomUUID(),
      organizationId,
      purpose: "player_public",
      resourceId: eventId,
      version: 1,
    }),
  };
}

type PlayerDetailResponse = Record<string, unknown>;

export async function resolvePlayerDetails(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  token: string,
): Promise<PlayerDetailResponse | { readonly code: string; readonly status: number }> {
  const envelope = await verifySignedLinkScope(env.SIGNED_LINK_SECRET, token, {
    expectedOrganizationId: organizationId,
    expectedPurpose: "player",
  });
  if (!envelope?.resourceId || !envelope.subjectId) {
    return { code: "invalid_link", status: 404 };
  }
  const url = new URL("https://organization.internal/internal/player/details");
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("eventId", envelope.resourceId);
  url.searchParams.set("profileId", envelope.subjectId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) {
    return { code: "player_details_failed", status: response.status };
  }
  return await response.json();
}

export async function resolvePublicPlayerPlaylist(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  token: string,
): Promise<Record<string, unknown> | { readonly code: string; readonly status: number }> {
  const envelope = await verifySignedLinkScope(env.SIGNED_LINK_SECRET, token, {
    expectedOrganizationId: organizationId,
    expectedPurpose: "player_public",
  });
  if (!envelope?.resourceId) return { code: "invalid_link", status: 404 };
  const url = new URL("https://organization.internal/internal/player/playlist");
  url.searchParams.set("eventId", envelope.resourceId);
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) return { code: "player_playlist_failed", status: response.status };
  return await response.json();
}
