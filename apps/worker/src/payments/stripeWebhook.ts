import { z } from "zod";

const stripeEventTypeSchema = z.enum([
  "charge.refunded",
  "checkout.session.completed",
  "checkout.session.expired",
]);

export const stripeEventSchema = z.object({
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
  id: z.string().trim().min(1).max(256),
  type: stripeEventTypeSchema,
});

export type StripeEvent = z.infer<typeof stripeEventSchema>;

const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftByte = left[index] ?? 0;
    const rightByte = right[index] ?? 0;
    difference |= leftByte ^ rightByte;
  }
  return difference === 0;
}

export async function verifyStripeWebhookSignature(
  secret: string,
  signatureHeader: string | null,
  rawBody: string,
  now = Date.now(),
): Promise<boolean> {
  if (!secret || !signatureHeader) return false;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const segment of signatureHeader.split(",")) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    const key = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (key === "t") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isSafeInteger(parsed)) timestamp = parsed;
    } else if (key === "v1") {
      signatures.push(value);
    }
  }
  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(Math.floor(now / 1_000) - timestamp) > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signed = new TextEncoder().encode(`${String(timestamp)}.${rawBody}`);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));
  return signatures.some((signature) => {
    const provided = hexToBytes(signature);
    return provided !== null && equalBytes(expected, provided);
  });
}

export function stripeSignatureForTest(
  secret: string,
  rawBody: string,
  timestamp: number,
): Promise<string> {
  return crypto.subtle
    .importKey("raw", new TextEncoder().encode(secret), { hash: "SHA-256", name: "HMAC" }, false, [
      "sign",
    ])
    .then((key) =>
      crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${String(timestamp)}.${rawBody}`)),
    )
    .then((signature) => `t=${String(timestamp)},v1=${bytesToHex(new Uint8Array(signature))}`);
}
