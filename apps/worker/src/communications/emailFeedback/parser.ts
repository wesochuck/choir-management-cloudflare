import { z } from "zod";

import type { cloudflareEventTypeSchema } from "./contracts";
import {
  CLOUDFLARE_EVENT_PREFIX,
  emailProviderStatusSchema,
  cloudflareEmailEventSchema,
  type EmailProviderRouteInput,
  type NormalizedEmailProviderEvent,
  type EmailProviderRouteRow,
  MAX_REASON_LENGTH,
  MAX_SMTP_RESPONSE_LENGTH,
} from "./contracts";

export function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function routeMatchesInput(
  route: EmailProviderRouteRow,
  input: EmailProviderRouteInput,
): boolean {
  return (
    normalizedEmail(route.destination) === normalizedEmail(input.destination) &&
    (route.organizationId ?? null) === (input.organizationId ?? null)
  );
}

export function bounded(value: string, maximum: number): string {
  return value.trim().slice(0, maximum);
}

export function logEmailFeedback(event: string, detail: Record<string, unknown>): void {
  console.info(JSON.stringify({ event, ...detail }));
}

export function emailDomain(value: string | undefined): string | undefined {
  const parsed = z.email().safeParse(value);
  if (!parsed.success) return undefined;
  return parsed.data.slice(parsed.data.lastIndexOf("@") + 1).toLowerCase();
}

function eventTypeFromCloudflareType(value: z.infer<typeof cloudflareEventTypeSchema>) {
  return emailProviderStatusSchema.parse(value.slice(CLOUDFLARE_EVENT_PREFIX.length));
}

function normalizedRejectionParty(
  value: string | undefined,
): "sender" | "recipient" | "other" | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "sender") return "sender";
  if (normalized === "recipient") return "recipient";
  return "other";
}

function eventReason(payload: z.infer<typeof cloudflareEmailEventSchema>["payload"]): string {
  const rejectionParty = payload.rejection?.party
    ? `rejection_party=${payload.rejection.party}`
    : "";
  const detail =
    payload.bounce?.reason ??
    payload.failure?.reason ??
    payload.rejection?.detail ??
    payload.rejection?.reason ??
    payload.complaint?.type ??
    payload.delivery?.smtpResponse ??
    "";
  return bounded([rejectionParty, detail].filter(Boolean).join(": "), MAX_REASON_LENGTH);
}

// eslint-disable-next-line complexity -- validates the bounded Cloudflare envelope and normalizes provider-specific fields.
export function parseCloudflareEmailEvent(
  input: unknown,
  expectedSourceDomain?: string,
): NormalizedEmailProviderEvent {
  const parsed = cloudflareEmailEventSchema.safeParse(input);
  if (!parsed.success) throw new Error("The Cloudflare email event payload was invalid.");
  const event = parsed.data;
  const eventType = eventTypeFromCloudflareType(event.type);
  const eventTimestamp = new Date(event.metadata.eventTimestamp);
  if (Number.isNaN(eventTimestamp.getTime())) {
    throw new Error("The Cloudflare email event timestamp was invalid.");
  }
  if (
    expectedSourceDomain &&
    event.source.domain.trim().toLowerCase() !== expectedSourceDomain.trim().toLowerCase()
  ) {
    throw new Error("The Cloudflare email event source domain was not configured for this Worker.");
  }
  if (event.payload.delivery?.status && event.payload.delivery.status !== eventType) {
    throw new Error("The Cloudflare email event status did not match its envelope type.");
  }
  if ((eventType === "deferred") === event.payload.terminal) {
    throw new Error("The Cloudflare email event terminal flag did not match its event type.");
  }
  return {
    bounceType: event.payload.bounce?.type ?? null,
    eventId: event.payload.eventId,
    eventTimestamp: eventTimestamp.toISOString(),
    eventType,
    messageId: event.payload.messageId,
    reason: eventReason(event.payload),
    recipient: normalizedEmail(event.payload.recipient),
    rejectionParty: normalizedRejectionParty(event.payload.rejection?.party),
    smtpEnhancedStatusCode: event.payload.delivery?.smtpEnhancedStatusCode ?? null,
    smtpResponse: bounded(event.payload.delivery?.smtpResponse ?? "", MAX_SMTP_RESPONSE_LENGTH),
    smtpStatusCode: event.payload.delivery?.smtpStatusCode ?? null,
    sourceDomain: event.source.domain.trim().toLowerCase(),
    terminal: event.payload.terminal,
  };
}
