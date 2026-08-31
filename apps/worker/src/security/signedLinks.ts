import { organizationIdSchema } from "@choir/contracts";
import { z } from "zod";

const MAX_TOKEN_LENGTH = 4096;
const MAX_ENVELOPE_BYTES = 2048;
const SIGNATURE_BYTES = 32;
const textEncoder = new TextEncoder();

const signedLinkPurposeSchema = z.enum([
  "audition",
  "calendar_feed",
  "donation_receipt",
  "email_change",
  "impersonation",
  "poll",
  "private_download",
  "player",
  "player_public",
  "rsvp",
  "ticket_scan",
  "ticket_receipt",
  "unsubscribe",
]);

const signedLinkEnvelopeSchema = z.object({
  algorithm: z.literal("HS256"),
  expiresAt: z.number().int().positive(),
  issuedAt: z.number().int().positive(),
  nonce: z.string().min(16).max(128).optional(),
  organizationId: organizationIdSchema,
  purpose: signedLinkPurposeSchema,
  resourceId: z.string().min(1).max(128).optional(),
  revocation: z.string().min(1).max(128).optional(),
  subjectId: z.string().min(1).max(128).optional(),
  version: z.literal(1),
});

export type SignedLinkEnvelope = z.infer<typeof signedLinkEnvelopeSchema>;

export interface VerifySignedLinkScopeOptions {
  readonly expectedOrganizationId: string;
  readonly expectedPurpose: z.infer<typeof signedLinkPurposeSchema>;
  readonly now?: Date;
}

export interface VerifySignedLinkOptions extends VerifySignedLinkScopeOptions {
  readonly expectedResourceId?: string;
  readonly expectedRevocation?: string;
  readonly expectedSubjectId?: string;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function derivePurposeKey(secret: string, purpose: string): Promise<CryptoKey> {
  const masterKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const derivedBytes = await crypto.subtle.sign(
    "HMAC",
    masterKey,
    textEncoder.encode(`choir-management:signed-link:v1:${purpose}`),
  );
  return crypto.subtle.importKey("raw", derivedBytes, { hash: "SHA-256", name: "HMAC" }, false, [
    "sign",
  ]);
}

async function signPayload(secret: string, purpose: string, payload: string): Promise<Uint8Array> {
  const key = await derivePurposeKey(secret, purpose);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(payload)));
}

function fixedLengthEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== SIGNATURE_BYTES || right.byteLength !== SIGNATURE_BYTES) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < SIGNATURE_BYTES; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function decodeSignedLinkToken(token: string): {
  readonly envelope: SignedLinkEnvelope;
  readonly payload: string;
  readonly signature: Uint8Array;
} | null {
  const segments = token.split(".");
  if (segments.length !== 2) {
    return null;
  }
  const payload = segments[0] ?? "";
  const signature = decodeBase64Url(segments[1] ?? "");
  const envelopeBytes = decodeBase64Url(payload);
  if (!signature || !envelopeBytes || envelopeBytes.byteLength > MAX_ENVELOPE_BYTES) {
    return null;
  }
  try {
    const envelopeValue: unknown = JSON.parse(new TextDecoder().decode(envelopeBytes));
    const envelope = signedLinkEnvelopeSchema.safeParse(envelopeValue);
    return envelope.success ? { envelope: envelope.data, payload, signature } : null;
  } catch {
    return null;
  }
}

export async function issueSignedLink(secret: string, input: SignedLinkEnvelope): Promise<string> {
  if (secret.length < 32) {
    throw new Error("The signed-link secret is not configured securely.");
  }
  const envelope = signedLinkEnvelopeSchema.parse(input);
  if (envelope.expiresAt <= envelope.issuedAt) {
    throw new Error("The signed-link expiry must follow issuance.");
  }
  const envelopeBytes = textEncoder.encode(JSON.stringify(envelope));
  if (envelopeBytes.byteLength > MAX_ENVELOPE_BYTES) {
    throw new Error("The signed-link envelope exceeds the size limit.");
  }
  const payload = encodeBase64Url(envelopeBytes);
  const signature = await signPayload(secret, envelope.purpose, payload);
  return `${payload}.${encodeBase64Url(signature)}`;
}

export async function verifySignedLink(
  secret: string,
  token: string,
  options: VerifySignedLinkOptions,
): Promise<SignedLinkEnvelope | null> {
  const envelope = await verifySignedLinkScope(secret, token, options);
  return envelope &&
    envelope.resourceId === options.expectedResourceId &&
    envelope.revocation === options.expectedRevocation &&
    envelope.subjectId === options.expectedSubjectId
    ? envelope
    : null;
}

export async function verifySignedLinkScope(
  secret: string,
  token: string,
  options: VerifySignedLinkScopeOptions,
): Promise<SignedLinkEnvelope | null> {
  if (secret.length < 32 || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  const decoded = decodeSignedLinkToken(token);
  if (decoded?.envelope.purpose !== options.expectedPurpose) {
    return null;
  }
  const expectedSignature = await signPayload(secret, options.expectedPurpose, decoded.payload);
  if (!fixedLengthEqual(decoded.signature, expectedSignature)) {
    return null;
  }
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  return decoded.envelope.issuedAt <= nowSeconds &&
    decoded.envelope.expiresAt > nowSeconds &&
    decoded.envelope.organizationId === options.expectedOrganizationId &&
    decoded.envelope.purpose === options.expectedPurpose
    ? decoded.envelope
    : null;
}
