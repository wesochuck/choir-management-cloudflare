import { request } from "./client";

export interface PublicPlayerLink {
  readonly token: string;
  readonly url: string;
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
  return { token: body.token, url };
}

export async function generatePublicPlayerToken(eventId: string): Promise<PublicPlayerLink> {
  const response = await request("/api/organization/player-tokens", {
    body: JSON.stringify({ eventId }),
    method: "POST",
  });
  return readPublicPlayerLink(response);
}

export async function rotatePublicPlayerToken(eventId: string): Promise<PublicPlayerLink> {
  const response = await request(
    `/api/organization/player-tokens/${encodeURIComponent(eventId)}/rotate`,
    { method: "POST" },
  );
  return readPublicPlayerLink(response);
}
