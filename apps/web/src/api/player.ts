import { request } from "./client";

export interface PublicPlayerLink {
  readonly expiresAt: number;
  readonly issuedAt: number;
  readonly token: string;
  readonly url: string;
}

export interface PublicPlayerLinkStatus {
  readonly active: boolean;
  readonly eventId: string;
  readonly expiresAt: number | null;
  readonly issuedAt: number | null;
  readonly status: "none" | "active" | "expired";
}

async function readPublicPlayerLink(response: Response): Promise<PublicPlayerLink> {
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
  const url =
    "url" in body && typeof body.url === "string" && body.url.length > 0
      ? body.url
      : "/player?mode=set-list&token=" + encodeURIComponent(body.token);
  const expiresAt = "expiresAt" in body && typeof body.expiresAt === "number" ? body.expiresAt : 0;
  const issuedAt = "issuedAt" in body && typeof body.issuedAt === "number" ? body.issuedAt : 0;
  return { expiresAt, issuedAt, token: body.token, url };
}

export async function generatePublicPlayerToken(eventId: string): Promise<PublicPlayerLink> {
  const response = await request("/api/organization/player-tokens", {
    body: JSON.stringify({ eventId }),
    method: "POST",
  });
  return readPublicPlayerLink(response);
}

async function readPublicPlayerLinkStatus(response: Response): Promise<PublicPlayerLinkStatus> {
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("status" in body) ||
    (body.status !== "none" && body.status !== "active" && body.status !== "expired")
  ) {
    throw new Error("The practice player link status response was invalid.");
  }
  const active = "active" in body && typeof body.active === "boolean" ? body.active : false;
  const eventId = "eventId" in body && typeof body.eventId === "string" ? body.eventId : "";
  const expiresAt =
    "expiresAt" in body && typeof body.expiresAt === "number" ? body.expiresAt : null;
  const issuedAt = "issuedAt" in body && typeof body.issuedAt === "number" ? body.issuedAt : null;
  return { active, eventId, expiresAt, issuedAt, status: body.status };
}

export async function getPublicPlayerLinkStatus(
  eventId: string,
  signal?: AbortSignal,
): Promise<PublicPlayerLinkStatus> {
  const response = await request(
    `/api/organization/player-tokens/${encodeURIComponent(eventId)}/status`,
    signal ? { signal } : undefined,
  );
  return readPublicPlayerLinkStatus(response);
}

export async function rotatePublicPlayerToken(eventId: string): Promise<PublicPlayerLink> {
  const response = await request(
    `/api/organization/player-tokens/${encodeURIComponent(eventId)}/rotate`,
    { method: "POST" },
  );
  return readPublicPlayerLink(response);
}

export async function getPublicPlayerDetails(token: string): Promise<unknown> {
  const response = await request("/api/public/player-details", {
    body: JSON.stringify({ token }),
    method: "POST",
  });
  return response.json();
}

export async function getPublicPlayerPlaylist(token: string): Promise<unknown> {
  const response = await request(`/api/public/player/playlist?token=${encodeURIComponent(token)}`);
  return response.json();
}
