import { z } from "zod";

const REVIEW_WINDOW_MS = 5 * 60 * 1_000;
const textEncoder = new TextEncoder();

const reviewEnvelopeSchema = z.object({
  audienceDigest: z.string().min(1).max(128),
  draftRevision: z.number().int().positive(),
  eventId: z.uuid(),
  expiresAt: z.number().int().positive(),
  messageDigest: z.string().min(1).max(128),
  messageId: z.uuid(),
  organizationId: z.string().min(1).max(128),
  recipientDigest: z.string().min(1).max(128),
  version: z.literal(1),
});

export interface PromotionReviewSnapshotInput {
  readonly audience: unknown;
  readonly contentMarkdown: string;
  readonly draftRevision: number;
  readonly eventId: string;
  readonly messageId: string;
  readonly organizationId: string;
  readonly recipients: readonly {
    readonly email: string;
    readonly profileId: string;
    readonly subject: unknown;
  }[];
  readonly subject: string;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return encodeBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableJson(Reflect.get(value, key))}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function digest(value: string): Promise<string> {
  return encodeBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value))),
  );
}

async function signingKey(secret: string): Promise<CryptoKey> {
  const masterKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const purposeKey = await crypto.subtle.sign(
    "HMAC",
    masterKey,
    textEncoder.encode("choir-management:event-promotion-review:v1"),
  );
  return crypto.subtle.importKey("raw", purposeKey, { hash: "SHA-256", name: "HMAC" }, false, [
    "sign",
  ]);
}

async function sign(secret: string, payload: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", await signingKey(secret), textEncoder.encode(payload)),
  );
}

function equalSignature(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== 32 || right.byteLength !== 32) return false;
  let difference = 0;
  for (let index = 0; index < 32; index += 1)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

function normalizedRecipients(input: PromotionReviewSnapshotInput) {
  return input.recipients
    .map((recipient) => ({
      email: recipient.email.trim().toLowerCase(),
      profileId: recipient.profileId,
      subject: recipient.subject,
    }))
    .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

async function inputDigests(input: PromotionReviewSnapshotInput) {
  return Promise.all([
    digest(stableJson(input.audience)),
    digest(stableJson(normalizedRecipients(input))),
    digest(stableJson([input.subject, input.contentMarkdown])),
  ]);
}

async function authenticatedEnvelope(
  secret: string,
  token: string,
): Promise<z.infer<typeof reviewEnvelopeSchema> | null> {
  const segments = token.split(".");
  if (segments.length !== 2) return null;
  const payload = segments[0] ?? "";
  const signature = decodeBase64Url(segments[1] ?? "");
  const payloadBytes = decodeBase64Url(payload);
  if (!signature || !payloadBytes) return null;
  if (!equalSignature(await sign(secret, payload), signature)) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(payloadBytes));
    const envelope = reviewEnvelopeSchema.safeParse(parsed);
    return envelope.success ? envelope.data : null;
  } catch {
    return null;
  }
}

async function matchesInput(
  envelope: z.infer<typeof reviewEnvelopeSchema>,
  input: PromotionReviewSnapshotInput,
): Promise<boolean> {
  const [audienceDigest, recipientDigest, messageDigest] = await inputDigests(input);
  return (
    envelope.audienceDigest === audienceDigest &&
    envelope.draftRevision === input.draftRevision &&
    envelope.eventId === input.eventId &&
    envelope.messageDigest === messageDigest &&
    envelope.messageId === input.messageId &&
    envelope.organizationId === input.organizationId &&
    envelope.recipientDigest === recipientDigest
  );
}

export async function issuePromotionReviewSnapshot(
  secret: string,
  input: PromotionReviewSnapshotInput,
  now = Date.now(),
): Promise<string> {
  const recipients = normalizedRecipients(input);
  const envelope = reviewEnvelopeSchema.parse({
    audienceDigest: await digest(stableJson(input.audience)),
    draftRevision: input.draftRevision,
    eventId: input.eventId,
    expiresAt: now + REVIEW_WINDOW_MS,
    messageDigest: await digest(stableJson([input.subject, input.contentMarkdown])),
    messageId: input.messageId,
    organizationId: input.organizationId,
    recipientDigest: await digest(stableJson(recipients)),
    version: 1,
  });
  const payload = encodeBase64Url(textEncoder.encode(JSON.stringify(envelope)));
  return `${payload}.${encodeBase64Url(await sign(secret, payload))}`;
}

export async function verifyPromotionReviewSnapshot(
  secret: string,
  token: string,
  input: PromotionReviewSnapshotInput,
  now = Date.now(),
): Promise<"valid" | "expired" | "stale" | "invalid"> {
  const envelope = await authenticatedEnvelope(secret, token);
  if (!envelope) return "invalid";
  if (envelope.expiresAt <= now) return "expired";
  return (await matchesInput(envelope, input)) ? "valid" : "stale";
}
