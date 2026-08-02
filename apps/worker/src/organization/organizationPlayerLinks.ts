import { organizationMusicLibrarySettingsRequestSchema } from "@choir/contracts";
import { z } from "zod";
import { issueSignedLink, verifySignedLinkScope } from "../security/signedLinks";
import type { Env } from "../env";

const stub = (env: Pick<Env, "ORGANIZATION_STORE">, organizationId: string) =>
  env.ORGANIZATION_STORE.get(env.ORGANIZATION_STORE.idFromName(organizationId));

const playerLinkRowSchema = z.object({
  eventId: z.uuid(),
  expiresAt: z.number().int().positive(),
  issuedAt: z.number().int().positive(),
  nonce: z.string().min(16).max(128),
  updatedAt: z.iso.datetime(),
});

const PLAYER_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Issue a recipient-scoped, no-login practice-player link token. */
export function issuePlayerToken(
  env: Pick<Env, "SIGNED_LINK_SECRET">,
  organizationId: string,
  eventId: string,
  profileId: string,
  issuedAt = Math.floor(Date.now() / 1000),
): Promise<string> {
  return issueSignedLink(env.SIGNED_LINK_SECRET, {
    algorithm: "HS256",
    expiresAt: issuedAt + PLAYER_LINK_TTL_SECONDS,
    issuedAt,
    nonce: crypto.randomUUID(),
    organizationId,
    purpose: "player",
    resourceId: eventId,
    subjectId: profileId,
    version: 1,
  });
}

export async function generatePlayerTokens(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  eventId: string,
  profileIds: readonly string[],
): Promise<{ tokens: Record<string, string> }> {
  const now = Math.floor(Date.now() / 1000);
  const signedTokens = await Promise.all(
    profileIds.map(async (profileId) => {
      const token = await issuePlayerToken(env, organizationId, eventId, profileId, now);
      return [profileId, token] as const;
    }),
  );
  const tokens: Record<string, string> = {};
  for (const [profileId, token] of signedTokens) tokens[profileId] = token;
  return { tokens };
}

export async function generatePublicPlayerToken(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  eventId: string,
  rotate = false,
): Promise<{ token: string }> {
  const settingsUrl = new URL("https://organization.internal/internal/music/settings");
  settingsUrl.searchParams.set("organizationId", organizationId);
  const settingsResponse = await stub(env, organizationId).fetch(settingsUrl);
  if (!settingsResponse.ok) throw new Error("Practice player settings are unavailable.");
  const settings = organizationMusicLibrarySettingsRequestSchema.parse(
    await settingsResponse.json(),
  );
  const issuedAt = Math.floor(Date.now() / 1000);
  const linkResponse = await stub(env, organizationId).fetch(
    "https://organization.internal/internal/player/public-link",
    {
      body: JSON.stringify({
        action: "ensure",
        eventId,
        expiresAt: issuedAt + settings.practicePlayerLinkLifetimeDays * 24 * 60 * 60,
        issuedAt,
        nonce: crypto.randomUUID(),
        organizationId,
        requestId: crypto.randomUUID(),
        rotate,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!linkResponse.ok) throw new Error("Practice player link is unavailable.");
  const link = playerLinkRowSchema.parse(await linkResponse.json());
  return {
    token: await issueSignedLink(env.SIGNED_LINK_SECRET, {
      algorithm: "HS256",
      expiresAt: link.expiresAt,
      issuedAt: link.issuedAt,
      nonce: link.nonce,
      organizationId,
      purpose: "player_public",
      resourceId: link.eventId,
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
  const linkUrl = new URL("https://organization.internal/internal/player/public-link");
  linkUrl.searchParams.set("eventId", envelope.resourceId);
  linkUrl.searchParams.set("nonce", envelope.nonce ?? "");
  linkUrl.searchParams.set("organizationId", organizationId);
  const linkResponse = await stub(env, organizationId).fetch(linkUrl);
  if (!linkResponse.ok) {
    const linkBody: unknown = await linkResponse.json().catch(() => null);
    if (
      typeof linkBody !== "object" ||
      linkBody === null ||
      !("code" in linkBody) ||
      linkBody.code !== "practice_link_not_found"
    ) {
      return { code: "invalid_link", status: 404 };
    }
    // Preserve compatibility with recipient-independent links issued before stable link storage.
  }
  const url = new URL("https://organization.internal/internal/player/playlist");
  url.searchParams.set("eventId", envelope.resourceId);
  url.searchParams.set("organizationId", organizationId);
  const response = await stub(env, organizationId).fetch(url);
  if (!response.ok) return { code: "player_playlist_failed", status: response.status };
  return await response.json();
}
