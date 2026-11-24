import { z } from "zod";

import type { Env } from "../env";

const turnstileSiteverifyResponseSchema = z.object({
  success: z.boolean().optional(),
});

export type TurnstileEnv = Pick<Env, "APP_ENV" | "EXTERNAL_EFFECTS_MODE" | "TURNSTILE_SECRET_KEY">;

async function verifyTurnstileWithProvider(
  secret: string,
  token: string,
  clientIp: string,
): Promise<boolean> {
  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (clientIp && clientIp !== "unknown") {
      form.set("remoteip", clientIp);
    }
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      body: form,
      method: "POST",
    });
    if (!response.ok) return false;
    const parsed = turnstileSiteverifyResponseSchema.safeParse(
      await response.json().catch(() => null),
    );
    return parsed.success && parsed.data.success === true;
  } catch {
    return false;
  }
}

export async function verifyTurnstileToken(
  env: TurnstileEnv,
  token: string | undefined,
  clientIp: string,
): Promise<boolean> {
  if (!token || typeof token !== "string" || !token.trim()) {
    return false;
  }
  const cleanToken = token.trim();
  const secret = env.TURNSTILE_SECRET_KEY?.trim();

  // If secret key is provided, use Cloudflare's siteverify endpoint.
  if (secret) {
    return verifyTurnstileWithProvider(secret, cleanToken, clientIp);
  }

  // Fallback is restricted to local fake-effect mode when secret is omitted.
  // Hosted environments and non-fake modes must fail closed.
  if (env.APP_ENV !== "local" || env.EXTERNAL_EFFECTS_MODE !== "fake") {
    return false;
  }

  // Reject explicitly invalid tokens; accept test tokens in local fake mode.
  if (
    cleanToken.toLowerCase().includes("invalid") ||
    cleanToken.toLowerCase().includes("fail") ||
    cleanToken === "2x0000000000000000000000000000000AA"
  ) {
    return false;
  }
  return true;
}
