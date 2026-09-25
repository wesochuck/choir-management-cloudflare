import { z } from "zod";

import type { OrganizationProfile } from "@choir/contracts";
import type { Env } from "../env";
import {
  queueAutomatedOrganizationCommunication,
  type AutomatedCommunicationRecipient,
} from "./organizationCommunications";
import { listOrganizationProfiles } from "./profiles";
import { readOrganizationStore } from "./rpc/repository";

const financialAlertMembershipRowSchema = z.object({
  email: z.email().max(320),
  profileId: z.uuid(),
});

const purchaseResponseSchema = z.object({
  bundleTitle: z.string().nullable().optional(),
  eventStartsAt: z.string().nullable().optional(),
  eventTitle: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
});

const markdownCharacters = [
  "\\",
  "`",
  "*",
  "_",
  "[",
  "]",
  "{",
  "}",
  "(",
  ")",
  "#",
  "+",
  ".",
  "!",
  "|",
  ">",
  "~",
  "-",
] as const;

export interface TicketSaleAlertInput {
  readonly actorUserId?: string;
  readonly amountPaidCents: number;
  readonly buyerEmail: string;
  readonly buyerName: string;
  readonly currency: string;
  readonly eventId: string | null;
  readonly eventStartsAt?: string | null;
  readonly eventTitle?: string | null;
  readonly orderUrl: string;
  readonly organizationId: string;
  readonly organizationOrigin?: string;
  readonly purchaseId: string;
  readonly quantity: number;
  readonly requestId: string;
  readonly timezone?: string | null;
}

export interface FinancialAlertDatabase {
  readonly prepare: (query: string) => {
    readonly bind: (...values: readonly unknown[]) => {
      readonly all: () => Promise<{ readonly results: readonly unknown[] }>;
    };
  };
}

export type TicketSaleAlertEnv = Pick<Env, "ORGANIZATION_STORE" | "SIGNED_LINK_SECRET"> & {
  readonly CONTROL_DB?: FinancialAlertDatabase;
};

export function escapeMarkdown(value: string): string {
  let escaped = value;
  for (const character of markdownCharacters) {
    escaped = escaped.replaceAll(character, `\\${character}`);
  }
  return escaped;
}

export function formatMoney(cents: number, currency: string): string {
  if (cents === 0) return "$0.00";
  const effectiveCurrency = currency.length > 0 ? currency.toUpperCase() : "USD";
  return new Intl.NumberFormat("en-US", {
    currency: effectiveCurrency,
    style: "currency",
  }).format(cents / 100);
}

export function formatEventDate(value: string, timezone: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone,
  }).format(date);
}

export async function financialAlertRecipients(
  db: FinancialAlertDatabase,
  organizationId: string,
  profiles: readonly OrganizationProfile[],
): Promise<readonly AutomatedCommunicationRecipient[]> {
  const result = await db
    .prepare(
      `SELECT m.profileId AS profileId, u.email AS email
         FROM member m
         JOIN user u ON u.id = m.userId
         WHERE m.organizationId = ?
           AND m.profileId IS NOT NULL`,
    )
    .bind(organizationId)
    .all();
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const recipients = new Map<string, AutomatedCommunicationRecipient>();
  for (const row of result.results) {
    const membership = financialAlertMembershipRowSchema.safeParse(row);
    if (!membership.success) continue;
    const profile = profilesById.get(membership.data.profileId);
    if (!profile) continue;
    if (
      profile.globalStatus !== "Active" ||
      profile.doNotEmail ||
      profile.providerEmailSuppressed ||
      !profile.receiveFinancialAlerts
    ) {
      continue;
    }
    const email = membership.data.email.toLowerCase();
    if (recipients.has(profile.id)) continue;
    recipients.set(profile.id, {
      email,
      name: profile.displayName,
      phone: profile.phone,
      profileId: profile.id,
    });
  }
  return [...recipients.values()];
}

async function fetchPurchaseFromStore(
  env: TicketSaleAlertEnv,
  organizationId: string,
  purchaseId: string,
): Promise<z.infer<typeof purchaseResponseSchema> | null> {
  try {
    const response = await readOrganizationStore(
      env,
      organizationId,
      "/internal/ticketing/purchase",
      { purchaseId },
    );
    if (!response.ok) return null;
    const parsed = purchaseResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function extractPurchaseTitle(purchase: z.infer<typeof purchaseResponseSchema> | null): string {
  if (!purchase) return "Tickets";
  const bundle = purchase.bundleTitle?.trim();
  if (bundle && bundle.length > 0) return bundle;
  const event = purchase.eventTitle?.trim();
  if (event && event.length > 0) return event;
  return "Tickets";
}

async function resolvePurchaseDetails(
  env: TicketSaleAlertEnv,
  input: TicketSaleAlertInput,
): Promise<{
  readonly effectiveTitle: string;
  readonly eventStartsAt: string | null;
  readonly timezone: string;
}> {
  if (input.eventTitle) {
    return {
      effectiveTitle: input.eventTitle,
      eventStartsAt: input.eventStartsAt ?? null,
      timezone: input.timezone ?? "UTC",
    };
  }

  const purchase = await fetchPurchaseFromStore(env, input.organizationId, input.purchaseId);
  return {
    effectiveTitle: extractPurchaseTitle(purchase),
    eventStartsAt: input.eventStartsAt ?? (purchase ? (purchase.eventStartsAt ?? null) : null),
    timezone: input.timezone ?? (purchase ? (purchase.timezone ?? "UTC") : "UTC"),
  };
}

function buildAlertContent(
  input: TicketSaleAlertInput,
  effectiveTitle: string,
  eventStartsAt: string | null,
  timezone: string,
): { readonly contentMarkdown: string; readonly subject: string } {
  const formattedAmount = formatMoney(input.amountPaidCents, input.currency);
  const subject =
    `Ticket sale: ${effectiveTitle} — ${String(input.quantity)} × ${formattedAmount}`.slice(0, 300);

  const lines = [
    "## Ticket sale",
    "",
    "A ticket purchase was confirmed.",
    "",
    `- **Event:** ${escapeMarkdown(effectiveTitle)}`,
  ];
  if (eventStartsAt) {
    lines.push(`- **Date:** ${escapeMarkdown(formatEventDate(eventStartsAt, timezone))}`);
  }
  lines.push(
    `- **Quantity:** ${String(input.quantity)}`,
    `- **Amount paid:** ${formattedAmount}`,
    `- **Buyer:** ${escapeMarkdown(input.buyerName)} (${escapeMarkdown(input.buyerEmail)})`,
    `- **Order link:** [${input.orderUrl}](${input.orderUrl})`,
    "",
    `[View ticket orders in admin](${input.orderUrl})`,
  );

  return {
    contentMarkdown: lines.join("\n"),
    subject,
  };
}

export async function queueTicketSaleAlert(
  env: TicketSaleAlertEnv,
  input: TicketSaleAlertInput,
): Promise<Awaited<ReturnType<typeof queueAutomatedOrganizationCommunication>> | null> {
  if (!env.CONTROL_DB) return null;

  const profiles = await listOrganizationProfiles(env, input.organizationId);
  const recipients = await financialAlertRecipients(env.CONTROL_DB, input.organizationId, profiles);
  if (recipients.length === 0) return null;

  const { effectiveTitle, eventStartsAt, timezone } = await resolvePurchaseDetails(env, input);
  const { contentMarkdown, subject } = buildAlertContent(
    input,
    effectiveTitle,
    eventStartsAt,
    timezone,
  );
  const organizationOrigin = input.organizationOrigin ?? new URL(input.orderUrl).origin;

  return queueAutomatedOrganizationCommunication(
    env,
    {
      actorUserId: input.actorUserId ?? "public_guest",
      organizationId: input.organizationId,
      organizationOrigin,
      requestId: input.requestId,
    },
    {
      contentMarkdown,
      dedupeKey: `ticket-sale-alert:${input.purchaseId}`,
      eventId: input.eventId,
      recipients,
      subject,
    },
  );
}
