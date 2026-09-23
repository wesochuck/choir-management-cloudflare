import type {
  communicationAudienceRequestSchema,
  CommunicationRecipientSubject,
} from "@choir/contracts";
import { z } from "zod";

import {
  MAX_COMMUNICATION_DELIVERIES,
  audienceOperationSchema,
  type CandidateRow,
  type CommunicationAudienceStorage,
} from "./contracts";
import { allowedVoiceParts, identityMatches, trackOnlyVoiceParts } from "./shared";

type Audience = z.infer<typeof communicationAudienceRequestSchema>;

type AudienceStorage = CommunicationAudienceStorage;

interface AudienceCandidate {
  readonly displayName: string;
  readonly doNotEmail: boolean;
  readonly email: string | null;
  readonly emailSuppressed: boolean;
  readonly emailUnsubscribed: boolean;
  readonly phone: string | null;
  readonly profileId: string;
  readonly providerBounced: boolean;
  readonly smsSuppressed: boolean;
  readonly smsUnsubscribed: boolean;
  readonly subject: CommunicationRecipientSubject;
  readonly voicePart: string;
}

const AUDIENCE_MEMBER_LIMIT = 500;
const AUDIENCE_CONTACT_LIMIT = 500;
const AUDIENCE_COMMERCE_LIMIT = 500;
const AUDIENCE_TICKET_SERVICE_LIMIT = MAX_COMMUNICATION_DELIVERIES;
const COMMERCE_LOOKUP_BATCH_SIZE = 500;

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function batches<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += COMMERCE_LOOKUP_BATCH_SIZE) {
    result.push(values.slice(offset, offset + COMMERCE_LOOKUP_BATCH_SIZE));
  }
  return result;
}

interface CommerceTransactionRow {
  readonly [column: string]: SqlStorageValue;
  readonly buyerEmail: string;
  readonly buyerName: string;
  readonly contactId: string | null;
  readonly id: string;
}

interface CommerceContactRow {
  readonly [column: string]: SqlStorageValue;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly emailSource: string | null;
  readonly emailStatus: string | null;
  readonly id: string;
  readonly phone: string | null;
  readonly profileId: string | null;
  readonly smsStatus: string | null;
}

function normalizeCommerceEmail(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 ? null : normalized;
}

function readCommerceContactsByIds(
  storage: AudienceStorage,
  contactIds: readonly string[],
): ReadonlyMap<string, CommerceContactRow> {
  const rows = new Map<string, CommerceContactRow>();
  const unique = [...new Set(contactIds.filter((id) => id !== ""))];
  if (unique.length === 0) return rows;
  for (const batch of batches(unique)) {
    for (const row of storage.sql
      .exec<CommerceContactRow>(
        `SELECT c.id, c.display_name AS displayName, c.email, c.phone,
          c.profile_id AS profileId,
          email_pref.status AS emailStatus, email_pref.source AS emailSource,
          sms_pref.status AS smsStatus
         FROM contacts c
         LEFT JOIN contact_communication_preferences email_pref
           ON email_pref.contact_id = c.id AND email_pref.channel = 'email'
         LEFT JOIN contact_communication_preferences sms_pref
           ON sms_pref.contact_id = c.id AND sms_pref.channel = 'sms'
         WHERE c.id IN (${placeholders(batch.length)})`,
        ...batch,
      )
      .toArray()) {
      rows.set(row.id, row);
    }
  }
  return rows;
}

function readCommerceContactsByEmails(
  storage: AudienceStorage,
  normalizedEmails: readonly string[],
): ReadonlyMap<string, CommerceContactRow> {
  const rows = new Map<string, CommerceContactRow>();
  const unique = [...new Set(normalizedEmails.filter((email) => email !== ""))];
  if (unique.length === 0) return rows;
  for (const batch of batches(unique)) {
    for (const row of storage.sql
      .exec<CommerceContactRow & { readonly normalizedEmail: string | null }>(
        `SELECT c.id, c.display_name AS displayName, c.email, c.phone,
          c.profile_id AS profileId, c.normalized_email AS normalizedEmail,
          email_pref.status AS emailStatus, email_pref.source AS emailSource,
          sms_pref.status AS smsStatus
         FROM contacts c
         LEFT JOIN contact_communication_preferences email_pref
           ON email_pref.contact_id = c.id AND email_pref.channel = 'email'
         LEFT JOIN contact_communication_preferences sms_pref
           ON sms_pref.contact_id = c.id AND sms_pref.channel = 'sms'
         WHERE c.normalized_email IN (${placeholders(batch.length)})`,
        ...batch,
      )
      .toArray()) {
      const key = row.normalizedEmail?.trim().toLowerCase() ?? "";
      if (key !== "" && !rows.has(key)) rows.set(key, row);
    }
  }
  return rows;
}

/**
 * Phase 9 commerce → Contact resolution.
 *
 * Ticket Buyer and Donor audiences resolve through Contacts instead of
 * treating transaction IDs as profile IDs. Each paid transaction links via
 * its stored `contact_id` (written by checkout and the Section 8 backfill);
 * rows that predate the link fall back to an indexed normalized-email match
 * within this Organization. Transactions with no resolvable Contact are
 * skipped rather than minted as pseudo-profile recipients, so a purchase or
 * donation ID can never appear as a `profileId` carrier again.
 *
 * The emitted candidate carries a `{ kind: "contact" }` subject with the
 * Contact ID as carrier, the Contact's canonical email/phone, and the
 * Contact's preference plus linked-profile suppression flags. The audience
 * label ("Ticket Buyer"/"Donor") is preserved as `voicePart` for reach
 * previews; destination dedupe with suppression precedence still happens in
 * the caller merge step. Historical deliveries keep their stored
 * `ticket_purchase`/`donation` subjects readable via the legacy adapter.
 */
interface CommerceSelection {
  readonly row: CommerceTransactionRow;
  readonly ticketBuyerMode: Audience["ticketBuyerMode"];
  readonly voicePart: "Donor" | "Ticket Buyer";
}

interface CommerceSelections {
  readonly selections: CommerceSelection[];
  readonly ticketBuyerPurchasesOverLimit: number;
}

function readCommerceSelections(storage: AudienceStorage, audience: Audience): CommerceSelections {
  const selections: CommerceSelection[] = [];
  let ticketBuyerPurchasesOverLimit = 0;
  if (audience.targetAudiences.includes("Ticket Buyers")) {
    const isTicketService = audience.ticketBuyerMode === "ticket_service";
    const eventFilter =
      audience.eventId === null
        ? ""
        : `AND (p.event_id = ? OR EXISTS (
             SELECT 1 FROM ticket_bundle_allocations a
             WHERE a.purchase_id = p.id AND a.event_id = ?
           ))`;
    const ticketConsent = isTicketService ? "" : "AND p.marketing_opt_in = 1";
    if (isTicketService && audience.eventId !== null) {
      const matchingPurchases = storage.sql
        .exec<{ readonly [column: string]: SqlStorageValue; readonly count: number }>(
          `SELECT COUNT(*) AS count FROM ticket_purchases p
           WHERE p.status = 'paid' AND (p.event_id = ? OR EXISTS (
             SELECT 1 FROM ticket_bundle_allocations a
             WHERE a.purchase_id = p.id AND a.event_id = ?
           ))`,
          audience.eventId,
          audience.eventId,
        )
        .toArray()
        .at(0)?.count;
      ticketBuyerPurchasesOverLimit = Math.max(
        0,
        (matchingPurchases ?? 0) - AUDIENCE_TICKET_SERVICE_LIMIT,
      );
    }
    const ticketPurchaseLimit = isTicketService
      ? AUDIENCE_TICKET_SERVICE_LIMIT
      : AUDIENCE_COMMERCE_LIMIT;
    const ticketRows = storage.sql
      .exec<CommerceTransactionRow>(
        `SELECT p.id, p.buyer_name AS buyerName, p.buyer_email AS buyerEmail,
          p.contact_id AS contactId
         FROM ticket_purchases p
         WHERE p.status = 'paid' ${ticketConsent} ${eventFilter}
         ORDER BY p.buyer_name COLLATE NOCASE, p.id LIMIT ${String(ticketPurchaseLimit)}`,
        ...(audience.eventId === null ? [] : [audience.eventId, audience.eventId]),
      )
      .toArray();
    for (const row of ticketRows) {
      selections.push({
        row,
        ticketBuyerMode: audience.ticketBuyerMode,
        voicePart: "Ticket Buyer",
      });
    }
  }
  if (audience.targetAudiences.includes("Donors")) {
    const donorRows = storage.sql
      .exec<CommerceTransactionRow>(
        `SELECT d.id, d.buyer_name AS buyerName, d.buyer_email AS buyerEmail,
          d.contact_id AS contactId
         FROM donations d
         WHERE d.status = 'paid' AND d.marketing_consent = 1
         ORDER BY d.buyer_name COLLATE NOCASE, d.id LIMIT ${String(AUDIENCE_COMMERCE_LIMIT)}`,
      )
      .toArray();
    for (const row of donorRows) {
      selections.push({ row, ticketBuyerMode: "marketing", voicePart: "Donor" });
    }
  }
  return { selections, ticketBuyerPurchasesOverLimit };
}

interface ResolvedCommerceContacts {
  readonly byEmail: ReadonlyMap<string, CommerceContactRow>;
  readonly byId: ReadonlyMap<string, CommerceContactRow>;
  readonly linkedFlags: ReadonlyMap<string, ProfileSuppressionFlags>;
}

function resolveCommerceContacts(
  storage: AudienceStorage,
  selections: readonly CommerceSelection[],
): ResolvedCommerceContacts {
  const directIds = selections
    .map(({ row }) => row.contactId)
    .filter((value): value is string => value !== null && value !== "");
  const fallbackEmails = selections
    .filter(({ row }) => row.contactId === null || row.contactId === "")
    .map(({ row }) => normalizeCommerceEmail(row.buyerEmail))
    .filter((value): value is string => value !== null);
  const byId = readCommerceContactsByIds(storage, directIds);
  const byEmail = readCommerceContactsByEmails(storage, fallbackEmails);
  const linkedProfileIds = [...byId.values(), ...byEmail.values()]
    .map((row) => row.profileId)
    .filter((value): value is string => value !== null && value !== "");
  return { byEmail, byId, linkedFlags: readLinkedProfileFlags(storage, linkedProfileIds) };
}

function resolveCommerceContact(
  selection: CommerceSelection,
  resolved: ResolvedCommerceContacts,
): CommerceContactRow | undefined {
  const { row } = selection;
  if (row.contactId !== null && row.contactId !== "") {
    const direct = resolved.byId.get(row.contactId);
    if (direct !== undefined) return direct;
  }
  const fallbackKey = normalizeCommerceEmail(row.buyerEmail);
  return fallbackKey === null ? undefined : resolved.byEmail.get(fallbackKey);
}

interface CommerceDestination {
  readonly email: string | null;
  readonly phone: string | null;
}

function commerceCandidateDestination(
  contact: CommerceContactRow,
  fallbackEmail: string,
): CommerceDestination | null {
  const email = contact.email ?? fallbackEmail;
  const normalized = normalizeCommerceEmail(email);
  const phone = contact.phone;
  if (normalized === null && (phone === null || phone === "")) return null;
  return { email, phone };
}

function isTicketServiceSelection(selection: CommerceSelection): boolean {
  return selection.voicePart === "Ticket Buyer" && selection.ticketBuyerMode === "ticket_service";
}

function canDeliverTicketServiceEmail(selection: CommerceSelection, email: string | null): boolean {
  return !isTicketServiceSelection(selection) || z.email().safeParse(email?.trim()).success;
}

function isProviderSuppressedContact(contact: CommerceContactRow): boolean {
  return (
    contact.emailStatus === "unsubscribed" &&
    (contact.emailSource === "provider_bounce" || contact.emailSource === "provider_complaint")
  );
}

function contactEmailUnsubscribed(isTicketService: boolean, contact: CommerceContactRow): boolean {
  return isTicketService ? false : contact.emailStatus === "unsubscribed";
}

function contactHasProviderBounce(
  linked: ProfileSuppressionFlags | undefined,
  contact: CommerceContactRow,
): boolean {
  return (linked?.providerBounced ?? false) || isProviderSuppressedContact(contact);
}

function toCommerceCandidate(
  selection: CommerceSelection,
  contact: CommerceContactRow,
  linkedFlags: ReadonlyMap<string, ProfileSuppressionFlags>,
): AudienceCandidate | null {
  const destination = commerceCandidateDestination(contact, selection.row.buyerEmail);
  if (!destination || !canDeliverTicketServiceEmail(selection, destination.email)) return null;
  const isTicketService = isTicketServiceSelection(selection);
  const linked = contact.profileId ? linkedFlags.get(contact.profileId) : undefined;
  return {
    displayName: contact.displayName ?? selection.row.buyerName,
    doNotEmail: linked?.doNotEmail ?? false,
    email: destination.email,
    emailSuppressed: linked?.emailSuppressed ?? false,
    emailUnsubscribed: contactEmailUnsubscribed(isTicketService, contact),
    phone: destination.phone,
    profileId: contact.id,
    providerBounced: contactHasProviderBounce(linked, contact),
    smsSuppressed: linked?.smsSuppressed ?? false,
    smsUnsubscribed: contact.smsStatus === "unsubscribed",
    subject: { kind: "contact", contactId: contact.id } as const,
    voicePart: selection.voicePart,
  };
}

interface CommerceRecipientResolution {
  readonly recipients: AudienceCandidate[];
  readonly ticketBuyerPurchasesOverLimit: number;
  readonly undeliverableTicketBuyerPurchases: number;
}

function commerceRecipients(
  storage: AudienceStorage,
  audience: Audience,
): CommerceRecipientResolution {
  const selectionResult = readCommerceSelections(storage, audience);
  const selections = selectionResult.selections;
  if (selections.length === 0) {
    return {
      recipients: [],
      ticketBuyerPurchasesOverLimit: selectionResult.ticketBuyerPurchasesOverLimit,
      undeliverableTicketBuyerPurchases: 0,
    };
  }
  // Keep duplicate candidates through this boundary so the caller's
  // normalized-destination Map merges suppression flags from every Contact.
  const resolved = resolveCommerceContacts(storage, selections);
  const recipients: AudienceCandidate[] = [];
  let undeliverableTicketBuyerPurchases = 0;
  for (const selection of selections) {
    const contact = resolveCommerceContact(selection, resolved);
    const candidate = contact
      ? toCommerceCandidate(selection, contact, resolved.linkedFlags)
      : null;
    if (!candidate) {
      if (
        selection.voicePart === "Ticket Buyer" &&
        selection.ticketBuyerMode === "ticket_service"
      ) {
        undeliverableTicketBuyerPurchases += 1;
      }
      continue;
    }
    recipients.push(candidate);
  }
  return {
    recipients,
    ticketBuyerPurchasesOverLimit: selectionResult.ticketBuyerPurchasesOverLimit,
    undeliverableTicketBuyerPurchases,
  };
}

interface ContactCandidateRow {
  readonly [column: string]: SqlStorageValue;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly emailStatus: string | null;
  readonly id: string;
  readonly phone: string | null;
  readonly profileId: string | null;
  readonly smsStatus: string | null;
  readonly source: string | null;
}

function contactSelectionSql(audience: Audience): {
  readonly params: unknown[];
  readonly sql: string;
} {
  const { contactIds, contactListIds } = audience;
  if (contactListIds.length > 0 && contactIds.length > 0) {
    return {
      params: [...contactListIds, ...contactIds],
      sql: `(EXISTS (SELECT 1 FROM contact_list_memberships m WHERE m.contact_id = c.id AND m.list_id IN (${placeholders(contactListIds.length)})) OR c.id IN (${placeholders(contactIds.length)}))`,
    };
  }
  if (contactListIds.length > 0) {
    return {
      params: [...contactListIds],
      sql: `EXISTS (SELECT 1 FROM contact_list_memberships m WHERE m.contact_id = c.id AND m.list_id IN (${placeholders(contactListIds.length)}))`,
    };
  }
  if (contactIds.length > 0) {
    return {
      params: [...contactIds],
      sql: `c.id IN (${placeholders(contactIds.length)})`,
    };
  }
  return { params: [], sql: "1 = 1" };
}

interface ProfileSuppressionFlags {
  readonly doNotEmail: boolean;
  readonly emailSuppressed: boolean;
  readonly providerBounced: boolean;
  readonly smsSuppressed: boolean;
}

/**
 * Resolves suppression/unsubscribe state for contacts linked to profiles.
 * Bounded IN-query batches avoid per-contact N+1 reads; unknown IDs yield no
 * flags. Contact preference state is read from the candidate row itself.
 */
function readLinkedProfileFlags(
  storage: AudienceStorage,
  profileIds: readonly string[],
): ReadonlyMap<string, ProfileSuppressionFlags> {
  const flags = new Map<string, ProfileSuppressionFlags>();
  if (profileIds.length === 0) return flags;
  const unique = [...new Set(profileIds)];
  for (const batch of batches(unique)) {
    const profileRows = storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly doNotEmail: number;
        readonly id: string;
        readonly lastBounceAt: string;
        readonly providerSuppressed: number;
      }>(
        `SELECT id, do_not_email AS doNotEmail,
          provider_email_suppressed AS providerSuppressed,
          last_bounce_at AS lastBounceAt
         FROM profiles WHERE id IN (${placeholders(batch.length)})`,
        ...batch,
      )
      .toArray();
    for (const row of profileRows) {
      flags.set(row.id, {
        doNotEmail: row.doNotEmail === 1,
        emailSuppressed: false,
        providerBounced: row.providerSuppressed === 1 || row.lastBounceAt !== "",
        smsSuppressed: false,
      });
    }
    const suppressionRows = storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly channel: string;
        readonly profileId: string;
      }>(
        `SELECT profile_id AS profileId, channel FROM communication_suppressions
         WHERE active = 1 AND profile_id IN (${placeholders(batch.length)})`,
        ...batch,
      )
      .toArray();
    for (const row of suppressionRows) {
      const current = flags.get(row.profileId) ?? {
        doNotEmail: false,
        emailSuppressed: false,
        providerBounced: false,
        smsSuppressed: false,
      };
      flags.set(row.profileId, {
        ...current,
        emailSuppressed: current.emailSuppressed || row.channel === "email",
        smsSuppressed: current.smsSuppressed || row.channel === "sms",
      });
    }
  }
  return flags;
}

function contactRecipients(storage: AudienceStorage, audience: Audience): AudienceCandidate[] {
  if (!audience.targetAudiences.includes("Contacts")) return [];
  const selection = contactSelectionSql(audience);
  const where: string[] = [selection.sql];
  const params: unknown[] = [...selection.params];
  if (audience.contactSource !== null) {
    where.push("c.source = ?");
    params.push(audience.contactSource);
  }
  if (audience.contactEmailStatus !== null) {
    where.push(
      `EXISTS (SELECT 1 FROM contact_communication_preferences p WHERE p.contact_id = c.id AND p.channel = 'email' AND p.status = ?)`,
    );
    params.push(audience.contactEmailStatus);
  }
  if (audience.contactSmsStatus !== null) {
    where.push(
      `EXISTS (SELECT 1 FROM contact_communication_preferences p WHERE p.contact_id = c.id AND p.channel = 'sms' AND p.status = ?)`,
    );
    params.push(audience.contactSmsStatus);
  }
  const rows = storage.sql
    .exec<ContactCandidateRow>(
      `SELECT c.id, c.display_name AS displayName, c.email, c.phone,
        c.profile_id AS profileId, c.source,
        email_pref.status AS emailStatus, sms_pref.status AS smsStatus
       FROM contacts c
       LEFT JOIN contact_communication_preferences email_pref
         ON email_pref.contact_id = c.id AND email_pref.channel = 'email'
       LEFT JOIN contact_communication_preferences sms_pref
         ON sms_pref.contact_id = c.id AND sms_pref.channel = 'sms'
       WHERE ${where.join(" AND ")}
       ORDER BY c.display_name COLLATE NOCASE, c.id LIMIT ${String(AUDIENCE_CONTACT_LIMIT)}`,
      ...params,
    )
    .toArray();
  // Foreign list/contact IDs from another Organization simply match nothing:
  // storage is Organization-scoped, so cross-tenant audience IDs stay empty.
  const linkedProfileIds = rows
    .map((row) => row.profileId)
    .filter((value): value is string => value !== null && value !== "");
  const linkedFlags = readLinkedProfileFlags(storage, linkedProfileIds);
  return rows.map((row) => {
    const linked = row.profileId ? linkedFlags.get(row.profileId) : undefined;
    return {
      displayName: row.displayName ?? row.email ?? row.phone ?? "Contact",
      doNotEmail: linked?.doNotEmail ?? false,
      email: row.email,
      emailSuppressed: linked?.emailSuppressed ?? false,
      emailUnsubscribed: row.emailStatus === "unsubscribed",
      phone: row.phone,
      profileId: row.id,
      providerBounced: linked?.providerBounced ?? false,
      smsSuppressed: linked?.smsSuppressed ?? false,
      smsUnsubscribed: row.smsStatus === "unsubscribed",
      subject: { kind: "contact", contactId: row.id } as const,
      voicePart: "Contacts",
    };
  });
}

interface MemberCandidateRow extends CandidateRow {
  readonly lastBounceAt: string;
  readonly providerSuppressed: number;
  readonly smsSuppressed: number;
}

function memberRecipients(storage: AudienceStorage, audience: Audience): AudienceCandidate[] {
  if (!audience.targetAudiences.includes("Members")) return [];
  const rows = storage.sql
    .exec<MemberCandidateRow>(
      `SELECT p.id, p.display_name AS displayName, NULL AS email, p.phone,
          p.voice_part AS voicePart, p.global_status AS globalStatus, p.do_not_email AS doNotEmail,
          p.provider_email_suppressed AS providerSuppressed, p.last_bounce_at AS lastBounceAt,
          EXISTS (
            SELECT 1 FROM communication_suppressions s
            WHERE s.profile_id = p.id AND s.channel = 'email' AND s.active = 1
          ) AS emailSuppressed,
          EXISTS (
            SELECT 1 FROM communication_suppressions s
            WHERE s.profile_id = p.id AND s.channel = 'sms' AND s.active = 1
          ) AS smsSuppressed,
          COALESCE(r.rsvp, 'Pending') AS rsvp
         FROM profiles p
         LEFT JOIN event_rosters r ON r.profile_id = p.id AND r.event_id = ?
         ORDER BY p.display_name COLLATE NOCASE, p.id LIMIT ${String(AUDIENCE_MEMBER_LIMIT)}`,
      audience.eventId ?? "",
    )
    .toArray();
  const requestedProfiles = audience.profileIds.length > 0 ? new Set(audience.profileIds) : null;
  const requestedVoiceParts = allowedVoiceParts(storage, audience.voiceParts);
  const excludedVoiceParts = trackOnlyVoiceParts(storage);
  const statuses = new Set(audience.globalStatuses);
  return rows
    .filter(({ id }) => !requestedProfiles || requestedProfiles.has(id))
    .filter(({ globalStatus }) => statuses.has(globalStatus))
    .filter(({ voicePart }) => voicePart.length > 0 && !excludedVoiceParts.has(voicePart))
    .filter(({ voicePart }) => !requestedVoiceParts || requestedVoiceParts.has(voicePart))
    .filter(({ rsvp }) => !audience.eventId || audience.rsvp === "All" || audience.rsvp === rsvp)
    .map(
      ({
        displayName,
        doNotEmail,
        email,
        emailSuppressed,
        id,
        phone,
        smsSuppressed,
        voicePart,
        lastBounceAt,
        providerSuppressed,
      }) => ({
        displayName,
        doNotEmail: doNotEmail === 1,
        email,
        emailSuppressed: emailSuppressed === 1,
        emailUnsubscribed: false,
        phone,
        profileId: id,
        providerBounced: providerSuppressed === 1 || lastBounceAt !== "",
        smsSuppressed: smsSuppressed === 1,
        smsUnsubscribed: false,
        subject: { kind: "profile", profileId: id } as const,
        voicePart,
      }),
    );
}

export async function resolveCommunicationAudienceFromStore(
  storage: AudienceStorage,
  request: Request,
): Promise<Response> {
  const parsed = audienceOperationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ code: "invalid_communication_audience" }, { status: 400 });
  const { audience, organizationId } = parsed.data;
  if (!identityMatches(storage, organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  // Each selected audience is built independently; destination dedupe with
  // suppression precedence happens in the caller merge step (Map-keyed, no
  // .find scans over the growing recipient list).
  const commerce = commerceRecipients(storage, audience);
  const recipients: AudienceCandidate[] = [
    ...memberRecipients(storage, audience),
    ...contactRecipients(storage, audience),
    ...commerce.recipients,
  ];
  return Response.json({
    recipients,
    ticketBuyerPurchasesOverLimit: commerce.ticketBuyerPurchasesOverLimit,
    undeliverableTicketBuyerPurchases: commerce.undeliverableTicketBuyerPurchases,
  });
}
