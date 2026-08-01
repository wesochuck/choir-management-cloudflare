import { request } from "./client";

export async function generatePublicPlayerToken(eventId: string): Promise<string> {
  const response = await request("/api/organization/player-tokens", {
    body: JSON.stringify({ eventId }),
    method: "POST",
  });
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
  return body.token;
}
