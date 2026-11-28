import { timingSafeEqual } from "node:crypto";
import { organizationMusicLibrarySettingsRequestSchema } from "@choir/contracts";
import { z } from "zod";
import {
  derivePracticeShareCode,
  digestPracticeShareCode,
  issueSignedLink,
  verifySignedLinkScope,
} from "../security/signedLinks";
import type { Env } from "../env";
import { invokeOrganizationRpc, organizationStoreStub } from "./rpc/client";
import { mutateOrganizationStore, readOrganizationStore } from "./rpc/repository";

const playerLinkRowSchema = z.object({
  eventId: z.uuid(),
  expiresAt: z.number().int().positive(),
  issuedAt: z.number().int().positive(),
  nonce: z.string().min(16).max(128),
  updatedAt: z.iso.datetime(),
});

const PLAYER_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;
const CALENDAR_PLAYER_LINK_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const CALENDAR_PLAYER_LINK_TTL_SECONDS = 30 * 24 * 60 * 60;

/** A set list must be published before a public practice-player link can be issued. */
export class PracticePlayerUnavailableError extends Error {
  readonly code = "practice_not_published";
  readonly status = 409;

  constructor() {
    super(
      "The Practice Player needs an approved, active set list with at least one learning track.",
    );
    this.name = "PracticePlayerUnavailableError";
  }
}

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

/**
 * Issue a deterministic, recipient-scoped Practice Player link token for
 * subscribed calendar feeds. Snapping `issuedAt` to a 7-day UTC window keeps
 * URLs stable across hourly calendar polls while the 30-day TTL ensures
 * cached calendar entries remain usable between slow client refreshes.
 */
export function issueCalendarPlayerToken(
  env: Pick<Env, "SIGNED_LINK_SECRET">,
  organizationId: string,
  eventId: string,
  profileId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const windowStart = Math.max(
    1,
    Math.floor(nowSeconds / CALENDAR_PLAYER_LINK_WINDOW_SECONDS) *
      CALENDAR_PLAYER_LINK_WINDOW_SECONDS,
  );
  return issueSignedLink(env.SIGNED_LINK_SECRET, {
    algorithm: "HS256",
    expiresAt: windowStart + CALENDAR_PLAYER_LINK_TTL_SECONDS,
    issuedAt: windowStart,
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

export interface PublicPlayerLinkStatus {
  readonly active: boolean;
  readonly eventId: string;
  readonly expiresAt: number | null;
  readonly issuedAt: number | null;
  readonly status: "none" | "active" | "expired";
}

export async function getPublicPlayerLinkStatus(
  env: Pick<Env, "ORGANIZATION_STORE">,
  organizationId: string,
  eventId: string,
): Promise<PublicPlayerLinkStatus> {
  const url = new URL("https://organization.internal/internal/player/public-link/status");
  url.searchParams.set("eventId", eventId);
  url.searchParams.set("organizationId", organizationId);
  const response = await invokeOrganizationRpc(organizationStoreStub(env, organizationId), url);
  if (!response.ok) {
    throw new Error("Practice player link status is unavailable.");
  }
  return await response.json();
}

export async function generatePublicPlayerToken(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  eventId: string,
  options: { readonly rotate?: boolean; readonly includeShareUrl?: boolean } = {},
): Promise<{
  readonly expiresAt: number;
  readonly issuedAt: number;
  readonly token: string;
  readonly shareUrl?: string;
}> {
  const settingsResponse = await readOrganizationStore(
    env,
    organizationId,
    "/internal/music/settings",
  );
  if (!settingsResponse.ok) throw new Error("Practice player settings are unavailable.");
  const settings = organizationMusicLibrarySettingsRequestSchema.parse(
    await settingsResponse.json(),
  );
  const issuedAt = Math.floor(Date.now() / 1000);
  const linkResponse = await mutateOrganizationStore(
    env,
    organizationId,
    "/internal/player/public-link",
    {
      action: "ensure",
      eventId,
      expiresAt: issuedAt + settings.practicePlayerLinkLifetimeDays * 24 * 60 * 60,
      issuedAt,
      nonce: crypto.randomUUID(),
      organizationId,
      requestId: crypto.randomUUID(),
      rotate: options.rotate ?? false,
    },
  );
  if (!linkResponse.ok) {
    const body: unknown = await linkResponse.json().catch(() => null);
    if (
      linkResponse.status === 409 &&
      typeof body === "object" &&
      body !== null &&
      "code" in body &&
      body.code === "practice_not_published"
    ) {
      throw new PracticePlayerUnavailableError();
    }
    throw new Error("Practice player link is unavailable.");
  }
  const link = playerLinkRowSchema.parse(await linkResponse.json());
  const shareUrl = options.includeShareUrl
    ? await createPracticeShareUrl(env, organizationId, link)
    : undefined;
  return {
    expiresAt: link.expiresAt,
    issuedAt: link.issuedAt,
    token: await signPublicPlayerLink(env.SIGNED_LINK_SECRET, organizationId, link),
    ...(shareUrl ? { shareUrl } : {}),
  };
}

function signPublicPlayerLink(
  secret: string,
  organizationId: string,
  link: z.infer<typeof playerLinkRowSchema>,
): Promise<string> {
  return issueSignedLink(secret, {
    algorithm: "HS256",
    expiresAt: link.expiresAt,
    issuedAt: link.issuedAt,
    nonce: link.nonce,
    organizationId,
    purpose: "player_public",
    resourceId: link.eventId,
    version: 1,
  });
}

async function createPracticeShareUrl(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  link: z.infer<typeof playerLinkRowSchema>,
): Promise<string> {
  const { eventId, nonce } = link;
  const code = await derivePracticeShareCode(
    env.SIGNED_LINK_SECRET,
    organizationId,
    eventId,
    nonce,
  );
  const stub = organizationStoreStub(env, organizationId);
  const slug = await stub.savePracticeShare({
    digest: await digestPracticeShareCode(code),
    eventId,
    nonce,
    organizationId,
  });
  if (!slug) throw new Error("Practice player link changed while sharing.");
  return `/practice/${slug}#${code}`;
}

export async function redeemPracticeShare(
  env: Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET">,
  organizationId: string,
  slug: string,
  code: string,
): Promise<string | null> {
  const link = await organizationStoreStub(env, organizationId).readPracticeShare({
    digest: await digestPracticeShareCode(code),
    organizationId,
    slug,
  });
  if (!link) return null;
  // Older Worker versions can rotate the nonce without touching the share columns.
  const expected = await derivePracticeShareCode(
    env.SIGNED_LINK_SECRET,
    organizationId,
    link.eventId,
    link.nonce,
  );
  const encoder = new TextEncoder();
  if (
    code.length !== expected.length ||
    !timingSafeEqual(encoder.encode(expected), encoder.encode(code))
  ) {
    return null;
  }
  return signPublicPlayerLink(env.SIGNED_LINK_SECRET, organizationId, link);
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
  const response = await readOrganizationStore(env, organizationId, "/internal/player/details", {
    eventId: envelope.resourceId,
    profileId: envelope.subjectId,
  });
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
  const linkResponse = await invokeOrganizationRpc(
    organizationStoreStub(env, organizationId),
    linkUrl,
  );
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
  const response = await invokeOrganizationRpc(organizationStoreStub(env, organizationId), url);
  if (!response.ok) return { code: "player_playlist_failed", status: response.status };
  return await response.json();
}
